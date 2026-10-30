import { describe, expect, it } from "vitest";

import {
  LEVEL_3_HOLDER_TYPE,
  MISSING_FOR_FULL_LEVEL_3,
  ORDER_CODE_MAX_LENGTH,
  buildLevelThreeParams,
  itemFields,
  levelThreeTotalCents,
  lineNetCents,
  toZiftDate,
} from "./level3";
import { encodeSubrecords } from "./subrecord";

const line = {
  productName: "DuroPC Rugged Workstation",
  variantName: "64 GB",
  sku: "DPC-RW-64",
  quantity: 2,
  unitPriceNet: 3200,
  totalTax: 448,
};

const input = {
  orderCode: "1042",
  orderDate: "2026-09-09T14:21:00Z",
  lines: [line],
  shippingNet: 250,
  shippingTax: 17.5,
  destinationPostalCode: "18042",
};

describe("toZiftDate", () => {
  it("converts Saleor's ISO timestamp to Zift's yyyyMMdd", () => {
    expect(toZiftDate("2026-09-09T14:21:00Z")).toBe("20260909");
  });

  it("is absent rather than malformed for anything else", () => {
    expect(toZiftDate(null)).toBeUndefined();
    expect(toZiftDate("last Tuesday")).toBeUndefined();
  });
});

describe("itemFields", () => {
  it("carries the amounts in cents", () => {
    expect(Object.fromEntries(itemFields(line))).toMatchObject({
      code: "DPC-RW-64",
      quantity: 2,
      totalAmount: 640000,
    });
  });

  it("truncates here rather than leaving it to the gateway", () => {
    // What we send is what we logged. A description silently shortened at the
    // far end is one nobody can reconcile against our own record.
    const fields = Object.fromEntries(
      itemFields({ ...line, productName: "A".repeat(60), sku: "B".repeat(40) }),
    );

    expect(String(fields.description)).toHaveLength(35);
    expect(String(fields.code)).toHaveLength(12);
  });

  it("names a line with no SKU rather than sending an empty code", () => {
    expect(Object.fromEntries(itemFields({ ...line, sku: null })).code).toBe("NOSKU");
  });
});

describe("buildLevelThreeParams", () => {
  it("sends every amount as an integer of cents", () => {
    const params = buildLevelThreeParams(input);

    expect(params.shippingAmount).toBe(25000);
    // Line tax plus tax on freight, which no line item carries.
    expect(params.taxAmount).toBe(46550);
    expect(Number.isInteger(params.shippingAmount)).toBe(true);
    expect(Number.isInteger(params.taxAmount)).toBe(true);
  });

  it("derives the tax rate with two implied decimals over the taxable base", () => {
    // 465.50 on 6650.00 is 7%, and Zift wants 700.
    expect(buildLevelThreeParams(input).taxRate).toBe(700);
  });

  it("encodes items as one subrecord run, not a JSON array", () => {
    expect(buildLevelThreeParams(input).items).toBe(encodeSubrecords([itemFields(line)]));
  });

  it("sends a zero duty explicitly, because that is a fact about the order", () => {
    expect(buildLevelThreeParams(input).dutyAmount).toBe(0);
  });

  it("truncates the order code to Zift's limit", () => {
    const params = buildLevelThreeParams({ ...input, orderCode: "X".repeat(40) });

    expect(String(params.orderCode)).toHaveLength(ORDER_CODE_MAX_LENGTH);
  });

  it("omits commodityCode rather than inventing four characters", () => {
    // Acquirer-designated, and nobody has told us the value set. An
    // unrecognised code can fail the record outright, where an absent optional
    // field degrades to Level II.
    expect(buildLevelThreeParams(input)).not.toHaveProperty("commodityCode");
  });

  it("survives an order with no shipping at all", () => {
    const params = buildLevelThreeParams({ ...input, shippingNet: null, shippingTax: null });

    expect(params.shippingAmount).toBe(0);
    expect(params.taxAmount).toBe(44800);
  });
});

describe("levelThreeTotalCents", () => {
  it("adds up to what the lines, freight and tax describe", () => {
    expect(levelThreeTotalCents(input)).toBe(640000 + 25000 + 44800 + 1750);
  });
});

describe("a voucher on the order", () => {
  // 5 % off 3 × $1,100: Saleor's unit is $1,045 and the line total $3,135.
  // With a per-unit rounding the two can differ by a cent; the line total is
  // what the order says, so it is what the card record says.
  const discounted = { ...line, quantity: 3, unitPriceNet: 1045, totalNet: 3135.01, totalTax: 188.1 };

  it("prefers the order's line total to unit × quantity", () => {
    expect(lineNetCents(discounted)).toBe(313501);
    expect(lineNetCents({ ...discounted, totalNet: null })).toBe(313500);
    expect(lineNetCents({ ...discounted, totalNet: undefined })).toBe(313500);
    expect(Object.fromEntries(itemFields(discounted)).totalAmount).toBe(313501);
  });

  it("carries no discount field: the lower line amounts are the discount, and they add up to the charge", () => {
    const params = buildLevelThreeParams({ ...input, lines: [discounted] });
    expect(Object.keys(params).some((k) => /discount/i.test(k))).toBe(false);
    expect(params.items).toContain("totalAmount=313501");
    expect(levelThreeTotalCents({ ...input, lines: [discounted] })).toBe(313501 + 25000 + 18810 + 1750);
  });
});

describe("the gaps", () => {
  it("names every field we cannot fill, so the list is the answer to 'does Level 3 qualify?'", () => {
    const fields = MISSING_FOR_FULL_LEVEL_3.map((g) => g.field);

    expect(fields).toContain("commodityCode");
    expect(fields).toContain("shippingOriginZipCode");
    expect(fields).toContain("the buyer's PO number");
  });

  it("gives each gap a resolution rather than only a complaint", () => {
    for (const gap of MISSING_FOR_FULL_LEVEL_3) {
      expect(gap.resolution.length, gap.field).toBeGreaterThan(20);
    }
  });
});

describe("LEVEL_3_HOLDER_TYPE", () => {
  it("is O, which Zift requires for Level II and III", () => {
    // A named constant because it is a claim that the cardholder is an
    // organisation, not a formatting detail. A sole proprietor on a personal
    // card is a real DuroPC customer.
    expect(LEVEL_3_HOLDER_TYPE).toBe("O");
  });
});
