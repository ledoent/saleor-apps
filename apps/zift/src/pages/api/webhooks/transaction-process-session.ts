import { TRANSACTION_PROCESS_SESSION } from "@/lib/subscriptions";
import { createPaymentWebhook } from "@/lib/webhooks";
import type { SessionEvent } from "@/modules/zift/saleor";

const webhook = createPaymentWebhook<SessionEvent>({
  name: "Zift Transaction Process Session",
  event: "TRANSACTION_PROCESS_SESSION",
  query: TRANSACTION_PROCESS_SESSION,
  path: "transaction-process-session",
});

/**
 * The second step of a two-step session — which this flow does not have.
 *
 * Storing a card completes in one call: the browser tokenizes with proxynization.js,
 * transaction-initialize-session vaults the token, and the answer is final.
 * There is no redirect to come back from and no additional customer action to
 * wait on, so a request arriving here means something upstream went differently
 * than designed.
 *
 * The webhook is declared anyway, because a declared event with no handler and
 * a handler with no declaration are both silent failures, and because 3-D
 * Secure — the reason this event exists — is the likeliest thing to be added
 * later. What it must not do in the meantime is approve: returning
 * AUTHORIZATION_SUCCESS from a handler that contacted no processor would mark a
 * card stored that nobody stored. Nothing may look paid for that has not been.
 */
export default webhook.createHandler(async (_req, res, ctx) => {
  void ctx;

  return res.status(200).json({
    result: "AUTHORIZATION_FAILURE",
    message:
      "This Zift flow completes in one step; there is no session left to process. Start again from the checkout payment step.",
    data: { reason: "single-step-flow" },
  });
});

export const config = { api: { bodyParser: false } };
