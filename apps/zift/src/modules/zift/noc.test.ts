import { describe, expect, it } from "vitest";

import { interpretNotice, isKnownNocCode, NOC_EVENT_CODE } from "./noc";

const notice = (fields: Record<string, string>) => ({
  eventCode: NOC_EVENT_CODE,
  ...fields,
});

describe("code table", () => {
  it("knows the six codes Zift documents", () => {
    for (const code of ["C01", "C02", "C03", "C04", "C05", "C06"]) {
      expect(isKnownNocCode(code)).toBe(true);
    }
    expect(isKnownNocCode("C07")).toBe(false);
  });
});

describe("applying a notice", () => {
  it("C01 replaces the token", () => {
    const result = interpretNotice(
      notice({ responseCode: "C01", tokenOriginal: "old", tokenUpdated: "new" }),
    );

    expect(result).toMatchObject({
      applicable: true,
      code: "C01",
      matchToken: "old",
      patch: { token: "new" },
    });
  });

  it("C02 replaces the routing number", () => {
    const result = interpretNotice(
      notice({
        responseCode: "C02",
        tokenOriginal: "old",
        accountAccessoryUpdated: "021000021",
      }),
    );

    expect(result).toMatchObject({
      applicable: true,
      patch: { accountAccessory: "021000021" },
    });
  });

  it("C03 replaces both", () => {
    const result = interpretNotice(
      notice({
        responseCode: "C03",
        tokenOriginal: "old",
        tokenUpdated: "new",
        accountAccessoryUpdated: "121000358",
      }),
    );

    expect(result).toMatchObject({
      applicable: true,
      patch: { token: "new", accountAccessory: "121000358" },
    });
  });

  it("C04 replaces the holder name, which is a documented cause of returns", () => {
    const result = interpretNotice(
      notice({
        responseCode: "C04",
        tokenOriginal: "old",
        holderNameUpdated: "Measurement Instruments LLC",
      }),
    );

    expect(result).toMatchObject({
      applicable: true,
      patch: { holderName: "Measurement Instruments LLC" },
    });
  });

  it("C05 replaces the account type and the token together", () => {
    const result = interpretNotice(
      notice({
        responseCode: "C05",
        tokenOriginal: "old",
        tokenUpdated: "new",
        accountTypeUpdated: "S",
      }),
    );

    expect(result).toMatchObject({
      applicable: true,
      patch: { token: "new", accountType: "S" },
    });
  });

  it("is case and whitespace tolerant about the code", () => {
    const result = interpretNotice(
      notice({ responseCode: " c01 ", tokenOriginal: "old", tokenUpdated: "new" }),
    );
    expect(result.applicable).toBe(true);
  });
});

/**
 * Every refusal must carry a reason. An unapplied NOC is a debit that will
 * return again, so silence here is the expensive failure.
 */
describe("refusals", () => {
  it("refuses an unknown change code and says the account is stale", () => {
    const result = interpretNotice(
      notice({ responseCode: "C13", tokenOriginal: "old", tokenUpdated: "new" }),
    );

    expect(result.applicable).toBe(false);
    if (result.applicable) throw new Error("unreachable");
    expect(result.reason).toContain("C13");
    expect(result.reason).toContain("needs a person");
  });

  it("refuses a notice with no tokenOriginal to match on", () => {
    const result = interpretNotice(notice({ responseCode: "C01", tokenUpdated: "new" }));

    expect(result.applicable).toBe(false);
    if (result.applicable) throw new Error("unreachable");
    expect(result.reason).toContain("tokenOriginal");
  });

  it("refuses an incomplete correction rather than half-applying it", () => {
    // C03 must carry both; with only the token this would leave the rejected
    // routing number in place and look like a success.
    const result = interpretNotice(
      notice({ responseCode: "C03", tokenOriginal: "old", tokenUpdated: "new" }),
    );

    expect(result.applicable).toBe(false);
    if (result.applicable) throw new Error("unreachable");
    expect(result.reason).toContain("accountAccessoryUpdated");
  });

  it("refuses a corrected routing number that fails the ABA checksum", () => {
    const result = interpretNotice(
      notice({ responseCode: "C02", tokenOriginal: "old", accountAccessoryUpdated: "011000016" }),
    );

    expect(result.applicable).toBe(false);
    if (result.applicable) throw new Error("unreachable");
    expect(result.reason).toContain("checksum");
  });

  it("refuses an account type that is neither checking nor savings", () => {
    const result = interpretNotice(
      notice({
        responseCode: "C05",
        tokenOriginal: "old",
        tokenUpdated: "new",
        accountTypeUpdated: "R",
      }),
    );

    expect(result.applicable).toBe(false);
    if (result.applicable) throw new Error("unreachable");
    expect(result.reason).toContain("neither");
  });

  it("refuses a notification that is not a Notice of Change at all", () => {
    const result = interpretNotice({
      eventCode: "processing.transaction-settled",
      responseCode: "C01",
      tokenOriginal: "old",
      tokenUpdated: "new",
    });

    expect(result.applicable).toBe(false);
    if (result.applicable) throw new Error("unreachable");
    expect(result.reason).toContain("Not a Notice of Change");
  });

  it("refuses a notice with no code", () => {
    const result = interpretNotice(notice({ tokenOriginal: "old" }));
    expect(result.applicable).toBe(false);
  });
});
