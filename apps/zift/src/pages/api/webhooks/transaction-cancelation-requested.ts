import { TRANSACTION_CANCELATION_REQUESTED } from "@/lib/subscriptions";
import { createPaymentWebhook } from "@/lib/webhooks";
import { findCard } from "@/modules/zift/cards";
import { refusal, requireClient } from "@/modules/zift/gateway";
import { cancelCharge } from "@/modules/zift/refund";
import type { ChargeRequestedEvent } from "@/modules/zift/saleor";

const webhook = createPaymentWebhook<ChargeRequestedEvent>({
  name: "Zift Transaction Cancelation Requested",
  event: "TRANSACTION_CANCELATION_REQUESTED",
  query: TRANSACTION_CANCELATION_REQUESTED,
  path: "transaction-cancelation-requested",
});

/**
 * Voiding a sale that has not settled — the same day's cancellation, before the
 * batch closes.
 *
 * Cancelling a transaction that only ever stored a card is genuinely nothing to
 * undo: Zift's verification was for $0 and placed no hold, so there is no money
 * anywhere to reverse. Saying that plainly beats issuing a void against a
 * transaction that never moved a cent.
 */
export default webhook.createHandler(async (_req, res, ctx) => {
  const payload = ctx.payload as ChargeRequestedEvent;

  try {
    const gateway = requireClient();
    if (!gateway.ok) return res.status(200).json(refusal("CANCEL", gateway.reason));

    const stored = payload.transaction?.id ? await findCard(payload.transaction.id) : null;
    const charged = stored?.lastChargeReference ?? null;

    if (!charged && stored) {
      return res.status(200).json({
        result: "CANCEL_SUCCESS",
        amount: payload.action.amount,
        pspReference: payload.transaction?.pspReference ?? "",
        message: "Nothing to void: this transaction stored a card with a $0 verification and never charged it.",
        data: { voided: false, reason: "never-charged" },
      });
    }

    const result = await cancelCharge(charged || payload.transaction?.pspReference || "", {
      voidTransaction: (params) => gateway.client.request("void", params),
    });

    return res.status(200).json({
      result: result.result,
      amount: payload.action.amount,
      pspReference: result.pspReference,
      ...(result.message ? { message: result.message } : {}),
      data: result.data,
    });
  } catch (error) {
    return res.status(200).json({
      result: "CANCEL_FAILURE",
      message: error instanceof Error ? error.message : "Unhandled error voiding the Zift sale.",
      data: {},
    });
  }
});

export const config = { api: { bodyParser: false } };
