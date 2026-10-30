import { describe, expect, it, vi } from "vitest";

import { buildChargeParams, chargeStoredCard, linesFromOrder } from "./charge";
import type { Order } from "./saleor";

const order: Order = {
  id: "T3JkZXI6MQ==",
  number: "1042",
  created: "2026-09-09T14:21:00Z",
  billingAddress: { postalCode: "18042", streetAddress1: "12 Main St", country: { code: "US" } },
  shippingAddress: { postalCode: "18042", country: { code: "US" } },
  shippingPrice: { net: { amount: 250 }, tax: { amount: 17.5 } },
  total: { gross: { amount: 7115.5 }, currency: "USD" },
  lines: [
    {
      quantity: 2,
      productName: "DuroPC Rugged Workstation",
      variantName: "64 GB",
      productSku: "DPC-RW-64",
      unitPrice: { net: { amount: 3200 } },
      totalPrice: { net: { amount: 6400 }, tax: { amount: 448 } },
    },
  ],
};

const card = { token: "zift-token", accountAccessory: "0429", holderName: "ACME Robotics" };

describe("linesFromOrder", () => {
  it("derives per-line tax, which Saleor has no field for", () => {
    expect(linesFromOrder(order)[0]).toMatchObject({ unitPriceNet: 3200, totalNet: 6400, totalTax: 448 });
  });

  it("names a line whose product name is gone rather than sending nothing", () => {
    expect(linesFromOrder({ ...order, lines: [{ quantity: 1 }] })[0].productName).toBe("Item");
  });

  it("is empty, not undefined, for an order with no lines", () => {
    expect(linesFromOrder(null)).toEqual([]);
  });
});

describe("buildChargeParams", () => {
  it("sends the expiry alongside the token, which Zift requires", () => {
    const params = buildChargeParams({ ...card, amount: 7115.5, order });

    expect(params.token).toBe("zift-token");
    expect(params.accountAccessory).toBe("0429");
  });

  it("sends the amount in cents", () => {
    expect(buildChargeParams({ ...card, amount: 7115.5, order }).amount).toBe(711550);
  });

  it("claims an organisation holder, which Level II and III require", () => {
    expect(buildChargeParams({ ...card, amount: 100, order }).holderType).toBe("O");
  });

  it("carries the line items in the same request, not a second call", () => {
    const params = buildChargeParams({ ...card, amount: 7115.5, order });

    expect(String(params.items)).toContain("code=DPC-RW-64");
    expect(String(params.items)).toContain("totalAmount=640000");
  });
});

describe("chargeStoredCard", () => {
  const sale = (response: Record<string, string>) => ({ sale: vi.fn().mockResolvedValue(response) });
  const approved = { responseType: "sale", responseCode: "A01", transactionId: "9001" };

  it("charges the stored card and returns the sale's reference", async () => {
    const deps = sale(approved);
    const result = await chargeStoredCard({ ...card, amount: 7115.5, order }, deps);

    expect(result.result).toBe("CHARGE_SUCCESS");
    expect(result.pspReference).toBe("9001");
  });

  it("charges what Saleor asked for, even when the lines total less", async () => {
    // Freight quoted after the order is the ordinary case, and it is why this
    // app stores a card rather than authorising one.
    const deps = sale({ ...approved, transactionId: "9002" });
    const result = await chargeStoredCard({ ...card, amount: 7500, order }, deps);

    expect(deps.sale.mock.calls[0][0].amount).toBe(750000);
    expect(result.data.level3Reconciles).toBe(false);
    expect(result.data.level3TotalCents).toBe(711550);
  });

  it("says so when the lines do reconcile, so the mismatch above means something", async () => {
    const result = await chargeStoredCard({ ...card, amount: 7115.5, order }, sale(approved));

    expect(result.data.level3Reconciles).toBe(true);
  });

  it("fails an unrecognised response rather than marking the order paid", async () => {
    const result = await chargeStoredCard(
      { ...card, amount: 100, order },
      sale({ responseType: "who-knows", transactionId: "1" }),
    );

    expect(result.result).toBe("CHARGE_FAILURE");
    expect(result.approved).toBe(false);
  });

  it("still charges an order whose lines did not come through", async () => {
    // A Level 3 record we cannot build is lost interchange. Refusing to take
    // the money over it would be worse.
    const result = await chargeStoredCard({ ...card, amount: 100, order: null }, sale(approved));

    expect(result.result).toBe("CHARGE_SUCCESS");
    expect(result.data.lineCount).toBe(0);
  });
});
