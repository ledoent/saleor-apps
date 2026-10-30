/**
 * Charging a stored card — the moment money actually moves.
 *
 * Runs when AR presses Charge on an order in the Saleor dashboard: sales has
 * confirmed the order, freight has been quoted, and only then does anyone take
 * the money.
 *
 * THE AMOUNT COMES FROM SALEOR, THE LINES DESCRIBE THE BOX
 *
 * They can legitimately differ — freight quoted after the order is the ordinary
 * case, and it is why this app stores a card rather than authorising one. So
 * the charge is for what Saleor asked for, the Level III record describes what
 * is in the box, and where the two do not reconcile that fact is attached to
 * the transaction rather than quietly rounded away.
 */

import type { Params, ZiftResponse } from "./client";
import { buildLevelThreeParams, levelThreeTotalCents, LEVEL_3_HOLDER_TYPE, type SourceLine } from "./level3";
import { toCents } from "./money";
import type { Order } from "./saleor";
import { interpretTransaction, toSaleorResult } from "./transactions";
import { assessVerification } from "./verification";

export const linesFromOrder = (order: Order | null | undefined): SourceLine[] =>
  (order?.lines ?? []).map((line) => ({
    productName: line.productName ?? "Item",
    variantName: line.variantName,
    sku: line.productSku,
    quantity: line.quantity,
    unitPriceNet: line.unitPrice?.net?.amount ?? 0,
    // The order's own line total, already net of any voucher. See SourceLine.
    totalNet: line.totalPrice?.net?.amount ?? null,
    // Saleor has no per-line tax field; the gap between the gross and net line
    // totals is it, which is why the subscription asks for both.
    totalTax: line.totalPrice?.tax?.amount ?? 0,
  }));

export interface ChargeInput {
  token: string;
  /** MMYY. Zift requires it on a charge even when the card is a token. */
  accountAccessory: string;
  holderName?: string | null;
  /** Decimal dollars, as Saleor holds it. Converted here, once. */
  amount: number;
  order: Order | null | undefined;
}

export interface ChargeDeps {
  /** requestType=sale */
  sale: (params: Params) => Promise<ZiftResponse>;
}

export const buildChargeParams = (input: ChargeInput): Params => {
  const order = input.order;
  const level3 = buildLevelThreeParams({
    orderCode: order?.number ?? order?.id ?? "",
    orderDate: order?.created ?? null,
    lines: linesFromOrder(order),
    shippingNet: order?.shippingPrice?.net?.amount ?? 0,
    shippingTax: order?.shippingPrice?.tax?.amount ?? 0,
    destinationPostalCode: order?.shippingAddress?.postalCode ?? null,
  });

  return {
    accountType: "R",
    token: input.token,
    accountAccessory: input.accountAccessory,
    holderName: input.holderName ?? undefined,
    amount: toCents(input.amount),
    transactionIndustryType: "RE",
    // Required for Level II and Level III. See LEVEL_3_HOLDER_TYPE — this is a
    // claim about the cardholder, not a formatting detail.
    holderType: LEVEL_3_HOLDER_TYPE,
    street: order?.billingAddress?.streetAddress1 ?? undefined,
    zipCode: order?.billingAddress?.postalCode ?? undefined,
    ...level3,
  };
};

export interface ChargeResult {
  result: string;
  pspReference: string;
  message?: string;
  data: Record<string, unknown>;
  approved: boolean;
}

export const chargeStoredCard = async (
  input: ChargeInput,
  deps: ChargeDeps,
): Promise<ChargeResult> => {
  const order = input.order;
  const documentedCents = levelThreeTotalCents({
    orderCode: order?.number ?? "",
    lines: linesFromOrder(order),
    shippingNet: order?.shippingPrice?.net?.amount ?? 0,
    shippingTax: order?.shippingPrice?.tax?.amount ?? 0,
  });
  const chargedCents = toCents(input.amount);

  const response = await deps.sale(buildChargeParams(input));
  const outcome = interpretTransaction("sale", response);
  const base = toSaleorResult(outcome, "CHARGE");
  const verification = assessVerification({
    avsResponse: response.avsResponseCode,
    cscResponse: response.cscResponseCode,
    approved: outcome.approved,
  });

  return {
    ...base,
    approved: outcome.approved,
    data: {
      ...base.data,
      chargedCents,
      level3TotalCents: documentedCents,
      // Not an error and not hidden. Freight added after the order is the
      // expected reason these differ; anything else wants a human.
      level3Reconciles: chargedCents === documentedCents,
      lineCount: linesFromOrder(order).length,
      verification,
    },
  };
};
