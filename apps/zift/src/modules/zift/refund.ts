/**
 * Giving money back, and taking a charge back before it settles.
 *
 * Two operations, not one: an unsettled transaction is voided, a settled one is
 * refunded. They are different requestTypes and different Saleor events, and
 * conflating them is how a customer ends up with both a reversal and a refund
 * for the same money. Saleor asks for the one it wants and this module does
 * exactly that, rather than being clever about which is really appropriate.
 *
 * Both go against the original sale's transactionId, never against the stored
 * token — refunding to a card that merely happens to be on file is how money
 * reaches the wrong place.
 */

import type { Params, ZiftResponse } from "./client";
import { toCents } from "./money";
import { interpretTransaction, toSaleorResult } from "./transactions";

export interface ReversalResult {
  result: string;
  pspReference: string;
  message?: string;
  data: Record<string, unknown>;
  approved: boolean;
}

const noReference = (action: "REFUND" | "CANCEL", verb: string): ReversalResult => ({
  result: `${action}_FAILURE`,
  pspReference: "",
  // A reversal that silently succeeded against nothing would show the customer
  // as repaid.
  message: `No Zift transaction reference on this Saleor transaction, so there is nothing to ${verb}.`,
  approved: false,
  data: { reason: "missing-reference" },
});

export const refundCharge = async (
  input: { transactionId: string; amount: number },
  deps: { refund: (params: Params) => Promise<ZiftResponse> },
): Promise<ReversalResult> => {
  if (!input.transactionId) return noReference("REFUND", "refund");

  const response = await deps.refund({
    transactionId: input.transactionId,
    amount: toCents(input.amount),
  });
  const outcome = interpretTransaction("refund", response);

  return {
    ...toSaleorResult(outcome, "REFUND"),
    approved: outcome.approved,
    data: {
      verdict: outcome.verdict,
      code: outcome.code,
      zift: outcome.raw,
      refundedCents: toCents(input.amount),
      against: input.transactionId,
    },
  };
};

export const cancelCharge = async (
  transactionId: string,
  deps: { voidTransaction: (params: Params) => Promise<ZiftResponse> },
): Promise<ReversalResult> => {
  if (!transactionId) return noReference("CANCEL", "void");

  const response = await deps.voidTransaction({ transactionId });
  const outcome = interpretTransaction("void", response);

  return {
    ...toSaleorResult(outcome, "CANCEL"),
    approved: outcome.approved,
    data: { verdict: outcome.verdict, code: outcome.code, zift: outcome.raw, against: transactionId },
  };
};
