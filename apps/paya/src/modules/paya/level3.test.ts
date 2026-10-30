import { describe, expect, it } from "vitest";

import { buildLevel3Data, deriveTaxRate, mapLineToLevel3 } from "./level3";

describe("deriveTaxRate", () => {
  it("derives the rate from the amounts rather than trusting a supplied rate", () => {
    expect(deriveTaxRate(1000, 82.5)).toBe(0.0825);
  });

  it("returns zero for tax-exempt lines instead of dividing by zero", () => {
    expect(deriveTaxRate(1000, 0)).toBe(0);
    expect(deriveTaxRate(0, 0)).toBe(0);
  });
});

describe("mapLineToLevel3", () => {
  it("always emits the Visa-required commodity code, since a missing one fails the line", () => {
    const line = mapLineToLevel3({
      productName: "R708-2 2U Industrial Rackmount",
      quantity: 1,
      unitPriceNet: 2250,
      totalTax: 185.63,
      sku: "R708-2-1",
    });

    expect(line.commodity_code).toBe("00000000");
    expect(line.tax_type_id).toBe("0");
    expect(line.unit_code).toBe("EA");
  });

  it("truncates the description here so the log matches what Paya stores", () => {
    const line = mapLineToLevel3({
      productName: "R708-2 2U 12th/13th/14th Gen Industrial Rackmount with 3x PCI",
      quantity: 1,
      unitPriceNet: 2250,
      totalTax: 0,
    });

    expect(line.description.length).toBeLessThanOrEqual(35);
  });

  it("substitutes a placeholder rather than sending an empty product code", () => {
    expect(mapLineToLevel3({ productName: "X", quantity: 1, unitPriceNet: 10, totalTax: 0 }).product_code).toBe(
      "NOSKU",
    );
  });
});

describe("buildLevel3Data", () => {
  it("includes shipping as a line, because omitting it unbalances the total", () => {
    const data = buildLevel3Data({
      transactionId: "txn_1",
      lines: [{ productName: "R708-2", sku: "R708-2-1", quantity: 2, unitPriceNet: 2250, totalTax: 371.25 }],
      shippingNet: 85,
      shippingTax: 7.01,
    });

    expect(data.line_items).toHaveLength(2);
    expect(data.line_items[1].product_code).toBe("SHIPPING");
  });

  it("carries an order-level tax rate, which Visa requires alongside the per-item rates", () => {
    const data = buildLevel3Data({
      transactionId: "txn_2",
      lines: [{ productName: "R708-2", quantity: 1, unitPriceNet: 1000, totalTax: 82.5 }],
    });

    expect(data.tax_rate).toBe(0.0825);
  });
});
