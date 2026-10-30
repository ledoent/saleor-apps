/**
 * Debiting a bank account instead of a card.
 *
 * WHY THIS MODULE IS NOT JUST `accountType: "C"`
 *
 * Zift's gateway makes ACH look like a one-character change. It is one
 * character in the request and four different things everywhere else:
 *
 * 1. **An approval is not a payment.** A card `sale` approval is an issuer
 *    guaranteeing funds. An ACH `sale` acceptance means the debit entered the
 *    network — nothing more. Returns (insufficient funds, closed account,
 *    unauthorised) arrive days later. `CHARGE_SUCCESS` on an ACH acceptance
 *    would mark an order paid, and this app's one rule is that nothing may look
 *    paid that has not been. See `isSettledOnAcceptance` and the async flow in
 *    the charge handler.
 * 2. **The stored credential can change underneath us.** Receiving banks send
 *    Notices of Change, and a token we hold can be superseded. See `noc.ts`.
 * 3. **Nothing validates the account number.** Zift's docs are explicit that
 *    during tokenization "bank account numbers are verified by length, while
 *    payment card numbers are additionally checked against the Luhn algorithm".
 *    A card typo fails the checksum in the browser; a bank-account typo
 *    tokenizes cleanly and surfaces a week later as a return. The routing
 *    number at least carries a checksum, and this module enforces it.
 * 4. **There is no Level III.** Level II/III exist to reduce card interchange.
 *    An ACH debit has no interchange, so `buildAchSaleParams` deliberately
 *    sends no line items. Attaching them would be noise in a record nobody
 *    reads and arithmetic that can only disagree with itself.
 *
 * WHAT IS DOCUMENTED AND WHAT IS ASSUMED
 *
 * Documented by Zift and relied on here:
 *   - `accountType` values `R` (branded card), `C` (bank checking), `S` (bank
 *     savings).
 *   - `accountAccessory` String(10) carries the **bank routing number** for ACH,
 *     where it carries the card expiry for a card. One field, two meanings,
 *     which is why `zift_card_tokens.accountAccessory` needed no new column.
 *   - `holderType` values `P` (personal) and `O` (organization).
 *   - `holderName` String(150) is load-bearing: Zift's own NOC guidance warns
 *     that "not using the correct holderName tied to an account could
 *     potentially result in an ACH return".
 *   - `account-verification` applies to bank accounts, not only cards, and Zift
 *     recommends validating a bank account *before* storing or tokenizing it in
 *     order to satisfy NACHA's WEB Debit Account Validation Rule.
 *   - `verificationMode` values `NN` (no pre-tokenization verification) and
 *     `PF` (processor verifies; tokenization is declined if verification fails).
 *
 * Assumed until a sandbox login proves otherwise, and listed in
 * `ASSUMED_FOR_ACH` so the smoke run has a checklist:
 *   - that `transactionIndustryType` takes the same `RE` value for a bank debit
 *     as for a card sale;
 *   - which SEC/entry-class code the debit settles under, and whether Zift
 *     derives it from `holderType` or wants it named. Nothing is sent for it,
 *     because an invented entry class is a compliance claim rather than a
 *     formatting detail;
 *   - the response field carrying the masked account number for a bank account.
 */

import type { Params } from "./client";

/**
 * `accountType` as Zift defines it. `R` is here rather than in the card modules
 * because the whole point of this type is that one field selects between a card
 * and a bank account, and a reader needs all three values in one place.
 */
export const ACCOUNT_TYPE = {
  card: "R",
  checking: "C",
  savings: "S",
} as const;

export type AccountTypeCode = (typeof ACCOUNT_TYPE)[keyof typeof ACCOUNT_TYPE];

/** The two bank values, for the places that must refuse a card. */
export type AchAccountType = typeof ACCOUNT_TYPE.checking | typeof ACCOUNT_TYPE.savings;

export type PaymentMethodKind = "card" | "ach";

export const isAchAccountType = (value: string | null | undefined): value is AchAccountType =>
  value === ACCOUNT_TYPE.checking || value === ACCOUNT_TYPE.savings;

export const methodKindOf = (accountType: string | null | undefined): PaymentMethodKind =>
  isAchAccountType(accountType) ? "ach" : "card";

/**
 * Whether an approval on this method means the money is ours.
 *
 * The only reason this is a function rather than a comment: it is read in two
 * places that must not drift — the charge handler deciding whether to answer
 * Saleor synchronously, and the test that asserts ACH never reports
 * `CHARGE_SUCCESS` from an acceptance.
 */
export const isSettledOnAcceptance = (kind: PaymentMethodKind): boolean => kind === "card";

/** `P` personal, `O` organization. Zift's values, not ours. */
export const HOLDER_TYPE = {
  personal: "P",
  business: "O",
} as const;

export type HolderTypeCode = (typeof HOLDER_TYPE)[keyof typeof HOLDER_TYPE];

/**
 * `PF` — the processor verifies the account and a failed verification declines
 * the tokenization.
 *
 * `NN` is the alternative and it is the wrong default here: it stores an
 * unverified bank account, which is the exact thing NACHA's validation rule
 * exists to prevent and the exact thing that becomes a return. Choosing the
 * safe value once, here, beats remembering it at each call site.
 */
export const VERIFICATION_MODE_PROCESSOR = "PF";

/** Kept named so the smoke script can print what we did NOT use, and why. */
export const VERIFICATION_MODE_NONE = "NN";

/**
 * Open questions for Zift, in the file that would have to change to answer
 * them. `README.md` quotes this list rather than keeping its own.
 */
export const ASSUMED_FOR_ACH: readonly string[] = [
  "transactionIndustryType for a bank debit (RE is sent, copied from the card sale)",
  "the SEC / entry-class code the debit settles under, and whether Zift derives it from holderType",
  "the response field carrying a masked bank account number",
  "which responseCode values are an acceptance rather than an approval",
];

/** Digits only, so a form may carry spaces or dashes. */
export const normaliseRouting = (routing: string): string => routing.replace(/\D/g, "");

/**
 * The ABA checksum.
 *
 * Nine digits, weighted 3-7-1 repeating, summing to a multiple of ten. This is
 * the only integrity check available anywhere in an ACH debit: Zift
 * length-checks the account number and nothing checks it further, so the
 * routing number is the one typo that can be caught before the debit is a
 * return days later. Catching it here is worth more than it looks.
 */
export const isValidRoutingNumber = (routing: string): boolean => {
  const digits = normaliseRouting(routing);
  if (digits.length !== 9) return false;

  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(digits[i]) * weights[i];
  }

  return sum % 10 === 0;
};

export interface AchAccountInput {
  /** A proxynization/tokenization token for a bank account. Never an account number. */
  token: string;
  /** The ABA routing number. Travels as `accountAccessory`. */
  routingNumber: string;
  accountType: AchAccountType;
  /**
   * The name on the account. Not cosmetic — a mismatch is a documented cause of
   * an ACH return, and a NOC may correct it.
   */
  holderName: string;
  /** `O` for a company account, `P` for an individual's. Authored, never guessed. */
  holderType?: HolderTypeCode;
}

export class AchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AchValidationError";
  }
}

/**
 * The checks worth making before a request leaves this process.
 *
 * Returns reasons rather than throwing so a webhook can refuse with all of them
 * at once; a customer correcting one field at a time through three round trips
 * abandons the checkout.
 */
export const achValidationErrors = (input: AchAccountInput): string[] => {
  const errors: string[] = [];

  if (!input.token?.trim()) {
    errors.push("A bank account token is required; this app never accepts an account number.");
  }

  if (!isValidRoutingNumber(input.routingNumber ?? "")) {
    errors.push(
      "The routing number is not a valid nine-digit ABA number (its checksum does not hold).",
    );
  }

  if (!isAchAccountType(input.accountType)) {
    errors.push(`accountType must be ${ACCOUNT_TYPE.checking} (checking) or ${ACCOUNT_TYPE.savings} (savings).`);
  }

  if (!input.holderName?.trim()) {
    errors.push(
      "The name on the bank account is required; a mismatch is a documented cause of an ACH return.",
    );
  }

  return errors;
};

const assertValid = (input: AchAccountInput): void => {
  const errors = achValidationErrors(input);
  if (errors.length > 0) throw new AchValidationError(errors.join(" "));
};

/**
 * The $0 validation that precedes storing a bank account.
 *
 * `verificationMode=PF` is the reason this is worth a call at all: it makes the
 * processor's verdict decide whether the account is stored, rather than storing
 * first and discovering the problem when the debit returns.
 */
export const buildAchVerificationParams = (input: AchAccountInput): Params => {
  assertValid(input);

  return {
    accountType: input.accountType,
    token: input.token,
    accountAccessory: normaliseRouting(input.routingNumber),
    holderName: input.holderName.trim(),
    holderType: input.holderType ?? HOLDER_TYPE.business,
    verificationMode: VERIFICATION_MODE_PROCESSOR,
  };
};

export interface AchSaleInput extends AchAccountInput {
  /** Integer cents. Converted by `money.ts` before it gets here, once. */
  amountCents: number;
  /** Our identifier for the order, for the bank statement and reconciliation. */
  orderCode?: string | null;
}

/**
 * A bank debit.
 *
 * Note what is absent: every Level II and Level III parameter. An ACH debit has
 * no interchange to optimise, so line-item detail buys nothing and the
 * reconciliation arithmetic in `level3.ts` has nothing to reconcile against.
 */
export const buildAchSaleParams = (input: AchSaleInput): Params => {
  assertValid(input);

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new AchValidationError(
      `An ACH debit needs a positive whole number of cents; received ${String(input.amountCents)}.`,
    );
  }

  return {
    accountType: input.accountType,
    token: input.token,
    accountAccessory: normaliseRouting(input.routingNumber),
    holderName: input.holderName.trim(),
    holderType: input.holderType ?? HOLDER_TYPE.business,
    amount: input.amountCents,
    // Assumed, not documented for a bank debit. See ASSUMED_FOR_ACH.
    transactionIndustryType: "RE",
    orderCode: input.orderCode ?? undefined,
  };
};
