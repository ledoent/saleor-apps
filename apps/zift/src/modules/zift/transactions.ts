/**
 * Reading a Zift response, and saying what Saleor should record.
 *
 * HOW ZIFT SAYS YES AND NO
 *
 * `responseType` echoes the request on success and is the literal string
 * `exception` on failure. Observed against the sandbox with deliberately wrong
 * credentials:
 *
 *   responseType=exception&responseCode=L01&responseMessage=Username+or+password+is+invalid.
 *
 * and their own documented sample of a successful authorisation carries
 * `responseType=sale-auth`. So the echo is the signal, and it is corroborated
 * by `transactionId`, which their docs say is "always present in the response"
 * for a real transaction.
 *
 * THE ONE RULE
 *
 * An outcome this module does not recognise is `unknown`, never `approved`.
 * Nothing may look paid for that has not been. A wrong decline is a support
 * call; a wrong approval is an unpaid machine on a truck.
 *
 * WHAT IS STILL ASSUMED
 *
 * Zift documents separate tables of approval, soft-decline and hard-decline
 * response codes that this app has not seen. Distinguishing a soft decline
 * (retry later) from a hard one (do not retry) needs them, and until they are
 * read both simply fail. That is the safe direction, and it is the first thing
 * scripts/sandbox-smoke.ts should print.
 */

import type { RequestType, ZiftResponse } from "./client";

export type TransactionVerdict = "approved" | "declined" | "unknown";

export interface TransactionOutcome {
  verdict: TransactionVerdict;
  approved: boolean;
  /** Zift's transactionId, as a string. Empty when it did not return one. */
  reference: string;
  message: string;
  /** Zift's own code, kept because the decline tables are read by code. */
  code: string;
  raw: ZiftResponse;
}

export const EXCEPTION = "exception";

export const interpretTransaction = (
  requestType: RequestType,
  response: ZiftResponse,
): TransactionOutcome => {
  const reference = response.transactionId ?? "";
  const message = response.responseMessage ?? response.failureMessage ?? "";
  const code = response.responseCode ?? response.failureCode ?? "";
  const type = response.responseType ?? "";

  const verdict: TransactionVerdict = ((): TransactionVerdict => {
    if (type === EXCEPTION) return "declined";
    if (type === requestType) return "approved";
    // A response type that is neither the echo nor an exception is a shape
    // nobody here has seen, and a shape nobody has seen is not evidence of a
    // payment.
    return "unknown";
  })();

  return {
    verdict,
    // Approval requires both a verdict and something to refer back to. A
    // transaction we cannot name later is one we cannot void, capture or
    // refund, and calling it a success would strand a real charge.
    approved: verdict === "approved" && reference !== "",
    reference,
    code,
    message:
      message ||
      (verdict === "unknown"
        ? `Zift returned responseType "${type || "(none)"}", which this app does not recognise.`
        : ""),
    raw: response,
  };
};

export type SaleorAction = "AUTHORIZATION" | "CHARGE" | "REFUND" | "CANCEL";

export interface SaleorTransactionResult {
  result: string;
  pspReference: string;
  message?: string;
  data: Record<string, unknown>;
}

/**
 * Saleor's response for an outcome. The raw gateway reply goes into `data`
 * whatever the verdict: on a decline it is the only record of why, and on an
 * approval it is what reconciles our ledger against a statement.
 */
export const toSaleorResult = (
  outcome: TransactionOutcome,
  action: SaleorAction,
): SaleorTransactionResult => ({
  result: `${action}_${outcome.approved ? "SUCCESS" : "FAILURE"}`,
  pspReference: outcome.reference,
  ...(outcome.message ? { message: outcome.message } : {}),
  data: {
    verdict: outcome.verdict,
    code: outcome.code,
    zift: outcome.raw,
  },
});
