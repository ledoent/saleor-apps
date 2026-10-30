import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_TYPE } from "./ach";
import { debitBankAccount, establishAchCredential } from "./ach-vault";
import { ZiftClient } from "./client";
import { mockFetch, resetMockSequence } from "./mock";

const account = {
  token: "tok_bank_1",
  routingNumber: "011000015",
  accountType: ACCOUNT_TYPE.checking,
  holderName: "Measurement Instruments LLC",
} as const;

const approvedVerification = {
  responseType: "account-verification",
  responseCode: "A01",
  responseMessage: "Approved",
  transactionId: "TXN-1",
  token: "tok_durable",
  accountNumberMasked: "*****7890",
  holderName: "Measurement Instruments LLC",
};

describe("establishAchCredential", () => {
  it("stores the durable token the verification returns, not the browser's", () => {
    return establishAchCredential(account, {
      verify: async () => approvedVerification,
    }).then((result) => {
      expect(result.account?.token).toBe("tok_durable");
      expect(result.account?.accountType).toBe("C");
      expect(result.account?.accountAccessory).toBe("011000015");
      expect(result.account?.lastFour).toBe("7890");
    });
  });

  it("asks the processor to verify before anything is stored", async () => {
    const verify = vi.fn().mockResolvedValue(approvedVerification);
    await establishAchCredential(account, { verify });

    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ verificationMode: "PF", accountType: "C" }),
    );
  });

  it("stores nothing when the verification is declined", async () => {
    const result = await establishAchCredential(account, {
      verify: async () => ({
        responseType: "exception",
        responseCode: "V01",
        responseMessage: "Account could not be validated.",
      }),
    });

    expect(result.account).toBeUndefined();
    expect(result.result).toBe("AUTHORIZATION_FAILURE");
    expect(result.message).toContain("could not be validated");
  });

  /**
   * There is no address verification on a bank account. Reporting one would be
   * a confident answer to a question nobody asked the processor.
   */
  it("reports no AVS or CSC assessment", async () => {
    const result = await establishAchCredential(account, {
      verify: async () => approvedVerification,
    });

    expect(JSON.stringify(result.data)).not.toContain("avs");
    expect(result.data).not.toHaveProperty("verification");
  });
});

describe("debitBankAccount", () => {
  const accepted = {
    responseType: "sale",
    responseCode: "A01",
    responseMessage: "Accepted for processing. Not settled.",
    transactionId: "TXN-SALE-1",
  };

  /**
   * THE ASSERTION THIS WHOLE MODULE EXISTS FOR.
   *
   * An accepted ACH debit must not produce a success result. Saleor reads the
   * absence of `result` as the async flow and records a pending CHARGE_REQUEST;
   * a CHARGE_SUCCESS here would mark the order paid days before the money
   * arrives, and the debit can still be returned after that.
   */
  it("returns NO result on an acceptance, so the charge stays pending", async () => {
    const debit = await debitBankAccount(
      { ...account, amountCents: 390000 },
      { sale: async () => accepted },
    );

    expect(debit.accepted).toBe(true);
    expect(debit.result).toBeUndefined();
    expect(debit.pspReference).toBe("TXN-SALE-1");
  });

  it("never reports the debit as settled", async () => {
    const debit = await debitBankAccount(
      { ...account, amountCents: 390000 },
      { sale: async () => accepted },
    );

    expect(debit.data.settled).toBe(false);
    expect(debit.message).toContain("not paid until settlement");
  });

  it("returns CHARGE_FAILURE on a rejection", async () => {
    const debit = await debitBankAccount(
      { ...account, amountCents: 390000 },
      {
        sale: async () => ({
          responseType: "exception",
          responseCode: "R02",
          responseMessage: "Account closed.",
        }),
      },
    );

    expect(debit.accepted).toBe(false);
    expect(debit.result).toBe("CHARGE_FAILURE");
    expect(debit.data.settled).toBe(false);
  });

  it("treats an unrecognised response as a failure, never an acceptance", async () => {
    const debit = await debitBankAccount(
      { ...account, amountCents: 390000 },
      { sale: async () => ({ responseType: "something-new", transactionId: "TXN-9" }) },
    );

    expect(debit.accepted).toBe(false);
    expect(debit.result).toBe("CHARGE_FAILURE");
  });
});

/** The same paths through the real client and the mock transport. */
describe("against the mock gateway", () => {
  beforeEach(() => {
    resetMockSequence();
  });

  const client = () =>
    new ZiftClient(
      {
        configured: true,
        environment: "mock",
        userName: "mock",
        password: "mock",
        accountId: "mock",
        gatewayUrl: "mock://zift/gates/xurl",
        proxynizationScriptUrl: "/api/mock/proxynization",
      },
      mockFetch,
    );

  const mintedToken = "ziftmock-ach-checking-approved-abc12345";

  it("verifies a published test bank account", async () => {
    const result = await establishAchCredential(
      { ...account, token: mintedToken },
      { verify: (params) => client().request("account-verification", params) },
    );

    expect(result.result).toBe("AUTHORIZATION_SUCCESS");
    expect(result.account?.lastFour).toBe("7890");
  });

  it("accepts a debit but leaves it pending", async () => {
    const debit = await debitBankAccount(
      { ...account, token: mintedToken, amountCents: 390000 },
      { sale: (params) => client().request("sale", params) },
    );

    expect(debit.accepted).toBe(true);
    expect(debit.result).toBeUndefined();
    expect(debit.data.settled).toBe(false);
  });

  it("refuses a card token sent with a bank account type", async () => {
    const debit = await debitBankAccount(
      { ...account, token: "ziftmock-visa-approved-abc12345", amountCents: 390000 },
      { sale: (params) => client().request("sale", params) },
    );

    expect(debit.accepted).toBe(false);
  });

  it("refuses a routing number the test account was not minted for", async () => {
    const debit = await debitBankAccount(
      { ...account, token: mintedToken, routingNumber: "021000021", amountCents: 390000 },
      { sale: (params) => client().request("sale", params) },
    );

    expect(debit.accepted).toBe(false);
  });

  it("declines the account whose verification fails, storing nothing", async () => {
    const result = await establishAchCredential(
      {
        ...account,
        token: "ziftmock-ach-verification-declined-abc12345",
        routingNumber: "121000358",
      },
      { verify: (params) => client().request("account-verification", params) },
    );

    expect(result.account).toBeUndefined();
    expect(result.result).toBe("AUTHORIZATION_FAILURE");
  });
});
