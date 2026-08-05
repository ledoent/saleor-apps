/**
 * Minimal Paya (Sage Payments) Bankcard API client.
 *
 * Written against Paya's public API documentation. No code is derived from the
 * legacy WooCommerce gateway plugin, which is GPL v3 — this repository is
 * BSD-3 and the two are incompatible. The plugin was read only to establish
 * which API generation the merchant account uses.
 *
 * The account talks to the v2 REST API (api.sagepayments.com), not the older
 * gateway.sagepayments.net/eftbankcard.dll endpoint.
 */
import { buildLevel3Data, type PayaLevel3Data, type SourceLine } from "./level3";

export type PayaEnvironment = "production" | "certification";

const BASE_URL: Record<PayaEnvironment, string> = {
  production: "https://api.sagepayments.com",
  certification: "https://api-cert.sagepayments.com",
};

export interface PayaConfig {
  environment: PayaEnvironment;
  merchantId: string;
  merchantKey: string;
}

export class PayaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "PayaApiError";
  }
}

export class PayaClient {
  constructor(private readonly config: PayaConfig) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${BASE_URL[this.config.environment]}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        clientId: this.config.merchantId,
        clientKey: this.config.merchantKey,
        ...init.headers,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new PayaApiError(
        `Paya ${init.method ?? "GET"} ${path} failed with ${response.status}`,
        response.status,
        text,
      );
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Replace the Level 3 data on a transaction.
   *
   * Named "replace" rather than "update" on purpose: each POST overwrites any
   * previous Level 3 data for the transaction, so the payload must always be
   * complete. Calling this twice with partial data silently discards the
   * first call's line items.
   */
  async replaceLevel3Data(data: PayaLevel3Data): Promise<void> {
    await this.request("/v2/transactionlevel3s", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async attachLevel3(args: {
    transactionId: string;
    lines: SourceLine[];
    shippingNet?: number;
    shippingTax?: number;
  }): Promise<void> {
    await this.replaceLevel3Data(buildLevel3Data(args));
  }

  /**
   * Whether this merchant location is actually enabled for Level 3.
   *
   * Worth calling before assuming any of the above earns a discount: a correct
   * integration on a location the processor has not enabled qualifies for
   * nothing, and eligibility varies by backend processor. Paya documents this
   * exact check — run a transaction, then expand transaction_level3 and see
   * whether it comes back populated or null.
   */
  async isLevel3EnabledForLocation(transactionId: string): Promise<boolean> {
    const result = await this.request<{ transaction_level3?: unknown }>(
      `/v2/transactions/${transactionId}?expand=transaction_level3`,
      { method: "GET" },
    );

    return result.transaction_level3 != null;
  }
}
