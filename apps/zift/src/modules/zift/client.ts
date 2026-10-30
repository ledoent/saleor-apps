/**
 * The HTTP surface of Zift's transaction gateway.
 *
 * One endpoint for everything. `requestType` selects the operation and the
 * request is `application/x-www-form-urlencoded`; **so is the response**, which
 * is the part most likely to surprise someone arriving from a JSON API:
 *
 *   responseType=exception&responseCode=L01&responseMessage=Username+or+password+is+invalid.
 *
 * So this module form-encodes on the way out and parses `URLSearchParams` on
 * the way back, and nothing downstream ever sees a string that needs decoding.
 *
 * WHY THERE IS NO TOKEN CACHE AND NO RETRY-ON-401
 *
 * A gateway authenticating with OAuth bearers that expire needs both. Zift
 * authenticates every request inline with `userName`/`password`/`accountId`, so
 * there is no token to go stale and no 401 to recover from. The credentials are
 * attached here, once, so no call site can forget them.
 */

import type { ZiftConfig } from "./config";

export type RequestType =
  | "sale"
  | "sale-auth"
  | "capture"
  | "void"
  | "refund"
  | "credit"
  | "account-verification"
  | "ping";

export type Params = Record<string, string | number | null | undefined>;

export class ZiftTransportError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    requestType: string,
  ) {
    super(`Zift ${requestType} failed at the transport (${status}): ${body.slice(0, 300)}`);
    this.name = "ZiftTransportError";
  }
}

/**
 * A parsed Zift response.
 *
 * Deliberately a flat string map rather than a typed struct: the gateway
 * returns a different field set per request type, and inventing a union here
 * would mean guessing at shapes we have not seen. `transactions.ts` reads the
 * few fields that decide an outcome; `level3.ts` and the handlers read the
 * rest by name.
 */
export type ZiftResponse = Record<string, string>;

export const parseResponse = (body: string): ZiftResponse => {
  const params = new URLSearchParams(body);
  const out: ZiftResponse = {};
  for (const [key, value] of params) out[key] = value;
  return out;
};

export class ZiftClient {
  constructor(
    private readonly config: ZiftConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(requestType: RequestType, params: Params = {}): Promise<ZiftResponse> {
    const body = new URLSearchParams();
    body.set("requestType", requestType);
    // Credentials first and always. A call site cannot omit them because a call
    // site never supplies them.
    body.set("userName", this.config.userName);
    body.set("password", this.config.password);
    body.set("accountId", this.config.accountId);

    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === "") continue;
      body.set(key, String(value));
    }

    const response = await this.fetchImpl(this.config.gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const text = await response.text();

    // Zift answers 200 even for a declined or rejected transaction and puts the
    // verdict in the body, so a non-200 here means the gateway itself failed —
    // a proxy error, an outage — and is a different problem from a decline.
    if (!response.ok) {
      throw new ZiftTransportError(response.status, text, requestType);
    }

    return parseResponse(text);
  }
}
