/**
 * Level II and Level III data for Zift, and an honest account of what our
 * orders can and cannot fill in.
 *
 * WHY IT MATTERS
 *
 * On a book weighted towards commercial and purchasing cards, line-item detail
 * moves transactions to the Level 3 interchange rate — on the order of 0.5–1.5%
 * of the ticket. Visa retired standalone Level 2 in April 2026 under its
 * Commercial Enhanced Data Program, so on Visa it is full Level 3 or no
 * discount at all.
 *
 * Under a flat-rate merchant agreement the saving accrues to the processor
 * rather than the merchant, so whether this mapper pays for itself depends on
 * the pricing model. It is sent regardless: it is free to send, and it makes a
 * purchasing-card holder's statement legible.
 *
 * THREE THINGS THIS API DOES DIFFERENTLY, NONE OF THEM COSMETIC
 *
 *  1. Every amount is an integer of cents. See money.ts.
 *  2. Line items are a bracket-and-semicolon subrecord inside one form
 *     parameter, not a JSON array. See subrecord.ts.
 *  3. `commodityCode` is **String(4), acquirer-designated** — not the 8-digit
 *     UNSPSC code other gateways take, so an 8-digit value such as 43211500
 *     for "Computers" does not fit. Nobody has told us what the acquirer expects
 *     here, and inventing four characters would be worse than omitting the
 *     field: an unrecognised code can fail the record outright, where an absent
 *     optional field degrades to Level II. So it is left unset until asked, and
 *     `MISSING_FOR_FULL_LEVEL_3` says so out loud.
 *
 * WHAT WE CANNOT FILL IN, AND WHY IT IS LISTED RATHER THAN FAKED
 *
 * `MISSING_FOR_FULL_LEVEL_3` below is the answer to "does Level 3 actually
 * qualify on our orders?". Every entry is a real gap between Zift's field list
 * and what a DuroPC order holds. Sending a plausible-looking wrong value for
 * any of them would produce a record that reconciles arithmetically and
 * misdescribes the sale, which is the failure mode nobody notices until an
 * interchange audit.
 */

import { toCents, toRate } from "./money";
import type { Order } from "./saleor";
import { encodeSubrecords, type SubrecordField } from "./subrecord";

/**
 * Fields Zift documents for full Level III that a DuroPC order does not carry.
 * Each is a question for Zift or for the merchant, not a thing to invent.
 */
export const MISSING_FOR_FULL_LEVEL_3 = [
  {
    field: "commodityCode",
    detail: "String(4), acquirer-designated. Nobody has told us the value set our acquirer expects.",
    resolution: "Ask Zift which codes apply to industrial computer hardware on our MCC.",
  },
  {
    field: "shippingOriginZipCode",
    detail: "The ZIP an order ships FROM. Static per warehouse, and nothing in the system holds it.",
    resolution: "One config value. Ask Don for the shipping origin ZIP.",
  },
  {
    field: "localTaxAmount / nationalTaxAmount",
    detail: "Our tax app returns a single total; it does not split local from national.",
    resolution: "Send the total in taxAmount only. Both are optional; omitting them is honest.",
  },
  {
    field: "customerAccountTaxId",
    detail: "The buyer's tax ID. Checkout never asks for one.",
    resolution: "Leave unset. Collecting it would be a checkout field for a discount we have not measured.",
  },
  {
    field: "the buyer's PO number",
    detail:
      "Zift's orderCode is the MERCHANT's order id. No field in their published docs is obviously the buyer's own PO number — which is the number a purchasing-card holder reconciles against, and the one other gateways expose as a customer reference.",
    resolution: "Ask Zift where the customer PO belongs. Until then it rides in orderCode only if nothing else can.",
  },
] as const;

/** The subset of a Saleor order line this mapping needs. */
export interface SourceLine {
  productName: string;
  variantName?: string | null;
  sku?: string | null;
  quantity: number;
  unitPriceNet: number;
  /**
   * The line's net total as Saleor holds it, preferred over unitPriceNet ×
   * quantity when present. With a voucher on the order Saleor lowers both,
   * but the per-unit figure is rounded to cents and the line total is not
   * derived from it — 3 × $1,045.0033 is $3,135.01, and the order says
   * $3,135.01, not $3,135.00. Level 3 has no discount field of its own: a
   * voucher is simply lower line amounts, and they must add up to the charge.
   */
  totalNet?: number | null;
  totalTax: number;
}

/** A line's net in cents: the order's own total when it has one, else unit × quantity. */
export const lineNetCents = (line: SourceLine): number =>
  toCents(line.totalNet ?? line.unitPriceNet * line.quantity);

/** Card-network line-item limits, applied here so what we send is what we logged. */
export const DESCRIPTION_MAX_LENGTH = 35;
export const ITEM_CODE_MAX_LENGTH = 12;
export const NO_SKU = "NOSKU";

export const itemFields = (line: SourceLine): SubrecordField[] => {
  const totalCents = lineNetCents(line);

  return [
    ["code", (line.sku ?? "").slice(0, ITEM_CODE_MAX_LENGTH) || NO_SKU],
    ["quantity", line.quantity],
    [
      "description",
      [line.productName, line.variantName].filter(Boolean).join(" ").slice(0, DESCRIPTION_MAX_LENGTH),
    ],
    ["totalAmount", totalCents],
  ];
};

export interface Level3Input {
  /** Our order number. Zift caps orderCode at 17 characters. */
  orderCode: string;
  orderDate?: string | null;
  lines: SourceLine[];
  shippingNet?: number | null;
  shippingTax?: number | null;
  /** Where the goods are going. Their docs' shipping-origin twin is in the gap list. */
  destinationPostalCode?: string | null;
}

export const ORDER_CODE_MAX_LENGTH = 17;

/**
 * Zift dates are yyyyMMdd, the format their `holderBirthdate` field documents.
 * Saleor hands us ISO 8601, so the conversion is a slice — done here rather
 * than at the call site because getting it wrong produces a validation error
 * about a field nobody was thinking about.
 */
export const toZiftDate = (iso: string | null | undefined): string | undefined => {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[1]}${match[2]}${match[3]}` : undefined;
};
export const TAX_INVOICE_CODE_MAX_LENGTH = 15;

/**
 * The Level II and Level III form parameters for a transaction.
 *
 * Returned as a flat parameter map because that is what the wire takes — the
 * caller merges it into the request rather than nesting it, and `items` is
 * already encoded.
 */
export const buildLevelThreeParams = (input: Level3Input): Record<string, string | number> => {
  const lineTaxCents = input.lines.reduce((sum, line) => sum + toCents(line.totalTax), 0);
  const shippingTaxCents = toCents(input.shippingTax ?? 0);
  const shippingCents = toCents(input.shippingNet ?? 0);
  const netCents = input.lines.reduce((sum, line) => sum + lineNetCents(line), 0);
  const taxCents = lineTaxCents + shippingTaxCents;

  return {
    // Level II
    orderCode: input.orderCode.slice(0, ORDER_CODE_MAX_LENGTH),
    shippingAmount: shippingCents,
    // Domestic only. Sent explicitly rather than omitted, because a duty of
    // zero is a fact about the order and an absent field is a fact about us.
    dutyAmount: 0,
    taxAmount: taxCents,
    // Rate over the taxable base, which includes freight where freight is taxed.
    taxRate: toRate(netCents + shippingCents, taxCents),

    // Level III
    ...((): Record<string, string> => {
      const orderDate = toZiftDate(input.orderDate);
      return orderDate ? { orderDate } : {};
    })(),
    taxInvoiceCode: input.orderCode.slice(0, TAX_INVOICE_CODE_MAX_LENGTH),
    // commodityCode is deliberately absent. See MISSING_FOR_FULL_LEVEL_3.
    items: encodeSubrecords(input.lines.map(itemFields)),
  };
};

/**
 * What the line items and freight add up to, so a caller can compare it with
 * the amount it is about to charge.
 *
 * Reported rather than asserted: freight quoted after the order is exactly why
 * a charge can legitimately exceed the sum of the lines, so this module does
 * not know what the right total is. charge.ts decides.
 */
export const levelThreeTotalCents = (input: Level3Input): number =>
  input.lines.reduce((sum, line) => sum + lineNetCents(line), 0) +
  toCents(input.shippingNet ?? 0) +
  input.lines.reduce((sum, line) => sum + toCents(line.totalTax), 0) +
  toCents(input.shippingTax ?? 0);

/**
 * `holderType` must be `O` for Level II and Level III, per Zift's field docs.
 *
 * It is a claim that the cardholder is an organisation rather than a person,
 * and for a B2B catalogue of industrial machines that is nearly always true —
 * but "nearly" is doing work. A sole proprietor paying on a personal card is a
 * real DuroPC customer, and asserting O for them is asserting something false
 * to obtain a rate. Exported as a named constant so the decision is visible at
 * the call site rather than buried as a string literal.
 */
export const LEVEL_3_HOLDER_TYPE = "O";
