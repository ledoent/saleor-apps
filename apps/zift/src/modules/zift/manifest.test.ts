import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TRANSACTION_CHARGE_REQUESTED } from "@/lib/subscriptions";

/**
 * Guards the failure mode that left the tax app deployed and inert for 149
 * days: a webhook declared but not handled, or handled but not declared. Both
 * are silent at runtime, and only one of them is visible in a code review.
 */
const manifest = readFileSync("src/pages/api/manifest.ts", "utf8");
const handlerFiles = readdirSync("src/pages/api/webhooks").map((f) => f.replace(/\.ts$/, ""));

const REQUIRED_EVENTS = [
  "PAYMENT_GATEWAY_INITIALIZE_SESSION",
  "TRANSACTION_INITIALIZE_SESSION",
  "TRANSACTION_PROCESS_SESSION",
  "TRANSACTION_CHARGE_REQUESTED",
  "TRANSACTION_REFUND_REQUESTED",
  "TRANSACTION_CANCELATION_REQUESTED",
];

describe("manifest", () => {
  it.each(REQUIRED_EVENTS)("declares %s", (event) => {
    expect(manifest).toContain(`"${event}"`);
  });

  it("declares TRANSACTION_INITIALIZE_SESSION, without which the app is invisible at checkout", () => {
    // availablePaymentGateways returns only apps with an active webhook for
    // this event. Missing it means the gateway never appears — no error.
    expect(manifest).toContain('"TRANSACTION_INITIALIZE_SESSION"');
  });

  it("has a handler file for every declared webhook target", () => {
    const targets = [...manifest.matchAll(/"([a-z-]+)",\s*\n\s*\)/g)].map((m) => m[1]);
    const declared = targets.filter((t) => t.includes("-"));

    // Guard the guard: if the extraction regex stops matching after a
    // reformat, the loop below runs zero times and the test passes while
    // checking nothing.
    expect(declared).toHaveLength(REQUIRED_EVENTS.length);

    for (const target of declared) {
      expect(handlerFiles).toContain(target);
    }
  });

  it("requests HANDLE_PAYMENTS, without which Saleor rejects the install", () => {
    expect(manifest).toContain('"HANDLE_PAYMENTS"');
  });

  it("has an app id of its own, so installing one cannot replace another", () => {
    expect(manifest).toContain('id: "duropc.zift"');
  });
});

describe("handlers", () => {
  it("has exactly the six payment handlers", () => {
    expect(handlerFiles.sort()).toEqual(
      [
        "payment-gateway-initialize-session",
        "transaction-cancelation-requested",
        "transaction-charge-requested",
        "transaction-initialize-session",
        "transaction-process-session",
        "transaction-refund-requested",
      ].sort(),
    );
  });

  it.each(handlerFiles)("%s disables the body parser, required for signature checks", (file) => {
    const src = readFileSync(`src/pages/api/webhooks/${file}.ts`, "utf8");

    expect(src).toContain("bodyParser: false");
  });

  it.each(handlerFiles)("%s reports SUCCESS only after something actually happened", (file) => {
    const src = readFileSync(`src/pages/api/webhooks/${file}.ts`, "utf8");
    const successes = [...src.matchAll(/result: "([A-Z_]*SUCCESS)"/g)].map((m) => m[1]);

    // Nothing may look paid for that has not been. A handler is allowed to
    // hard-code a SUCCESS only where the success is a statement about doing
    // nothing — the cancel handler's "this transaction never charged" — and
    // that one carries `voided: false` to say so. Everywhere else the result
    // has to come back from a module that called Zift.
    for (const success of successes) {
      expect(src, `${file} hard-codes ${success}`).toMatch(/voided: false/);
    }
  });

  it("charges only from the handler that AR's Charge button reaches", () => {
    // A second code path to money is a second place for it to go wrong.
    const chargers = handlerFiles.filter((file) =>
      readFileSync(`src/pages/api/webhooks/${file}.ts`, "utf8").includes("chargeStoredCard"),
    );

    expect(chargers).toEqual(["transaction-charge-requested"]);
  });
});

describe("subscriptions", () => {
  it("asks for order lines on the charge event, or every charge is Level 1", () => {
    // Asserted on the resolved query, not the source text: the fields live in
    // an interpolated constant, so reading the file would only prove that the
    // interpolation is spelled correctly.
    expect(TRANSACTION_CHARGE_REQUESTED).toContain("order {");
    expect(TRANSACTION_CHARGE_REQUESTED).toContain("productSku");
    expect(TRANSACTION_CHARGE_REQUESTED).toContain("shippingPrice");
  });

  it("asks for both net and tax on line totals, since Saleor has no per-line tax field", () => {
    expect(TRANSACTION_CHARGE_REQUESTED).toContain("totalPrice { net { amount } tax { amount } }");
  });

  it("asks for the PO number, which is the Level 3 customer reference", () => {
    expect(TRANSACTION_CHARGE_REQUESTED).toContain('poNumber: metafield(key: "poNumber")');
  });
});
