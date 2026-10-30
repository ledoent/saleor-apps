import { TRANSACTION_CHARGE_REQUESTED } from "@/lib/subscriptions";
import { createPaymentWebhook } from "@/lib/webhooks";
import { isAchAccountType, methodKindOf, type AchAccountType } from "@/modules/zift/ach";
import { debitBankAccount } from "@/modules/zift/ach-vault";
import { findCard, recordCharge } from "@/modules/zift/cards";
import { chargeStoredCard } from "@/modules/zift/charge";
import { refusal, requireClient } from "@/modules/zift/gateway";
import { toCents } from "@/modules/zift/money";
import type { ChargeRequestedEvent } from "@/modules/zift/saleor";

const webhook = createPaymentWebhook<ChargeRequestedEvent>({
  name: "Zift Transaction Charge Requested",
  event: "TRANSACTION_CHARGE_REQUESTED",
  query: TRANSACTION_CHARGE_REQUESTED,
  path: "transaction-charge-requested",
});

/**
 * Ship day. AR pressed Charge in the Saleor dashboard and this is the call that
 * takes the money — the only one in the app that does.
 *
 * The stored row is looked up rather than trusted from the payload, and here
 * that is not merely tidiness: Zift requires the card's expiry on the charge as
 * well as the token, and Saleor has nowhere to carry it. A transaction with no
 * row is therefore uncharged rather than charged with a guess.
 */
export default webhook.createHandler(async (_req, res, ctx) => {
  const payload = ctx.payload as ChargeRequestedEvent;
  const transactionId = payload.transaction?.id ?? "";

  try {
    const gateway = requireClient();
    if (!gateway.ok) return res.status(200).json(refusal("CHARGE", gateway.reason));

    const stored = transactionId ? await findCard(transactionId) : null;

    if (!stored?.token || !stored.accountAccessory) {
      const kind = stored ? methodKindOf(stored.accountType) : "card";
      return res.status(200).json(
        refusal(
          "CHARGE",
          stored
            ? kind === "ach"
              ? "The stored Zift bank account has no routing number recorded, and Zift requires it on every debit."
              : "The stored Zift card has no expiry recorded, and Zift requires it on every charge."
            : "No stored Zift payment method is linked to this transaction, so there is nothing to charge.",
        ),
      );
    }

    /**
     * ACH leaves by a different door, and the difference is the response shape.
     *
     * A bank debit is answered with a pspReference and **no `result`**, which is
     * Saleor's async flow: it records CHARGE_REQUEST and the charge stays
     * pending until something reports the outcome. Returning CHARGE_SUCCESS
     * here would mark the order paid at the moment the debit entered the ACH
     * network — one to three business days before the money arrives, and it can
     * still be returned after that.
     */
    if (isAchAccountType(stored.accountType)) {
      const debit = await debitBankAccount(
        {
          token: stored.token,
          routingNumber: stored.accountAccessory,
          accountType: stored.accountType as AchAccountType,
          holderName: stored.holderName ?? "",
          amountCents: toCents(payload.action.amount),
          orderCode: payload.transaction?.order?.number ?? null,
        },
        { sale: (params) => gateway.client.request("sale", params) },
      );

      if (debit.accepted && transactionId && debit.pspReference) {
        await recordCharge(transactionId, debit.pspReference);
      }

      return res.status(200).json({
        // Present only on a rejection. Its absence is what makes this pending.
        ...(debit.result ? { result: debit.result } : {}),
        amount: payload.action.amount,
        pspReference: debit.pspReference,
        ...(debit.message ? { message: debit.message } : {}),
        data: debit.data,
      });
    }

    const result = await chargeStoredCard(
      {
        token: stored.token,
        accountAccessory: stored.accountAccessory,
        holderName: stored.holderName,
        amount: payload.action.amount,
        order: payload.transaction?.order ?? null,
      },
      { sale: (params) => gateway.client.request("sale", params) },
    );

    if (result.approved && transactionId && result.pspReference) {
      await recordCharge(transactionId, result.pspReference);
    }

    return res.status(200).json({
      result: result.result,
      amount: payload.action.amount,
      pspReference: result.pspReference,
      ...(result.message ? { message: result.message } : {}),
      data: result.data,
    });
  } catch (error) {
    // A throw here means we do not know whether the money moved. That is a
    // CHARGE_FAILURE with the reason attached, never a silent success.
    return res.status(200).json({
      result: "CHARGE_FAILURE",
      message: error instanceof Error ? error.message : "Unhandled error charging the stored card.",
      data: {},
    });
  }
});

export const config = { api: { bodyParser: false } };
