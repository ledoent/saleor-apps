import { beforeEach, describe, expect, it } from "vitest";

import { ZiftClient, type Params } from "./client";
import { resolveConfig, type ZiftConfig } from "./config";
import { clientFor } from "./gateway";
import {
  cardForToken,
  findMockCardByPan,
  MOCK_CARDS,
  MOCK_GATEWAY_URL,
  MOCK_TOKEN_PREFIX,
  mintMockToken,
  mockFetch,
  resetMockSequence,
} from "./mock";
import { interpretTransaction } from "./transactions";
import { establishVaultCredential } from "./vault";

const mockConfig = resolveConfig({ environment: "mock" }) as ZiftConfig;
const client = () => new ZiftClient(mockConfig, mockFetch);

const verify = (params: Params) => client().request("account-verification", params);

beforeEach(() => resetMockSequence());

describe("the safety rule", () => {
  it("never approves a token it did not mint", async () => {
    // THE rule. A half-configured environment where the browser talks to a real
    // Zift while the server is in mock mode must not produce a stored card that
    // no processor has heard of — an order that cannot be collected is worse
    // than one that was never taken.
    for (const token of ["", "abc123", "PROXY-9f3c-real-looking", "ziftmock", "ziftmock-nope-x"]) {
      const response = await verify({ token, accountAccessory: "1230", holderName: "A Buyer" });
      expect(interpretTransaction("account-verification", response).approved, token).toBe(false);
    }
  });

  it("cannot be made to approve by supplying a raw card number as the token", async () => {
    // The PAN never reaches the gateway in the real flow either, but a mock
    // that accepted one would teach the wrong lesson and tempt the shortcut.
    const response = await verify({
      token: "4111111111111111",
      accountAccessory: "1230",
      holderName: "A Buyer",
    });
    expect(interpretTransaction("account-verification", response).approved).toBe(false);
  });

  it("refuses every request type except account-verification", async () => {
    // Charge and refund are AR's path against a real processor. A mocked
    // approval there would be a fake receipt for a machine on a truck.
    for (const type of ["sale", "capture", "refund", "credit", "void"] as const) {
      const response = await client().request(type, { token: mintMockToken("visa-approved") });
      expect(interpretTransaction(type, response).approved, type).toBe(false);
      expect(response.responseMessage).toContain("account-verification only");
    }
  });
});

describe("the test cards", () => {
  it("approves the two approving cards and declines the declining one", async () => {
    const outcomes = await Promise.all(
      MOCK_CARDS.map(async (card) => {
        const response = await verify({
          token: mintMockToken(card.scenario),
          accountAccessory: "1230",
          holderName: "A Buyer",
        });
        return [card.scenario, interpretTransaction("account-verification", response).approved] as const;
      }),
    );

    expect(Object.fromEntries(outcomes)).toEqual({
      "visa-approved": true,
      "mc-commercial-approved": true,
      "visa-declined": false,
      "visa-avs-mismatch": true,
    });
  });

  it("tolerates spaces and dashes, because a tester types them", () => {
    expect(findMockCardByPan("4111 1111 1111 1111")?.scenario).toBe("visa-approved");
    expect(findMockCardByPan("4111-1111-1111-1111")?.scenario).toBe("visa-approved");
    expect(findMockCardByPan("4111111111111112")).toBeNull();
  });

  it("has no duplicate PANs or scenarios", () => {
    expect(new Set(MOCK_CARDS.map((c) => c.pan)).size).toBe(MOCK_CARDS.length);
    expect(new Set(MOCK_CARDS.map((c) => c.scenario)).size).toBe(MOCK_CARDS.length);
  });
});

describe("tokens", () => {
  it("carries the scenario, never the card number", () => {
    // A string of sixteen digits flowing through logs, a database and a Saleor
    // transaction is a shape that invites being treated as a real PAN.
    for (const card of MOCK_CARDS) {
      const token = mintMockToken(card.scenario);
      expect(token.startsWith(`${MOCK_TOKEN_PREFIX}-`)).toBe(true);
      expect(token).not.toContain(card.pan);
      expect(cardForToken(token)?.pan).toBe(card.pan);
    }
  });

  it("round-trips a scenario whose name contains dashes", () => {
    // The nonce is the last segment; everything between prefix and nonce is the
    // scenario. `mc-commercial-approved` is the case that breaks a naive split.
    expect(cardForToken(mintMockToken("mc-commercial-approved"))?.brand).toBe("MASTERCARD");
  });
});

describe("through the real vault path", () => {
  it("stores a card, and reports the AVS gap on the card that has one", async () => {
    const approved = await establishVaultCredential(
      { token: mintMockToken("visa-approved"), accountAccessory: "1230", holderName: "A Buyer" },
      { verify },
    );
    expect(approved.card?.lastFour).toBe("1111");
    expect(approved.card?.brand).toBe("VISA");
    expect(approved.verification.avs.outcome).toBe("full_match");

    const mismatch = await establishVaultCredential(
      { token: mintMockToken("visa-avs-mismatch"), accountAccessory: "1230", holderName: "A Buyer" },
      { verify },
    );
    // Approved and not verified — the gap verification.ts exists for, which is
    // the whole reason this card is in the table.
    expect(mismatch.card).toBeTruthy();
    expect(mismatch.verification.avs.outcome).toBe("no_match");
  });

  it("returns no card at all when the gateway declines", async () => {
    const declined = await establishVaultCredential(
      { token: mintMockToken("visa-declined"), accountAccessory: "1230", holderName: "A Buyer" },
      { verify },
    );
    expect(declined.card).toBeUndefined();
  });

  it("prefers the durable token the verification returns over the browser's", async () => {
    const browserToken = mintMockToken("visa-approved");
    const result = await establishVaultCredential(
      { token: browserToken, accountAccessory: "1230", holderName: "A Buyer" },
      { verify },
    );
    expect(result.card?.token).not.toBe(browserToken);
    expect(cardForToken(result.card!.token)?.scenario).toBe("visa-approved");
  });
});

describe("configuration", () => {
  it("is configured without any credentials, which is the point", () => {
    // No merchant account is open yet. An environment that cannot be clicked
    // through until one is cannot be tested at all.
    const resolved = resolveConfig({ environment: "mock" });
    expect(resolved.configured).toBe(true);
  });

  it("points the gateway at a URL that cannot be fetched", () => {
    // If the mock transport were ever not injected, this throws rather than
    // silently sending test traffic to a real gateway.
    expect(mockConfig.gatewayUrl).toBe(MOCK_GATEWAY_URL);
    expect(mockConfig.gatewayUrl.startsWith("mock://")).toBe(true);
  });

  it("serves the tokenizer from this app's own origin when one is configured", () => {
    const resolved = resolveConfig({
      environment: "mock",
      appBaseUrl: "https://zift.example.com/",
    }) as ZiftConfig;
    expect(resolved.proxynizationScriptUrl).toBe("https://zift.example.com/api/mock/proxynization");
  });

  it("wires the mock transport in, so nothing reaches the network", async () => {
    // Proves the injection in gateway.ts, not just that mockFetch exists: this
    // is the assertion that fails if someone constructs the client directly.
    const gateway = clientFor(resolveConfig({ environment: "mock" }));
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;

    const response = await gateway.client.request("account-verification", {
      token: mintMockToken("visa-approved"),
      accountAccessory: "1230",
      holderName: "A Buyer",
    });
    expect(interpretTransaction("account-verification", response).approved).toBe(true);
  });

  it("still refuses sandbox and production without credentials", () => {
    // Mock must not have loosened the real environments.
    expect(resolveConfig({ environment: "sandbox" }).configured).toBe(false);
    expect(resolveConfig({ environment: "production" }).configured).toBe(false);
  });
});
