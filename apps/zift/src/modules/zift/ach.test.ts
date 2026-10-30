import { describe, expect, it } from "vitest";

import {
  ACCOUNT_TYPE,
  AchValidationError,
  achValidationErrors,
  buildAchSaleParams,
  buildAchVerificationParams,
  HOLDER_TYPE,
  isAchAccountType,
  isSettledOnAcceptance,
  isValidRoutingNumber,
  methodKindOf,
  normaliseRouting,
  VERIFICATION_MODE_PROCESSOR,
} from "./ach";

const account = {
  token: "tok_bank_1",
  routingNumber: "011000015",
  accountType: ACCOUNT_TYPE.checking,
  holderName: "Measurement Instruments LLC",
} as const;

describe("account type", () => {
  it("treats C and S as bank accounts and R as a card", () => {
    expect(isAchAccountType("C")).toBe(true);
    expect(isAchAccountType("S")).toBe(true);
    expect(isAchAccountType("R")).toBe(false);
    expect(isAchAccountType(undefined)).toBe(false);
  });

  it("derives the method kind, defaulting unknown values to card", () => {
    expect(methodKindOf("C")).toBe("ach");
    expect(methodKindOf("S")).toBe("ach");
    expect(methodKindOf("R")).toBe("card");
    // An unrecognised value must not become ACH: the ACH path answers Saleor
    // with a pending charge, and a card charged as pending is never collected.
    expect(methodKindOf("Z")).toBe("card");
    expect(methodKindOf(null)).toBe("card");
  });

  /** The single most important assertion in this file. */
  it("says a card settles on acceptance and a bank account does not", () => {
    expect(isSettledOnAcceptance("card")).toBe(true);
    expect(isSettledOnAcceptance("ach")).toBe(false);
  });
});

describe("routing numbers", () => {
  it("accepts published ABA numbers that pass the 3-7-1 checksum", () => {
    expect(isValidRoutingNumber("011000015")).toBe(true);
    expect(isValidRoutingNumber("021000021")).toBe(true);
    expect(isValidRoutingNumber("121000358")).toBe(true);
  });

  it("rejects a single-digit typo that would otherwise look plausible", () => {
    // 011000015 is valid; 011000016 is one keystroke away and is not.
    expect(isValidRoutingNumber("011000016")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidRoutingNumber("01100001")).toBe(false);
    expect(isValidRoutingNumber("0110000150")).toBe(false);
    expect(isValidRoutingNumber("")).toBe(false);
  });

  it("tolerates spaces and dashes as typed", () => {
    expect(isValidRoutingNumber("011-000-015")).toBe(true);
    expect(normaliseRouting("011 000 015")).toBe("011000015");
  });
});

describe("validation", () => {
  it("passes a complete account", () => {
    expect(achValidationErrors({ ...account })).toEqual([]);
  });

  it("reports every problem at once rather than one per round trip", () => {
    const errors = achValidationErrors({
      token: "",
      routingNumber: "123",
      accountType: "C",
      holderName: "",
    });

    expect(errors).toHaveLength(3);
    expect(errors.join(" ")).toContain("token");
    expect(errors.join(" ")).toContain("ABA");
    expect(errors.join(" ")).toContain("name");
  });

  it("refuses an account number in place of a token", () => {
    // There is no column for one and no code path that would accept one; this
    // asserts the empty-token refusal that stands in for that rule.
    expect(achValidationErrors({ ...account, token: "   " })[0]).toContain("never accepts");
  });
});

describe("buildAchVerificationParams", () => {
  const params = buildAchVerificationParams({ ...account });

  it("sends the routing number as accountAccessory", () => {
    // The field a card uses for its expiry. One field, two meanings.
    expect(params.accountAccessory).toBe("011000015");
  });

  it("asks the processor to verify, so a bad account is never stored", () => {
    expect(params.verificationMode).toBe(VERIFICATION_MODE_PROCESSOR);
    expect(params.verificationMode).toBe("PF");
  });

  it("defaults holderType to a business account", () => {
    expect(params.holderType).toBe(HOLDER_TYPE.business);
  });

  it("honours an explicitly authored personal holderType", () => {
    const personal = buildAchVerificationParams({
      ...account,
      holderType: HOLDER_TYPE.personal,
    });
    expect(personal.holderType).toBe("P");
  });

  it("throws on an invalid routing number rather than sending it", () => {
    expect(() => buildAchVerificationParams({ ...account, routingNumber: "011000016" })).toThrow(
      AchValidationError,
    );
  });
});

describe("buildAchSaleParams", () => {
  const params = buildAchSaleParams({ ...account, amountCents: 390000, orderCode: "1042" });

  it("debits the account in cents", () => {
    expect(params.amount).toBe(390000);
    expect(params.accountType).toBe("C");
    expect(params.token).toBe("tok_bank_1");
  });

  /** An ACH debit has no interchange, so Level III buys nothing. */
  it("sends no Level II or Level III parameters", () => {
    const keys = Object.keys(params).join(",");
    expect(keys).not.toContain("items");
    expect(keys).not.toContain("commodityCode");
    expect(keys).not.toContain("taxAmount");
    expect(keys).not.toContain("freightAmount");
  });

  it("refuses a fractional or non-positive amount", () => {
    expect(() => buildAchSaleParams({ ...account, amountCents: 100.5 })).toThrow(AchValidationError);
    expect(() => buildAchSaleParams({ ...account, amountCents: 0 })).toThrow(AchValidationError);
    expect(() => buildAchSaleParams({ ...account, amountCents: -1 })).toThrow(AchValidationError);
  });
});
