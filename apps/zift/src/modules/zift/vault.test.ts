import { describe, expect, it, vi } from "vitest";

import { establishVaultCredential } from "./vault";

const approved = {
  responseType: "account-verification",
  responseCode: "A01",
  transactionId: "5001",
  token: "zift-durable-token",
  extendedAccountType: "VS",
  accountNumberMasked: "4********4242",
  holderName: "ACME Robotics",
  avsResponseCode: "Y",
  cscResponseCode: "M",
};

const input = {
  token: "proxynization-token",
  accountAccessory: "0429",
  holderName: "ACME Robotics",
  billingZip: "18042",
};

describe("establishVaultCredential", () => {
  it("stores the card and reports what a human can recognise", async () => {
    const result = await establishVaultCredential(input, {
      verify: vi.fn().mockResolvedValue(approved),
    });

    expect(result.result).toBe("AUTHORIZATION_SUCCESS");
    expect(result.card).toMatchObject({ brand: "VS", lastFour: "4242", accountAccessory: "0429" });
  });

  it("prefers the durable token the verification returns over the browser's", async () => {
    // Zift's docs describe the verification token as the one for future
    // processing; the proxynization token is transient.
    const result = await establishVaultCredential(input, {
      verify: vi.fn().mockResolvedValue(approved),
    });

    expect(result.card?.token).toBe("zift-durable-token");
  });

  it("keeps the browser's token when the gateway returns none", async () => {
    const result = await establishVaultCredential(input, {
      verify: vi.fn().mockResolvedValue({ ...approved, token: "" }),
    });

    expect(result.card?.token).toBe("proxynization-token");
  });

  it("keeps the expiry, without which the token cannot be charged", async () => {
    // Zift marks accountAccessory Required on a charge even for a tokenised
    // card. A stored token with no expiry is a card nobody can bill.
    const result = await establishVaultCredential(input, {
      verify: vi.fn().mockResolvedValue(approved),
    });

    expect(result.card?.accountAccessory).toBe("0429");
  });

  it("moves no money and places no hold — there is nothing to reverse", async () => {
    // The whole reason this module is a fraction of the size of a
    // $1-authorisation vault: a $0 verification has no dollar to void and no
    // void to fail.
    const verify = vi.fn().mockResolvedValue(approved);
    await establishVaultCredential(input, { verify });

    expect(verify).toHaveBeenCalledOnce();
    expect(JSON.stringify(verify.mock.calls[0][0])).not.toMatch(/"amount"/);
  });

  it("never sends a card number, only the token the browser produced", async () => {
    const verify = vi.fn().mockResolvedValue(approved);
    await establishVaultCredential(input, { verify });

    const body = JSON.stringify(verify.mock.calls[0][0]);
    expect(body).toContain("proxynization-token");
    expect(body).not.toMatch(/accountNumber|"pan"|csc/i);
  });

  it("refuses when Zift declines the verification", async () => {
    const result = await establishVaultCredential(input, {
      verify: vi.fn().mockResolvedValue({
        responseType: "exception",
        responseCode: "D01",
        responseMessage: "Do not honour",
      }),
    });

    expect(result.result).toBe("AUTHORIZATION_FAILURE");
    expect(result.card).toBeUndefined();
    expect(result.message).toBe("Do not honour");
  });

  it("records the verification signals even on an approval", async () => {
    const result = await establishVaultCredential(input, {
      verify: vi.fn().mockResolvedValue({ ...approved, avsResponseCode: "N" }),
    });

    expect(result.verification.approvedWithFailedVerification).toBe(true);
    // And says so where AR will read it: the transaction message.
    expect(result.message).toMatch(/^Approved, but billing address did not match \(AVS N/);
    expect(result.card).toBeDefined();
  });

  it("keeps the gateway's own message on a clean approval", async () => {
    const result = await establishVaultCredential(input, { verify: vi.fn().mockResolvedValue(approved) });
    expect(result.message ?? "").not.toMatch(/did not match/);
  });
});
