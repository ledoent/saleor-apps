import { describe, expect, it } from "vitest";

import { interpretTransaction, toSaleorResult } from "./transactions";

describe("interpretTransaction", () => {
  it("approves when responseType echoes the request", () => {
    const outcome = interpretTransaction("sale", {
      responseType: "sale",
      responseCode: "A01",
      transactionId: "1042465",
    });

    expect(outcome.verdict).toBe("approved");
    expect(outcome.approved).toBe(true);
    expect(outcome.reference).toBe("1042465");
  });

  it("declines an exception, which is what Zift actually returned to us", () => {
    // Observed against the sandbox with deliberately wrong credentials.
    const outcome = interpretTransaction("sale", {
      responseType: "exception",
      responseCode: "L01",
      responseMessage: "Username or password is invalid.",
      failureCode: "L01",
      failureMessage: "Username or password is invalid.",
    });

    expect(outcome.verdict).toBe("declined");
    expect(outcome.approved).toBe(false);
    expect(outcome.message).toBe("Username or password is invalid.");
    expect(outcome.code).toBe("L01");
  });

  it("calls anything else unknown, never approved", () => {
    // The rule the whole module exists for: a shape nobody has seen is not
    // evidence of a payment.
    const outcome = interpretTransaction("sale", { responseType: "something-new", transactionId: "1" });

    expect(outcome.verdict).toBe("unknown");
    expect(outcome.approved).toBe(false);
    expect(outcome.message).toMatch(/does not recognise/);
  });

  it("is unknown for an empty response rather than optimistic", () => {
    expect(interpretTransaction("sale", {}).verdict).toBe("unknown");
  });

  it("refuses to approve a transaction it could not name", () => {
    // Approved with no transactionId is unusable: nothing could void or refund
    // it later, so treating it as a success strands a real charge.
    const outcome = interpretTransaction("sale", { responseType: "sale", responseCode: "A01" });

    expect(outcome.verdict).toBe("approved");
    expect(outcome.approved).toBe(false);
  });

  it("does not confuse one request type's echo for another's", () => {
    // A refund response arriving where a sale was expected is not a sale.
    const outcome = interpretTransaction("sale", { responseType: "refund", transactionId: "9" });

    expect(outcome.verdict).toBe("unknown");
  });

  it("falls back to failureMessage when responseMessage is absent", () => {
    expect(
      interpretTransaction("void", { responseType: "exception", failureMessage: "Already settled" })
        .message,
    ).toBe("Already settled");
  });
});

describe("toSaleorResult", () => {
  it("names the action in the result", () => {
    const approved = interpretTransaction("sale", { responseType: "sale", transactionId: "7" });

    expect(toSaleorResult(approved, "CHARGE").result).toBe("CHARGE_SUCCESS");
    expect(toSaleorResult(approved, "AUTHORIZATION").result).toBe("AUTHORIZATION_SUCCESS");
  });

  it("fails an unknown verdict, whatever the action", () => {
    const unknown = interpretTransaction("sale", { transactionId: "7" });

    expect(toSaleorResult(unknown, "CHARGE").result).toBe("CHARGE_FAILURE");
    expect(toSaleorResult(unknown, "REFUND").result).toBe("REFUND_FAILURE");
  });

  it("attaches the gateway's own reply for reconciliation", () => {
    const result = toSaleorResult(
      interpretTransaction("sale", { responseType: "sale", transactionId: "7", responseCode: "A01" }),
      "CHARGE",
    );

    expect(result.data.zift).toMatchObject({ transactionId: "7" });
    expect(result.data.code).toBe("A01");
    expect(result.pspReference).toBe("7");
  });
});
