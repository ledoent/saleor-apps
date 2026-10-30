/**
 * A Zift-shaped gateway that answers from a table instead of the network.
 *
 * WHY THIS EXISTS
 *
 * Until a sandbox login has been issued, `resolveConfig` refuses every payment
 * with a reason and checkout shows no card option at all. That is the correct
 * behaviour and it is also untestable: nobody can click through the card flow,
 * so the storefront half of the integration cannot be proven until a credential
 * arrives from a third party on their own schedule.
 *
 * `ZIFT_ENVIRONMENT=mock` decouples those. It is the same decision a carrier
 * integration makes with a shipping sandbox, for the same reason: an
 * environment should be able to work before the vendor's paperwork does.
 *
 * THE ONE RULE THIS MODULE ENFORCES
 *
 * **A real card number can never produce an approval here.** The mock only
 * recognises tokens minted by its own tokenizer, which only mints for the test
 * PANs in `MOCK_CARDS`. Anything else — a real proxynization token from a
 * genuinely configured Zift, a forged string, a blank — is an exception, never
 * an approval.
 *
 * That matters beyond tidiness. The failure this prevents is a half-configured
 * environment where `ZIFT_ENVIRONMENT` says mock but the browser is talking to
 * the real Zift: a customer types a live PAN, sees "card stored", and AR is
 * handed a token that no processor has ever heard of. An order that cannot be
 * collected is worse than one that was never taken.
 *
 * NOT A SIMULATOR. This answers the shapes `vault.ts` reads on the one request
 * type the storefront exercises — `account-verification`. Charge and refund are
 * deliberately absent: they are AR's path, they run from the Saleor dashboard
 * against a real processor, and a mocked approval there would be a fake receipt
 * for a machine on a truck.
 */

import type { ZiftResponse } from "./client";

/** Every mock token starts with this. The prefix is the whole safety check. */
export const MOCK_TOKEN_PREFIX = "ziftmock";

/**
 * A gateway URL that cannot be fetched.
 *
 * In mock mode nothing should reach the network, but `ZiftConfig` requires a
 * gateway URL and a plausible-looking one is a trap: if the mock transport were
 * ever not injected, a real URL would send test traffic to Zift's sandbox and
 * quietly appear to work. `mock://` throws at `fetch` instead, loudly, in the
 * one place where being loud is worth more than being graceful.
 */
export const MOCK_GATEWAY_URL = "mock://zift/gates/xurl";

export interface MockCard {
  /** The number a tester types. */
  pan: string;
  /** What the token encodes. Never the PAN — see `mintMockToken`. */
  scenario: string;
  /** Human label for the test-card table in the UI and the README. */
  label: string;
  brand: string;
  approved: boolean;
  responseCode: string;
  responseMessage: string;
  /** Zift's single-letter AVS code. `verification.ts` classifies it. */
  avsResponseCode: string;
  cscResponseCode: string;
}

/**
 * The published test PANs, which are the same ones every gateway uses.
 *
 * Four, not forty. Each one exists to make a specific branch reachable from a
 * browser; a fifth that exercises nothing new is a number someone has to be
 * told about for no reason.
 */
export const MOCK_CARDS: readonly MockCard[] = [
  {
    pan: "4111111111111111",
    scenario: "visa-approved",
    label: "Visa — approves, address matches",
    brand: "VISA",
    approved: true,
    responseCode: "A01",
    responseMessage: "Approved",
    avsResponseCode: "Y",
    cscResponseCode: "M",
  },
  {
    pan: "5454545454545454",
    scenario: "mc-commercial-approved",
    label: "Mastercard commercial — approves, address matches",
    brand: "MASTERCARD",
    approved: true,
    responseCode: "A01",
    responseMessage: "Approved",
    avsResponseCode: "Y",
    cscResponseCode: "M",
  },
  {
    pan: "4000000000000002",
    scenario: "visa-declined",
    label: "Visa — declines",
    brand: "VISA",
    approved: false,
    responseCode: "D05",
    responseMessage: "Declined. Do not honour.",
    avsResponseCode: "U",
    cscResponseCode: "U",
  },
  {
    /**
     * Approved by the issuer, address rejected. The gap `verification.ts`
     * exists for, and the only one of these four that is hard to reason about
     * without seeing it: the order completes, the card is stored, and the
     * verification outcome on the transaction says the address did not match.
     */
    pan: "4000000000000010",
    scenario: "visa-avs-mismatch",
    label: "Visa — approves, address does NOT match",
    brand: "VISA",
    approved: true,
    responseCode: "A01",
    responseMessage: "Approved",
    avsResponseCode: "N",
    cscResponseCode: "M",
  },
];

/**
 * The bank accounts, for ACH.
 *
 * Routing numbers are real published ABA numbers that pass the checksum,
 * because `ach.ts` enforces it and a test fixture that cannot pass our own
 * validation teaches nothing. The account numbers are arbitrary — nothing
 * checks them anywhere, which is itself the point `ach.ts` makes.
 */
export interface MockBankAccount {
  /** What a tester types. */
  accountNumber: string;
  routingNumber: string;
  /** `C` checking or `S` savings. */
  accountType: "C" | "S";
  scenario: string;
  label: string;
  /** Whether `account-verification` approves. See verificationMode=PF. */
  approved: boolean;
  responseCode: string;
  responseMessage: string;
}

export const MOCK_BANK_ACCOUNTS: readonly MockBankAccount[] = [
  {
    accountNumber: "1234567890",
    routingNumber: "011000015",
    accountType: "C",
    scenario: "ach-checking-approved",
    label: "Business checking — verifies, debit accepted",
    approved: true,
    responseCode: "A01",
    responseMessage: "Approved",
  },
  {
    accountNumber: "9876543210",
    routingNumber: "021000021",
    accountType: "S",
    scenario: "ach-savings-approved",
    label: "Savings — verifies, debit accepted",
    approved: true,
    responseCode: "A01",
    responseMessage: "Approved",
  },
  {
    /**
     * The one worth clicking. `verificationMode=PF` means a failed
     * verification declines the tokenization, so nothing is stored at all —
     * which is the behaviour that stops an unverifiable account becoming a
     * return days later, and the reason NACHA wants validation before first use.
     */
    accountNumber: "0000000001",
    routingNumber: "121000358",
    accountType: "C",
    scenario: "ach-verification-declined",
    label: "Checking — verification FAILS, nothing is stored",
    approved: false,
    responseCode: "V01",
    responseMessage: "Account verification failed. The account could not be validated.",
  },
];

const byPan = new Map(MOCK_CARDS.map((card) => [card.pan, card]));
const byScenario = new Map(MOCK_CARDS.map((card) => [card.scenario, card]));
const bankByAccountNumber = new Map(
  MOCK_BANK_ACCOUNTS.map((account) => [account.accountNumber, account]),
);
const bankByScenario = new Map(MOCK_BANK_ACCOUNTS.map((account) => [account.scenario, account]));

/** Digits only, so a tester may type spaces or dashes. */
export const normalisePan = (pan: string): string => pan.replace(/\D/g, "");

export const findMockCardByPan = (pan: string): MockCard | null =>
  byPan.get(normalisePan(pan)) ?? null;

/**
 * The token the mock tokenizer hands the browser.
 *
 * It carries the **scenario**, not the card number. A mock PAN is not sensitive,
 * but a string of sixteen digits flowing through logs, a database and a Saleor
 * transaction is a shape that invites being treated as one — and the moment
 * this file is copied for something less synthetic, that shape is the bug. The
 * scenario name cannot be mistaken for a card.
 */
export const mintMockToken = (scenario: string, nonce = randomNonce()): string =>
  `${MOCK_TOKEN_PREFIX}-${scenario}-${nonce}`;

const randomNonce = (): string => Math.random().toString(36).slice(2, 10);

/** The scenario a mock token encodes, or null if this mock did not mint it. */
const scenarioOf = (token: string | undefined | null): string | null => {
  if (!token) return null;
  const parts = token.split("-");
  if (parts[0] !== MOCK_TOKEN_PREFIX) return null;
  // scenario names contain dashes; the nonce is the last segment.
  return parts.slice(1, -1).join("-");
};

export const cardForToken = (token: string | undefined | null): MockCard | null => {
  const scenario = scenarioOf(token);
  return scenario ? (byScenario.get(scenario) ?? null) : null;
};

export const findMockBankByAccountNumber = (accountNumber: string): MockBankAccount | null =>
  bankByAccountNumber.get(accountNumber.replace(/\D/g, "")) ?? null;

/**
 * Bank scenarios and card scenarios share a token prefix but not a registry,
 * so a card token in an ACH request resolves to nothing and vice versa. That
 * mismatch is a refusal, not a cross-method approval.
 */
export const bankForToken = (token: string | undefined | null): MockBankAccount | null => {
  const scenario = scenarioOf(token);
  return scenario ? (bankByScenario.get(scenario) ?? null) : null;
};

const maskFor = (card: MockCard): string => {
  const last4 = card.pan.slice(-4);
  return `${card.pan[0]}${"*".repeat(card.pan.length - 5)}${last4}`;
};

const form = (fields: ZiftResponse): string => new URLSearchParams(fields).toString();

/** Zift answers 200 with the verdict in the body, so the mock does too. */
const ok = (fields: ZiftResponse): Response =>
  new Response(form(fields), {
    status: 200,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

const exception = (code: string, message: string): Response =>
  ok({ responseType: "exception", responseCode: code, responseMessage: message });

let sequence = 0;
const mockTransactionId = (): string => `MOCKTXN${String(++sequence).padStart(8, "0")}`;

/** Reset between tests so ids are deterministic. */
export const resetMockSequence = (): void => {
  sequence = 0;
};

/**
 * A `fetch` that never leaves the process.
 *
 * Injected as `ZiftClient`'s `fetchImpl`, which is why `client.ts` needs no
 * mock-mode branch: the transport is the seam, so form encoding, response
 * parsing and error handling are all still the real code paths under test.
 */
export const mockFetch: typeof fetch = async (_input, init) => {
  const params = new URLSearchParams(String(init?.body ?? ""));
  const requestType = params.get("requestType") ?? "";
  const accountType = params.get("accountType") ?? "";

  if (accountType === "C" || accountType === "S") {
    return mockAchFetch(requestType, params);
  }

  if (requestType !== "account-verification") {
    // Charge and refund are AR's path against a real processor. Refusing here
    // is the honest answer; a mocked approval would be a fake receipt.
    return exception(
      "M02",
      `The mock Zift gateway implements account-verification only; ${requestType || "an empty requestType"} was requested.`,
    );
  }

  const card = cardForToken(params.get("token"));

  if (!card) {
    // The safety rule. A token this mock did not mint is never an approval,
    // whatever it is.
    return exception(
      "M01",
      "The mock Zift gateway only accepts tokens it minted. Use one of the published test cards.",
    );
  }

  if (!card.approved) {
    return exception(card.responseCode, card.responseMessage);
  }

  return ok({
    responseType: "account-verification",
    responseCode: card.responseCode,
    responseMessage: card.responseMessage,
    transactionId: mockTransactionId(),
    // The durable token, distinct from the browser's transient one, exactly as
    // vault.ts prefers it from a real verification.
    token: mintMockToken(card.scenario),
    accountNumberMasked: maskFor(card),
    extendedAccountType: card.brand,
    holderName: params.get("holderName") ?? "",
    avsResponseCode: card.avsResponseCode,
    cscResponseCode: card.cscResponseCode,
  });
};

/**
 * The bank half, and WHY IT MOCKS A DEBIT WHEN THE CARD HALF REFUSES A CHARGE.
 *
 * The card rule above is that a mocked charge would be "a fake receipt for a
 * machine on a truck". That reasoning is about a *payment*, and it is exactly
 * why an ACH debit is different rather than an exception to the rule: an
 * accepted debit is not a payment. It produces a **pending** charge in Saleor —
 * `CHARGE_REQUEST`, no `CHARGE_SUCCESS` — so a mocked acceptance cannot mark an
 * order paid and cannot put a machine on a truck.
 *
 * Mocking it is also the only way to exercise the property that matters most in
 * this integration: that an acceptance stays pending. A safety behaviour nobody
 * can demonstrate is a claim, not a behaviour.
 *
 * Settlement and returns are still **not** mocked. Those arrive asynchronously
 * from Zift, over a notification transport this app does not yet have, and a
 * mocked settlement WOULD be a fake receipt.
 */
const mockAchFetch = (requestType: string, params: URLSearchParams): Response => {
  if (requestType !== "account-verification" && requestType !== "sale") {
    return exception(
      "M02",
      `The mock Zift gateway implements account-verification and sale for bank accounts; ${requestType || "an empty requestType"} was requested.`,
    );
  }

  const account = bankForToken(params.get("token"));

  if (!account) {
    // The same safety rule as cards. A token this mock did not mint — including
    // a card token sent with a bank accountType — is never an approval.
    return exception(
      "M01",
      "The mock Zift gateway only accepts bank tokens it minted. Use one of the published test accounts.",
    );
  }

  const routing = (params.get("accountAccessory") ?? "").replace(/\D/g, "");
  if (routing !== account.routingNumber) {
    return exception(
      "M03",
      `The routing number sent (${routing || "none"}) is not the one this test account was minted for.`,
    );
  }

  if (!account.approved) {
    // verificationMode=PF: a failed verification declines the tokenization, so
    // this is a refusal on both request types rather than a stored-but-bad
    // account.
    return exception(account.responseCode, account.responseMessage);
  }

  if (requestType === "account-verification") {
    return ok({
      responseType: "account-verification",
      responseCode: account.responseCode,
      responseMessage: account.responseMessage,
      transactionId: mockTransactionId(),
      token: mintMockToken(account.scenario),
      accountNumberMasked: `*****${account.accountNumber.slice(-4)}`,
      holderName: params.get("holderName") ?? "",
    });
  }

  return ok({
    responseType: "sale",
    responseCode: "A01",
    // Worded as acceptance, never as payment. This string reaches the Saleor
    // dashboard, where somebody decides whether to ship.
    responseMessage: "Accepted for processing. Not settled.",
    transactionId: mockTransactionId(),
    amount: params.get("amount") ?? "",
  });
};
