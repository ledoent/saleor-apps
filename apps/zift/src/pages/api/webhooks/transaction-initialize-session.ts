import { TRANSACTION_INITIALIZE_SESSION } from "@/lib/subscriptions";
import { createPaymentWebhook } from "@/lib/webhooks";
import {
  achValidationErrors,
  isAchAccountType,
  type AchAccountType,
  type HolderTypeCode,
} from "@/modules/zift/ach";
import { establishAchCredential } from "@/modules/zift/ach-vault";
import { recordVault } from "@/modules/zift/cards";
import { refusal, requireClient } from "@/modules/zift/gateway";
import type { SessionEvent } from "@/modules/zift/saleor";
import { establishVaultCredential } from "@/modules/zift/vault";

const webhook = createPaymentWebhook<SessionEvent>({
  name: "Zift Transaction Initialize Session",
  event: "TRANSACTION_INITIALIZE_SESSION",
  query: TRANSACTION_INITIALIZE_SESSION,
  path: "transaction-initialize-session",
});

/**
 * The event that decides whether this app appears at checkout at all:
 * availablePaymentGateways returns only apps with an active webhook for it.
 *
 * Stores the card with a $0 verification and returns a **zero-amount**
 * AUTHORIZATION_SUCCESS with CHARGE available. Nothing has been authorised for
 * the order, and here that is not merely a convention — Zift's verification
 * genuinely moves no money and places no hold, so the zero is a fact rather
 * than a rounding of one.
 *
 * `pspReference` is the Zift token, because at this point in the card's life
 * that is what "the provider's reference for this transaction" means. It is
 * overwritten by the sale's id when AR charges, which is why cards.ts keeps a
 * copy — along with the expiry, without which the token cannot be charged.
 */
export default webhook.createHandler(async (_req, res, ctx) => {
  const payload = ctx.payload as SessionEvent & {
    data?: {
      token?: string;
      accountAccessory?: string;
      holderName?: string;
      /** `C` or `S` selects a bank account; absent or `R` is a card. */
      accountType?: string;
      /** The routing number. Named plainly here; it travels as accountAccessory. */
      routingNumber?: string;
      holderType?: string;
    } | null;
  };
  const source = payload.sourceObject ?? null;

  try {
    const gateway = requireClient();
    if (!gateway.ok) return res.status(200).json(refusal("AUTHORIZATION", gateway.reason));

    /**
     * A bank account is stored by a different call with different requirements,
     * so it branches before the card fields are read at all. `accountType` is
     * what selects it; anything else is a card, which keeps every existing
     * caller working unchanged.
     */
    if (isAchAccountType(payload.data?.accountType)) {
      const input = {
        token: payload.data?.token ?? "",
        routingNumber: payload.data?.routingNumber ?? payload.data?.accountAccessory ?? "",
        accountType: payload.data.accountType as AchAccountType,
        holderName: payload.data?.holderName ?? "",
        holderType: payload.data?.holderType as HolderTypeCode | undefined,
      };

      // Every reason at once. A customer correcting one field per round trip
      // abandons the checkout.
      const problems = achValidationErrors(input);
      if (problems.length > 0) {
        return res.status(200).json(refusal("AUTHORIZATION", problems.join(" ")));
      }

      const ach = await establishAchCredential(input, {
        verify: (params) => gateway.client.request("account-verification", params),
      });

      if (ach.account && payload.transaction?.id) {
        await recordVault({
          saleorTransactionId: payload.transaction.id,
          token: ach.account.token,
          accountType: ach.account.accountType,
          accountAccessory: ach.account.accountAccessory,
          brand: null,
          lastFour: ach.account.lastFour ?? null,
          holderName: ach.account.holderName ?? null,
          saleorCheckoutId: source?.__typename === "Checkout" ? (source.id ?? null) : null,
          saleorOrderId: source?.__typename === "Order" ? (source.id ?? null) : null,
          saleorCustomerId: source?.user?.id ?? null,
          verificationReference: ach.pspReference,
          status: "established",
        });
      }

      return res.status(200).json({
        result: ach.result,
        // The verification moves no money, exactly as with a card.
        amount: 0,
        pspReference: ach.account?.token ?? ach.pspReference,
        ...(ach.message ? { message: ach.message } : {}),
        actions: ["CHARGE", "CANCEL"],
        data: ach.data,
      });
    }

    const token = payload.data?.token;
    const accountAccessory = payload.data?.accountAccessory;
    const holderName = payload.data?.holderName;

    if (!token || !accountAccessory || !holderName) {
      // Zift needs all three to verify a card, and the expiry again on every
      // later charge. Missing any of them means there is no card to store, and
      // saying so beats returning a fabricated approval.
      return res.status(200).json(
        refusal(
          "AUTHORIZATION",
          "A card token, its expiry and the cardholder name are all required to store a card with Zift.",
        ),
      );
    }

    const result = await establishVaultCredential(
      {
        token,
        accountAccessory,
        holderName,
        billingStreet: source?.billingAddress?.streetAddress1 ?? null,
        billingZip: source?.billingAddress?.postalCode ?? null,
      },
      { verify: (params) => gateway.client.request("account-verification", params) },
    );

    if (result.card && payload.transaction?.id) {
      // Written before the response goes back: a stored card Saleor knows about
      // and we do not is a card nobody can charge.
      await recordVault({
        saleorTransactionId: payload.transaction.id,
        token: result.card.token,
        accountAccessory: result.card.accountAccessory,
        brand: result.card.brand ?? null,
        lastFour: result.card.lastFour ?? null,
        holderName: result.card.holderName ?? null,
        saleorCheckoutId: source?.__typename === "Checkout" ? (source.id ?? null) : null,
        saleorOrderId: source?.__typename === "Order" ? (source.id ?? null) : null,
        saleorCustomerId: source?.user?.id ?? null,
        verificationReference: result.pspReference,
        status: "established",
      });
    }

    return res.status(200).json({
      result: result.result,
      // Zero, and truthfully so: the verification was for $0.
      amount: 0,
      pspReference: result.card?.token ?? result.pspReference,
      ...(result.message ? { message: result.message } : {}),
      actions: ["CHARGE", "CANCEL"],
      data: result.data,
    });
  } catch (error) {
    return res.status(200).json({
      result: "AUTHORIZATION_FAILURE",
      message: error instanceof Error ? error.message : "Unhandled error storing the card with Zift.",
      data: {},
    });
  }
});

export const config = { api: { bodyParser: false } };
