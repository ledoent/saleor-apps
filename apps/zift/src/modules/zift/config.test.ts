import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config";

const complete = {
  environment: "sandbox" as const,
  userName: "someone",
  password: "secret",
  accountId: "2001",
};

describe("resolveConfig", () => {
  it("points at the sandbox gateway by default", () => {
    const result = resolveConfig(complete);

    expect(result.configured).toBe(true);
    expect(result.configured && result.gatewayUrl).toBe("https://sandbox-secure.zift.io/gates/xurl");
  });

  it("points at production only when asked", () => {
    const result = resolveConfig({ ...complete, environment: "production" });

    expect(result.configured && result.gatewayUrl).toBe("https://secure.zift.io/gates/xurl");
  });

  it("treats an unrecognised environment as the sandbox, with a real URL", () => {
    // The type says this cannot happen; the deployment is a string in a
    // ConfigMap, so it can. Before this was handled, an unknown value indexed
    // the host table to undefined and produced a config that called itself
    // configured while holding no gateway URL at all — a fetch(undefined) at
    // the moment of a payment.
    const result = resolveConfig({ ...complete, environment: "staging" as never });

    expect(result.configured).toBe(true);
    expect(result.configured && result.gatewayUrl).toBe("https://sandbox-secure.zift.io/gates/xurl");
    expect(result.environment).toBe("sandbox");
  });

  it.each([
    ["user name", { ...complete, userName: undefined }, "ZIFT_USERNAME"],
    ["password", { ...complete, password: "" }, "ZIFT_PASSWORD"],
    ["account id", { ...complete, accountId: "   " }, "ZIFT_ACCOUNT_ID"],
  ])("refuses without a %s, and names it", (_label, source, expected) => {
    const result = resolveConfig(source);

    expect(result.configured).toBe(false);
    expect(!result.configured && result.reason).toContain(expected);
  });

  it("names every missing variable at once, not just the first", () => {
    const result = resolveConfig({ environment: "sandbox" });

    for (const v of ["ZIFT_USERNAME", "ZIFT_PASSWORD", "ZIFT_ACCOUNT_ID"]) {
      expect(!result.configured && result.reason).toContain(v);
    }
  });

  it("needs no integrator id, which is the whole reason this is testable today", () => {
    // Some gateways refuse every call until a registry-issued integrator id
    // exists. Zift rejects on credentials and nothing else.
    expect(resolveConfig(complete).configured).toBe(true);
  });
});
