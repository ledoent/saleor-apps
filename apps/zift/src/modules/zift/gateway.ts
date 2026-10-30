/**
 * One place that turns configuration into a client, so six handlers do not each
 * have their own idea of what "configured" means. It never returns a
 * half-configured client and never throws for a missing credential: a missing
 * credential is an answer, and the answer is a decline with a reason.
 */

import { ZiftClient } from "./client";
import { configFromEnv, type ResolvedConfig } from "./config";
import { mockFetch } from "./mock";

export type ClientOrRefusal =
  | { ok: true; client: ZiftClient; config: Extract<ResolvedConfig, { configured: true }> }
  | { ok: false; reason: string };

/**
 * The mock's transport is swapped in here and nowhere else.
 *
 * `ZiftClient` takes a `fetchImpl`, so mock mode changes the transport and
 * nothing above it: form encoding, response parsing, `interpretTransaction` and
 * the vault write are all the same code under a mock as under the real gateway.
 * A mock that bypassed those would prove only that the mock works.
 */
export const clientFor = (resolved: ResolvedConfig): ClientOrRefusal =>
  resolved.configured
    ? {
        ok: true,
        client: new ZiftClient(resolved, resolved.environment === "mock" ? mockFetch : fetch),
        config: resolved,
      }
    : { ok: false, reason: resolved.reason };

export const requireClient = (): ClientOrRefusal => clientFor(configFromEnv());

/** The Saleor response for a request that cannot be attempted at all. */
export const refusal = (action: string, reason: string) => ({
  result: `${action}_FAILURE`,
  message: reason,
  data: { configured: false },
});
