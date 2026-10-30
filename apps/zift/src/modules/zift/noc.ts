/**
 * Notice of Change: the receiving bank correcting a stored bank account.
 *
 * WHY A CARD INTEGRATION HAS NO EQUIVALENT OF THIS FILE
 *
 * A stored card is stable until it expires. A stored bank account is not: the
 * receiving bank can tell us, after the fact, that the account number, the
 * routing number, the account type or the name on the account is wrong — and it
 * tells us by correcting it. Zift delivers that as a webhook notification with
 * the event code `processing.noc-processed`, and the correction arrives as a
 * parallel set of `*Updated` fields beside the originals.
 *
 * The failure this prevents is slow and expensive. An unapplied NOC means the
 * next debit carries the same wrong detail, returns again, and each return is a
 * fee and a NACHA compliance problem. The debit that triggered the NOC may well
 * have succeeded, so nothing looks broken at the time.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * There is no HTTP endpoint here. Zift's notification envelope — how the
 * callback is framed and, crucially, how it is **authenticated** — is not in
 * the documentation this was written from, and an unauthenticated endpoint that
 * rewrites stored payment credentials is the worst thing in this repository to
 * guess at. Anyone can post a token swap at it.
 *
 * So the decision logic is written, tested and ready, and the transport is an
 * open question for Zift. `interpretNotice` takes an already-parsed field map;
 * wiring it to a verified request is the remaining step. See the README.
 */

import { ACCOUNT_TYPE, isAchAccountType, isValidRoutingNumber, normaliseRouting } from "./ach";

/** Zift's event code for a processed Notice of Change. */
export const NOC_EVENT_CODE = "processing.noc-processed";

/** What a notice can correct. Named so the table below can be read as a spec. */
export type NocField = "token" | "routingNumber" | "accountType" | "holderName";

/**
 * The NACHA change codes Zift documents, and what each one corrects.
 *
 * Kept as data rather than a switch because the table is the specification:
 * a reader comparing this against Zift's own page should be able to do it line
 * by line.
 */
export const NOC_CODES = {
  C01: { changes: ["token"], note: "Incorrect account number" },
  C02: { changes: ["routingNumber"], note: "Incorrect routing number" },
  C03: { changes: ["token", "routingNumber"], note: "Incorrect account and routing number" },
  C04: { changes: ["holderName"], note: "Incorrect or mismatched name on the account" },
  C05: { changes: ["token", "accountType"], note: "Incorrect account type" },
  C06: { changes: ["token", "accountType"], note: "Incorrect account number and account type" },
} as const satisfies Record<string, { changes: readonly NocField[]; note: string }>;

export type NocCode = keyof typeof NOC_CODES;

export const isKnownNocCode = (code: string): code is NocCode =>
  Object.prototype.hasOwnProperty.call(NOC_CODES, code);

/**
 * The fields a notice may carry. Names are Zift's.
 *
 * `tokenOriginal` is how the notice is matched to a stored credential: it names
 * the token we currently hold. Matching on anything else — a Saleor id, a
 * customer — would be guessing at which stored account the bank meant.
 */
export interface NocNotification {
  eventCode?: string | null;
  responseCode?: string | null;
  tokenOriginal?: string | null;
  tokenUpdated?: string | null;
  accountAccessoryUpdated?: string | null;
  holderNameUpdated?: string | null;
  accountTypeUpdated?: string | null;
}

/** The change to apply to every stored row holding `matchToken`. */
export interface NocPatch {
  token?: string;
  accountAccessory?: string;
  holderName?: string;
  accountType?: string;
}

export type NocInterpretation =
  | {
      applicable: true;
      code: NocCode;
      /** The token we currently hold, and the only safe way to find the row. */
      matchToken: string;
      patch: NocPatch;
      note: string;
    }
  | {
      applicable: false;
      /** Always populated. A notice we cannot apply must be visible, not dropped. */
      reason: string;
      code: string | null;
    };

/**
 * Read a notice and say what to change.
 *
 * Every refusal path returns a reason rather than `null`. An unapplied NOC is
 * not a harmless no-op — it is a debit that will return again — so the caller
 * has to be able to log or alert on exactly why nothing happened.
 */
export const interpretNotice = (notification: NocNotification): NocInterpretation => {
  const code = (notification.responseCode ?? "").trim().toUpperCase();

  if (notification.eventCode && notification.eventCode !== NOC_EVENT_CODE) {
    return {
      applicable: false,
      code: code || null,
      reason: `Not a Notice of Change: eventCode was "${notification.eventCode}", expected "${NOC_EVENT_CODE}".`,
    };
  }

  if (!code) {
    return { applicable: false, code: null, reason: "The notice carried no responseCode." };
  }

  if (!isKnownNocCode(code)) {
    // Deliberately not "ignore and carry on". NACHA defines change codes beyond
    // C01-C06, and one this app has never seen still means a stored account is
    // wrong. A person needs to look at it.
    return {
      applicable: false,
      code,
      reason: `Change code ${code} is not one this app knows how to apply (${Object.keys(NOC_CODES).join(", ")}). The stored account is stale and needs a person.`,
    };
  }

  const matchToken = (notification.tokenOriginal ?? "").trim();
  if (!matchToken) {
    return {
      applicable: false,
      code,
      reason: `Change code ${code} arrived without tokenOriginal, so there is no way to identify which stored account it corrects.`,
    };
  }

  const expected: readonly NocField[] = NOC_CODES[code].changes;
  const patch: NocPatch = {};
  const missing: string[] = [];

  if (expected.includes("token")) {
    const updated = (notification.tokenUpdated ?? "").trim();
    if (updated) patch.token = updated;
    else missing.push("tokenUpdated");
  }

  if (expected.includes("routingNumber")) {
    const updated = normaliseRouting(notification.accountAccessoryUpdated ?? "");
    if (!updated) {
      missing.push("accountAccessoryUpdated");
    } else if (!isValidRoutingNumber(updated)) {
      // A correction that does not pass the ABA checksum is not a correction.
      // Applying it would replace one bad routing number with another.
      return {
        applicable: false,
        code,
        reason: `Change code ${code} supplied routing number "${updated}", which fails the ABA checksum. Not applied.`,
      };
    } else {
      patch.accountAccessory = updated;
    }
  }

  if (expected.includes("accountType")) {
    const updated = (notification.accountTypeUpdated ?? "").trim().toUpperCase();
    if (!updated) {
      missing.push("accountTypeUpdated");
    } else if (!isAchAccountType(updated)) {
      return {
        applicable: false,
        code,
        reason: `Change code ${code} supplied accountType "${updated}", which is neither ${ACCOUNT_TYPE.checking} nor ${ACCOUNT_TYPE.savings}. Not applied.`,
      };
    } else {
      patch.accountType = updated;
    }
  }

  if (expected.includes("holderName")) {
    const updated = (notification.holderNameUpdated ?? "").trim();
    if (updated) patch.holderName = updated;
    else missing.push("holderNameUpdated");
  }

  if (missing.length > 0) {
    return {
      applicable: false,
      code,
      reason: `Change code ${code} should carry ${missing.join(", ")} and did not, so the correction is incomplete and was not applied.`,
    };
  }

  return {
    applicable: true,
    code,
    matchToken,
    patch,
    note: NOC_CODES[code].note,
  };
};
