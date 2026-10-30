import { describe, expect, it } from "vitest";

import { toCents, toDollars, toRate } from "./money";

describe("toCents", () => {
  it("converts the ordinary case", () => {
    expect(toCents(71.16)).toBe(7116);
    expect(toCents(3200)).toBe(320000);
  });

  it("rounds rather than truncating", () => {
    // 71.155 * 100 is exactly 7115.5, so Math.trunc gives 7115 and the Level 3
    // record then fails to reconcile by a cent — rejected in full, not accepted
    // approximately.
    expect(toCents(71.155)).toBe(7116);
    expect(toCents(8.475)).toBe(848);
  });

  it("survives the multiply's own error, which plain rounding does not", () => {
    // 0.145 * 100 is 14.499999999999998 and 1.005 * 100 is 100.49999999999999.
    // Math.round on those gives 14 and 100 — a cent short of the decimal
    // answer, because the multiply destroyed the information before the
    // rounding ran. This is the case a naive implementation gets wrong and
    // nobody notices until a Level 3 record is rejected.
    expect(toCents(0.145)).toBe(15);
    expect(toCents(1.005)).toBe(101);
  });

  it("is zero for nothing, rather than NaN reaching the wire", () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("handles the largest order in the catalogue without losing precision", () => {
    expect(toCents(21499.99)).toBe(2149999);
  });
});

describe("toDollars", () => {
  it("round-trips", () => {
    expect(toDollars(toCents(7115.5))).toBe(7115.5);
  });
});

describe("toRate", () => {
  it("uses two implied decimal places, as Zift documents", () => {
    // Their example: 150 = 1.5%, 1000 = 10%.
    expect(toRate(10000, 150)).toBe(150);
    expect(toRate(10000, 1000)).toBe(1000);
  });

  it("is zero when there is no tax, rather than dividing by nothing", () => {
    expect(toRate(10000, 0)).toBe(0);
    expect(toRate(0, 0)).toBe(0);
  });

  it("never returns a negative rate from a credit line", () => {
    expect(toRate(-100, 700)).toBe(0);
  });
});
