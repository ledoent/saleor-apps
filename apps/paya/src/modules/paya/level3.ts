/**
 * Level 3 line-item data for Paya (Sage Payments) commercial-card transactions.
 *
 * WHY THIS MODULE IS THE POINT OF THE APP
 *
 * Paya already attaches a *default* Level 3 record to every commercial-card
 * transaction, which is enough for partial qualification and no more. Full
 * line-item detail has to be POSTed separately to /v2/transactionlevel3s, and
 * that is what earns the interchange reduction — roughly 0.5–1.5% on a
 * commercial card. On DuroPC's ~$2,250 average order that is $11–34 per order.
 *
 * The WooCommerce gateway the legacy site used never made that call, so the
 * old store qualified on Paya's defaults only.
 *
 * TWO THINGS THAT ARE NOT OPTIONAL
 *
 *  1. Visa retired standalone Level 2 interchange on 18 April 2026 under its
 *     Commercial Enhanced Data Program. On Visa it is now full Level 3 or no
 *     discount at all. Mastercard still recognises both. That is why this
 *     module always emits the Visa-required fields rather than treating them
 *     as an enhancement.
 *
 *  2. Every POST to /v2/transactionlevel3s OVERWRITES the previous Level 3
 *     data for that transaction. Partial updates do not merge. Callers must
 *     always send the complete set — see PayaClient.replaceLevel3Data.
 */

/** A single line as Paya expects it. Field names match the API, not Saleor. */
export interface PayaLevel3LineItem {
  description: string;
  product_code: string;
  quantity: number;
  unit_code: string;
  unit_cost: number;
  tax_amount: number;
  tax_rate: number;
  /** Visa requires a commodity code per item; Mastercard ignores it. */
  commodity_code?: string;
  /** Mastercard requires a tax type when a tax amount is present. */
  tax_type_id?: string;
}

export interface PayaLevel3Data {
  transaction_id: string;
  /** Visa requires an order-level tax rate in addition to the per-item rates. */
  tax_rate: number;
  line_items: PayaLevel3LineItem[];
}

/** The subset of a Saleor checkout/order line this mapping needs. */
export interface SourceLine {
  productName: string;
  variantName?: string | null;
  sku?: string | null;
  quantity: number;
  unitPriceNet: number;
  totalTax: number;
  /** UNSPSC or similar. Absent for most catalogues; see UNCLASSIFIED below. */
  commodityCode?: string | null;
}

/**
 * UNSPSC "unable to classify". Sending a placeholder is deliberate: Visa
 * requires the field to be present, and omitting it fails the whole line
 * rather than degrading it. Populating real commodity codes per product is a
 * catalogue task that raises qualification further — tracked separately.
 */
export const UNCLASSIFIED_COMMODITY_CODE = "00000000";

/** Paya expects a unit of measure; EA (each) is correct for boxed hardware. */
export const DEFAULT_UNIT_CODE = "EA";

/** Mastercard tax type 0 = sales tax, which is what applies to US retail. */
export const TAX_TYPE_SALES_TAX = "0";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Derive a line's effective tax rate from the amounts we actually have.
 *
 * Deliberately derived rather than taken from a tax field: the rate has to
 * agree with the amounts or the processor rejects the record, and a rate
 * supplied independently of the amounts can disagree after rounding.
 */
export const deriveTaxRate = (netTotal: number, taxTotal: number): number => {
  if (netTotal <= 0 || taxTotal <= 0) {
    return 0;
  }

  return Math.round((taxTotal / netTotal) * 10000) / 10000;
};

export const mapLineToLevel3 = (line: SourceLine): PayaLevel3LineItem => {
  const netTotal = round2(line.unitPriceNet * line.quantity);
  const taxAmount = round2(line.totalTax);

  return {
    // Paya truncates long descriptions; do it here so what we send is what we
    // logged, rather than discovering the truncation in a settlement report.
    description: [line.productName, line.variantName].filter(Boolean).join(" ").slice(0, 35),
    product_code: (line.sku ?? "").slice(0, 12) || "NOSKU",
    quantity: line.quantity,
    unit_code: DEFAULT_UNIT_CODE,
    unit_cost: round2(line.unitPriceNet),
    tax_amount: taxAmount,
    tax_rate: deriveTaxRate(netTotal, taxAmount),
    commodity_code: line.commodityCode ?? UNCLASSIFIED_COMMODITY_CODE,
    tax_type_id: TAX_TYPE_SALES_TAX,
  };
};

export const buildLevel3Data = (args: {
  transactionId: string;
  lines: SourceLine[];
  /** Shipping is a line to the processor, and omitting it unbalances the total. */
  shippingNet?: number;
  shippingTax?: number;
}): PayaLevel3Data => {
  const lineItems = args.lines.map(mapLineToLevel3);

  if (args.shippingNet && args.shippingNet > 0) {
    lineItems.push(
      mapLineToLevel3({
        productName: "Shipping",
        sku: "SHIPPING",
        quantity: 1,
        unitPriceNet: args.shippingNet,
        totalTax: args.shippingTax ?? 0,
      }),
    );
  }

  const net = lineItems.reduce((sum, l) => sum + l.unit_cost * l.quantity, 0);
  const tax = lineItems.reduce((sum, l) => sum + l.tax_amount, 0);

  return {
    transaction_id: args.transactionId,
    tax_rate: deriveTaxRate(round2(net), round2(tax)),
    line_items: lineItems,
  };
};
