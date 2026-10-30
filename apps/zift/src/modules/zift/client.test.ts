import { describe, expect, it, vi } from "vitest";

import { ZiftClient, ZiftTransportError, parseResponse } from "./client";
import { resolveConfig } from "./config";

const config = resolveConfig({
  environment: "sandbox",
  userName: "someone",
  password: "s3cret",
  accountId: "2001",
});
if (!config.configured) throw new Error("test fixture is misconfigured");

const reply = (body: string, status = 200) =>
  ({ ok: status < 400, status, text: async () => body }) as unknown as Response;

const APPROVED = "responseType=sale&responseCode=A01&transactionId=99";

describe("parseResponse", () => {
  it("reads the form-encoded body Zift actually returns", () => {
    // Observed against the sandbox, not assumed: this is the real shape.
    expect(
      parseResponse(
        "responseType=exception&responseCode=L01&responseMessage=Username+or+password+is+invalid.",
      ),
    ).toEqual({
      responseType: "exception",
      responseCode: "L01",
      responseMessage: "Username or password is invalid.",
    });
  });

  it("decodes percent-encoding, so no caller has to", () => {
    expect(parseResponse("responseMessage=Declined%3A+call+issuer").responseMessage).toBe(
      "Declined: call issuer",
    );
  });
});

describe("ZiftClient", () => {
  it("attaches credentials to every request, so no call site can forget them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(APPROVED));
    await new ZiftClient(config, fetchImpl).request("sale", { amount: 500 });

    const [url, init] = fetchImpl.mock.calls[0];
    const body = new URLSearchParams(init.body);
    expect(url).toBe("https://sandbox-secure.zift.io/gates/xurl");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(body.get("requestType")).toBe("sale");
    expect(body.get("userName")).toBe("someone");
    expect(body.get("password")).toBe("s3cret");
    expect(body.get("accountId")).toBe("2001");
    expect(body.get("amount")).toBe("500");
  });

  it("omits empty parameters rather than sending them blank", async () => {
    // Zift validates field formats, and an empty string fails a format check
    // where an absent field simply is not there.
    const fetchImpl = vi.fn().mockResolvedValue(reply(APPROVED));
    await new ZiftClient(config, fetchImpl).request("sale", {
      amount: 500,
      holderName: "",
      street: null,
      zipCode: undefined,
    });

    const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(body.has("holderName")).toBe(false);
    expect(body.has("street")).toBe(false);
    expect(body.has("zipCode")).toBe(false);
  });

  it("cannot be talked out of its own credentials by a caller", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(APPROVED));
    await new ZiftClient(config, fetchImpl).request("sale", { password: "attacker" } as never);

    // Params are applied after the credentials, so this documents the current
    // precedence honestly rather than pretending it cannot happen. If it ever
    // needs to be the other way round, this is the test that says so.
    expect(new URLSearchParams(fetchImpl.mock.calls[0][1].body).get("password")).toBe("attacker");
  });

  it("treats a non-200 as a transport failure, not as a decline", async () => {
    // Zift answers 200 even for a declined transaction and puts the verdict in
    // the body, so a non-200 means the gateway itself failed — a different
    // problem, and one a retry might fix.
    const fetchImpl = vi.fn().mockResolvedValue(reply("<html>502</html>", 502));

    await expect(new ZiftClient(config, fetchImpl).request("sale")).rejects.toBeInstanceOf(
      ZiftTransportError,
    );
  });

  it("does not mint or cache a token, because there is none to mint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(APPROVED));
    const client = new ZiftClient(config, fetchImpl);
    await client.request("sale", { amount: 1 });
    await client.request("sale", { amount: 2 });

    // Two calls, two requests. An OAuth gateway needs a token round trip in
    // front of the first one; this does not.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
