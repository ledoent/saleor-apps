import { TRANSACTION_REFUND_REQUESTED } from "@/lib/subscriptions";
import { createPaymentWebhook } from "@/lib/webhooks";
import { findCard } from "@/modules/zift/cards";
import { refusal, requireClient } from "@/modules/zift/gateway";
import { refundCharge } from "@/modules/zift/refund";
import type { ChargeRequestedEvent } from "@/modules/zift/saleor";

const webhook = createPaymentWebhook<ChargeRequestedEvent>({
  name: "Zift Transaction Refund Requested",
  event: "TRANSACTION_REFUND_REQUESTED",
  query: TRANSACTION_REFUND_REQUESTED,
  path: "transaction-refund-requested",
});

/**
 * Refunding a settled sale, against the sale's transactionId — with the stored
 * `lastChargeReference` as the fallback for a transaction whose pspReference
 * has since moved on. Never against the stored token.
 */
export default webhook.createHandler(async (_req, res, ctx) => {
  const payload = ctx.payload as ChargeRequestedEvent;

  try {
    const gateway = requireClient();
    if (!gateway.ok) return res.status(200).json(refusal("REFUND", gateway.reason));

    const stored = payload.transaction?.id ? await findCard(payload.transaction.id) : null;
    const reference = stored?.lastChargeReference || payload.transaction?.pspReference || "";

    const result = await refundCharge(
      { transactionId: reference, amount: payload.action.amount },
      { refund: (params) => gateway.client.request("refund", params) },
    );

    return res.status(200).json({
      result: result.result,
      amount: payload.action.amount,
      pspReference: result.pspReference || reference,
      ...(result.message ? { message: result.message } : {}),
      data: result.data,
    });
  } catch (error) {
    return res.status(200).json({
      result: "REFUND_FAILURE",
      message: error instanceof Error ? error.message : "Unhandled error refunding the Zift sale.",
      data: {},
    });
  }
});

export const config = { api: { bodyParser: false } };
