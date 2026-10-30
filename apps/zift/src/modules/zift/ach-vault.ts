/**
 * Storing a bank account, and debiting one.
 *
 * Separate from `vault.ts` and `charge.ts` rather than folded into them with an
 * `if`, because the two methods differ in what an approval *means* and that is
 * not a branch anyone should be able to miss. A card verification approves or
 * declines; a bank debit is accepted or rejected, and acceptance is not payment.
 *
 * The AVS and CSC machinery in `verification.ts` is deliberately absent. Those
 * are card checks — there is no address verification on a bank account — so
 * reusing that module here would produce a confident-looking "address matched"
 * for a check that was never performed.
 */

import {
  buildAchSaleParams,
  buildAchVerificationParams,
  type AchAccountInput,
  type AchSaleInput,
} from "./ach";
import type { Params, ZiftResponse } from "./client";
import { interpretTransaction, toSaleorResult } from "./transactions";

export interface EstablishAchDeps {
  /** requestType=account-verification, with verificationMode=PF. */
  verify: (params: Params) => Promise<ZiftResponse>;
}

export interface StoredBankAccount {
  token: string;
  /** The routing number, as `accountAccessory`. Needed on every later debit. */
  accountAccessory: string;
  accountType: string;
  lastFour?: string | null;
  holderName?: string | null;
}

export interface EstablishAchResult {
  result: string;
  pspReference: string;
  message?: string;
  data: Record<string, unknown>;
  account?: StoredBankAccount;
}

/**
 * Zift masks an account as e.g. `1******5655`. Which response field carries it
 * for a bank account is in ASSUMED_FOR_ACH, so both plausible names are read
 * and neither is required — a missing display string must not fail a stored
 * account.
 */
const lastFourOf = (response: ZiftResponse): string | null => {
  const masked = response.accountNumberMasked ?? response.accountNumber ?? "";
  const digits = masked.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
};

/**
 * Validate the account with the processor, then keep the token.
 *
 * NACHA's WEB Debit Account Validation Rule wants an account validated before
 * first use, and Zift's own guidance is to validate before storing or
 * tokenizing. `verificationMode=PF` is what makes this more than a formality:
 * a failed verification declines the tokenization instead of handing back a
 * token for an account that cannot be debited.
 */
export const establishAchCredential = async (
  input: AchAccountInput,
  deps: EstablishAchDeps,
): Promise<EstablishAchResult> => {
  const response = await deps.verify(buildAchVerificationParams(input));
  const outcome = interpretTransaction("account-verification", response);
  const base = toSaleorResult(outcome, "AUTHORIZATION");

  if (!outcome.approved) {
    return {
      ...base,
      message: outcome.message || "Zift declined the bank account verification.",
      data: { ...base.data, method: "ach" },
    };
  }

  // As with a card, prefer the token the verification returns: Zift describes
  // the verification token as the durable one and the browser's as transient.
  const token = response.token || input.token;

  return {
    ...base,
    account: {
      token,
      accountAccessory: buildAchVerificationParams(input).accountAccessory as string,
      accountType: input.accountType,
      lastFour: lastFourOf(response),
      holderName: response.holderName ?? input.holderName,
    },
    data: { ...base.data, method: "ach", verificationReference: outcome.reference },
  };
};

export interface AchChargeDeps {
  /** requestType=sale */
  sale: (params: Params) => Promise<ZiftResponse>;
}

export interface AchChargeResult {
  /**
   * `CHARGE_FAILURE` on a rejection, and **undefined on an acceptance**.
   *
   * That absence is the whole design. Saleor's async flow is entered by
   * answering `TRANSACTION_CHARGE_REQUESTED` with a pspReference and no
   * `result`, which records a `CHARGE_REQUEST` event and leaves the charge
   * pending until an app reports the outcome with `transactionEventReport`. For
   * ACH that is correct and `CHARGE_SUCCESS` would be a lie: the debit has
   * entered the network and the money has not arrived.
   */
  result?: string;
  pspReference: string;
  message?: string;
  data: Record<string, unknown>;
  /** True when the debit was accepted for processing. NOT when it settled. */
  accepted: boolean;
}

export const debitBankAccount = async (
  input: AchSaleInput,
  deps: AchChargeDeps,
): Promise<AchChargeResult> => {
  const response = await deps.sale(buildAchSaleParams(input));
  const outcome = interpretTransaction("sale", response);

  if (!outcome.approved) {
    const base = toSaleorResult(outcome, "CHARGE");
    return {
      ...base,
      accepted: false,
      message: outcome.message || "Zift rejected the bank debit.",
      data: { ...base.data, method: "ach", settled: false },
    };
  }

  return {
    // No `result`. See AchChargeResult.
    pspReference: outcome.reference,
    accepted: true,
    message:
      "Bank debit accepted for processing. ACH settles in one to three business days and " +
      "can still be returned; this order is not paid until settlement is confirmed.",
    data: {
      verdict: outcome.verdict,
      code: outcome.code,
      zift: outcome.raw,
      method: "ach",
      /**
       * Read by the dashboard and by anyone reconciling. The word "settled"
       * exists so that nothing has to infer payment from the absence of a
       * failure.
       */
      settled: false,
      acceptedCents: input.amountCents,
    },
  };
};
