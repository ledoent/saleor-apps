import { PAYMENT_GATEWAY_INITIALIZE_SESSION } from "@/lib/subscriptions";
import { createPaymentWebhook } from "@/lib/webhooks";
import { configFromEnv } from "@/modules/zift/config";

const webhook = createPaymentWebhook({
  name: "Zift Payment Gateway Initialize Session",
  event: "PAYMENT_GATEWAY_INITIALIZE_SESSION",
  query: PAYMENT_GATEWAY_INITIALIZE_SESSION,
  path: "payment-gateway-initialize-session",
});

/**
 * What the browser needs to collect a card, and nothing else.
 *
 * Everything returned here reaches a web page, so the rule is absolute: no
 * userName, no password, no accountId. Only the environment name and the
 * proxynization script URL, both of which are public facts.
 *
 * READ THE README BEFORE WIRING A BROWSER TO THIS
 *
 * Zift's proxynization.js is not hosted fields. It reads the card number out of
 * an input on *our* page. That is a different PCI posture from an iframe, and
 * the decision belongs to whoever signs the SAQ — which is why this app is
 * built and unwired, and why nothing in the storefront calls it yet.
 */
export default webhook.createHandler(async (_req, res) => {
  const config = configFromEnv();

  if (!config.configured) {
    return res.status(200).json({ data: { configured: false, reason: config.reason } });
  }

  return res.status(200).json({
    data: {
      configured: true,
      environment: config.environment,
      proxynizationScriptUrl: config.proxynizationScriptUrl,
      /**
       * What this app can store, so the storefront does not have to hardcode
       * it. Both are server-side complete; neither is rendered yet.
       *
       * `ach` carries `settlesImmediately: false` because the difference is not
       * cosmetic and a checkout that presents a bank debit as equivalent to a
       * card is misleading: an accepted debit leaves the order pending for one
       * to three business days and can still be returned.
       */
      methods: [
        { kind: "card", settlesImmediately: true },
        { kind: "ach", settlesImmediately: false },
      ],
    },
  });
});

export const config = { api: { bodyParser: false } };
