import { describe, expect, it } from "vitest";

import { verificationNotice, assessVerification } from "./verification";

describe("assessVerification", () => {
  it("reads the network codes Zift returns", () => {
    const result = assessVerification({ avsResponse: "Y", cscResponse: "M", approved: true });

    expect(result.avs.outcome).toBe("full_match");
    expect(result.csc.outcome).toBe("match");
    expect(result.approvedWithFailedVerification).toBe(false);
  });

  it("is case-insensitive, since a gateway is free to send either", () => {
    expect(assessVerification({ avsResponse: "y", approved: true }).avs.outcome).toBe("full_match");
  });

  it("flags an approval whose address check failed — the case worth a human", () => {
    // The issuer released the funds and the address did not check out. The
    // chargeback liability is ours, and nothing else in the system says so.
    expect(
      assessVerification({ avsResponse: "N", cscResponse: "M", approved: true })
        .approvedWithFailedVerification,
    ).toBe(true);
  });

  it("flags an approval whose security code failed", () => {
    expect(
      assessVerification({ avsResponse: "Y", cscResponse: "N", approved: true })
        .approvedWithFailedVerification,
    ).toBe(true);
  });

  it("does not flag a decline, which is already visible", () => {
    expect(
      assessVerification({ avsResponse: "N", cscResponse: "N", approved: false })
        .approvedWithFailedVerification,
    ).toBe(false);
  });

  it("treats an unrecognised code as unavailable, never as a pass", () => {
    const result = assessVerification({ avsResponse: "QQ", cscResponse: "ZZ", approved: true });

    expect(result.avs.outcome).toBe("unavailable");
    expect(result.csc.outcome).toBe("unavailable");
    expect(result.hasUninterpretableSignal).toBe(true);
    expect(result.approvedWithFailedVerification).toBe(false);
  });

  it("says so when no verification signal came back at all", () => {
    const result = assessVerification({ approved: true });

    expect(result.avs.code).toBeNull();
    expect(result.avs.description).toMatch(/No AVS response/);
    expect(result.hasUninterpretableSignal).toBe(false);
  });

  it("treats invalid AVS data as a failure, not as missing data", () => {
    const result = assessVerification({ avsResponse: "E", approved: true });

    expect(result.avs.outcome).toBe("invalid");
    expect(result.approvedWithFailedVerification).toBe(true);
  });
});

describe("verificationNotice", () => {
  it("names the failed check on an approval, and nothing on a clean one or a decline", () => {
    expect(verificationNotice(assessVerification({ avsResponse: "N", cscResponse: "M", approved: true }))).toBe(
      "Approved, but billing address did not match (AVS N: Neither street address nor ZIP matches)",
    );
    expect(verificationNotice(assessVerification({ avsResponse: "Y", cscResponse: "N", approved: true }))).toMatch(/security code did not match \(CSC N/);
    expect(verificationNotice(assessVerification({ avsResponse: "N", cscResponse: "N", approved: true }))).toMatch(/address did not match .* and security code did not match/);
    expect(verificationNotice(assessVerification({ avsResponse: "Y", cscResponse: "M", approved: true }))).toBeNull();
    expect(verificationNotice(assessVerification({ avsResponse: "N", approved: false }))).toBeNull();
  });
});
