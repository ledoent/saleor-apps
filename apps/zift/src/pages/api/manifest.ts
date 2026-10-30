import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest, SyncWebhookEventType } from "@saleor/app-sdk/types";

import { env } from "@/lib/env";

import {
  PAYMENT_GATEWAY_INITIALIZE_SESSION,
  TRANSACTION_CANCELATION_REQUESTED,
  TRANSACTION_CHARGE_REQUESTED,
  TRANSACTION_INITIALIZE_SESSION,
  TRANSACTION_PROCESS_SESSION,
  TRANSACTION_REFUND_REQUESTED,
} from "@/lib/subscriptions";

/**
 * All six payment webhooks are declared here.
 *
 * TRANSACTION_INITIALIZE_SESSION is the one that decides visibility:
 * availablePaymentGateways on Checkout returns only apps with an active
 * webhook for that event, so an app missing it does not appear at checkout at
 * all — it fails silently rather than loudly. That is exactly how the tax app
 * ended up deployed for months while serving nothing.
 */
export default createManifestHandler({
  async manifestFactory({ appBaseUrl }): Promise<AppManifest> {
    const baseUrl = env.APP_API_BASE_URL ?? appBaseUrl;

    const webhook = (name: string, event: SyncWebhookEventType, query: string, route: string) => ({
      name,
      asyncEvents: [],
      syncEvents: [event],
      query,
      targetUrl: `${baseUrl}/api/webhooks/${route}`,
      isActive: true,
    });

    return {
      id: "duropc.zift",
      version: "0.2.0",
      name: "DuroPC Zift Payments",
      about:
        "Stores a card or a bank account at checkout with a $0 verification, and collects when the order ships: a card charge carries Level II/III line-item data and records AVS and CSC, while an ACH debit is reported as pending until it settles.",
      permissions: ["HANDLE_PAYMENTS"],
      // `configurationUrl` was removed from AppManifest in app-sdk 1.16;
      // the dashboard now reaches configuration through `appUrl` and
      // declared extensions, and this app has no configuration screen.
      appUrl: baseUrl,
      tokenTargetUrl: `${baseUrl}/api/register`,
      webhooks: [
        webhook(
          "Zift Payment Gateway Initialize Session",
          "PAYMENT_GATEWAY_INITIALIZE_SESSION",
          PAYMENT_GATEWAY_INITIALIZE_SESSION,
          "payment-gateway-initialize-session",
        ),
        webhook(
          "Zift Transaction Initialize Session",
          "TRANSACTION_INITIALIZE_SESSION",
          TRANSACTION_INITIALIZE_SESSION,
          "transaction-initialize-session",
        ),
        webhook(
          "Zift Transaction Process Session",
          "TRANSACTION_PROCESS_SESSION",
          TRANSACTION_PROCESS_SESSION,
          "transaction-process-session",
        ),
        webhook(
          "Zift Transaction Charge Requested",
          "TRANSACTION_CHARGE_REQUESTED",
          TRANSACTION_CHARGE_REQUESTED,
          "transaction-charge-requested",
        ),
        webhook(
          "Zift Transaction Refund Requested",
          "TRANSACTION_REFUND_REQUESTED",
          TRANSACTION_REFUND_REQUESTED,
          "transaction-refund-requested",
        ),
        webhook(
          "Zift Transaction Cancelation Requested",
          "TRANSACTION_CANCELATION_REQUESTED",
          TRANSACTION_CANCELATION_REQUESTED,
          "transaction-cancelation-requested",
        ),
      ],
    };
  },
});
