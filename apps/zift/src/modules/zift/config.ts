/**
 * Which Zift account this app is talking to, and whether it can talk at all.
 *
 * WHAT IS STRIKINGLY SIMPLE HERE
 *
 * There is no OAuth and no integrator id. Every request carries `userName`,
 * `password` and `accountId` inline, so there is no token to mint, cache or
 * refresh, and no registry-issued header standing between us and the sandbox.
 * Verified 2026-09-09: an unauthenticated POST to the sandbox gateway answers
 * `responseCode=L01 Username or password is invalid` — it rejects on
 * credentials and on nothing else, which is why this integration is testable
 * the day a login exists.
 *
 * The credentials come from a Kubernetes Secret rather than Saleor app
 * metadata, because they move money and app private metadata is readable by
 * anyone holding MANAGE_APPS.
 */

import { MOCK_GATEWAY_URL } from "./mock";

/**
 * `mock` is a third environment, not a flag on the other two.
 *
 * Making it an environment means every downstream branch that already switches
 * on `environment` — the gateway URL, the script URL, what the webhook reports
 * to the browser — handles it by construction rather than by remembering. See
 * `mock.ts` for what it answers and, more importantly, what it refuses.
 */
export type ZiftEnvironment = "production" | "sandbox" | "mock";

export interface ZiftConfig {
  configured: true;
  environment: ZiftEnvironment;
  userName: string;
  password: string;
  /** Zift merchant account. One credential set may span several. */
  accountId: string;
  /** The transaction gateway, `.../gates/xurl`. */
  gatewayUrl: string;
  /** Where the browser would load proxynization.js from. See the README on PCI scope. */
  proxynizationScriptUrl: string;
}

export interface ZiftUnconfigured {
  configured: false;
  reason: string;
  environment: ZiftEnvironment;
}

export type ResolvedConfig = ZiftConfig | ZiftUnconfigured;

const GATEWAY_URL: Record<ZiftEnvironment, string> = {
  production: "https://secure.zift.io/gates/xurl",
  sandbox: "https://sandbox-secure.zift.io/gates/xurl",
  // Unfetchable on purpose. `gateway.ts` injects the mock transport so this is
  // never called; if that injection is ever lost, `mock://` throws instead of
  // silently sending test traffic to a real gateway.
  mock: MOCK_GATEWAY_URL,
};

const PROXYNIZATION_URL: Record<ZiftEnvironment, string> = {
  production: "https://secure.zift.io/services/api.proxynization.js",
  sandbox: "https://sandbox-secure.zift.io/services/api.proxynization.js",
  // Replaced with an absolute URL under this app's own origin by
  // `resolveConfig` — the browser has to fetch it, so a relative path is no
  // use. This entry is the fallback when no base URL is configured.
  mock: "/api/mock/proxynization",
};

export interface ConfigSource {
  environment: ZiftEnvironment;
  userName?: string | null;
  password?: string | null;
  accountId?: string | null;
  gatewayUrl?: string | null;
  /** This app's public origin. Only used to address the mock tokenizer. */
  appBaseUrl?: string | null;
}

/**
 * Anything that is not literally `production` is the sandbox.
 *
 * The type says an unknown environment cannot happen; the deployment is a
 * string in a ConfigMap, so it can. Without this, an unrecognised value indexes
 * the tables below to `undefined` and produces a config that reports itself
 * configured while holding no gateway URL — a `fetch(undefined)` at the moment
 * of a payment. Failing toward the test gateway is the same principle the
 * ConfigMap comment states: a misconfigured environment must fail toward the
 * sandbox rather than toward real money.
 */
const normalise = (environment: ZiftEnvironment): ZiftEnvironment => {
  if (environment === "production") return "production";
  if (environment === "mock") return "mock";
  return "sandbox";
};

export const resolveConfig = (source: ConfigSource): ResolvedConfig => {
  const environment = normalise(source.environment);
  const userName = source.userName?.trim();
  const password = source.password?.trim();
  const accountId = source.accountId?.trim();

  /**
   * Mock needs no credentials, which is the entire point of it: an environment
   * that works before Zift has issued a login. The placeholders below are never
   * sent anywhere — `mock.ts` answers before the transport does — but they are
   * obviously fake rather than empty, so anything that logs a config makes the
   * mode plain.
   */
  if (environment === "mock") {
    const base = source.appBaseUrl?.trim().replace(/\/+$/, "");
    return {
      configured: true,
      environment,
      userName: "mock",
      password: "mock",
      accountId: "mock",
      gatewayUrl: MOCK_GATEWAY_URL,
      proxynizationScriptUrl: base
        ? `${base}${PROXYNIZATION_URL.mock}`
        : PROXYNIZATION_URL.mock,
    };
  }

  const missing: string[] = [];
  if (!userName) missing.push("ZIFT_USERNAME");
  if (!password) missing.push("ZIFT_PASSWORD");
  if (!accountId) missing.push("ZIFT_ACCOUNT_ID");

  if (!userName || !password || !accountId) {
    return {
      configured: false,
      environment,
      reason: `Zift is not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} unset.`,
    };
  }

  return {
    configured: true,
    environment,
    userName,
    password,
    accountId,
    gatewayUrl: source.gatewayUrl?.trim() || GATEWAY_URL[environment],
    proxynizationScriptUrl: PROXYNIZATION_URL[environment],
  };
};

/** The deployed configuration. Read at call time so tests can stub the env. */
export const configFromEnv = (): ResolvedConfig =>
  resolveConfig({
    environment: readEnvironment(process.env.ZIFT_ENVIRONMENT),
    userName: process.env.ZIFT_USERNAME,
    password: process.env.ZIFT_PASSWORD,
    accountId: process.env.ZIFT_ACCOUNT_ID,
    gatewayUrl: process.env.ZIFT_GATEWAY_URL,
    appBaseUrl: process.env.APP_API_BASE_URL,
  });

/** Anything unrecognised is the sandbox, per `normalise`. Stated once, here. */
const readEnvironment = (raw: string | undefined): ZiftEnvironment => {
  if (raw === "production") return "production";
  if (raw === "mock") return "mock";
  return "sandbox";
};
