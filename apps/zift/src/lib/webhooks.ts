import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";

import { apl } from "@/lib/apl";

/**
 * One factory for all six payment webhooks.
 *
 * Registering them individually invites the failure this app exists partly to
 * avoid: a webhook that is declared in the manifest but never handled, or
 * handled but never declared. Both are silent. `manifest.test.ts` asserts the
 * two lists agree.
 */
export const createPaymentWebhook = <TPayload>(args: {
  name: string;
  event: string;
  query: string;
  path: string;
}) =>
  new SaleorSyncWebhook<TPayload>({
    apl,
    name: args.name,
    // The SDK's event union does not cover every payment event by name in this
    // version; the manifest is the source of truth and is asserted in tests.
    event: args.event as never,
    query: args.query,
    webhookPath: `/api/webhooks/${args.path}`,
    isActive: true,
  });
