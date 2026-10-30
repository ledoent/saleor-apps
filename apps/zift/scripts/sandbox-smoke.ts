/**
 * What Zift's sandbox actually does, printed.
 *
 * This can run the moment a login exists — there is no registry-issued header
 * standing in front of the gateway, so nothing gates the integration except the
 * credential itself. This script is how the assumptions get proven rather than
 * asserted.
 *
 *   ZIFT_USERNAME, ZIFT_PASSWORD, ZIFT_ACCOUNT_ID   required
 *   ZIFT_TOKEN + ZIFT_ACCOUNT_ACCESSORY             enables the vault and charge ladder
 *
 * Put them in `.env`, which `pnpm smoke` loads and .gitignore covers.
 * A file rather than a shell export: a password on a command line lands in
 * shell history and in the process table.
 *
 * WHAT IT WILL NOT DO
 *
 * Send a card number — not even a sandbox test card. There is no code path here
 * that accepts a PAN, because the moment one exists somebody runs it against a
 * live account. Get a token from proxynization.js in a browser, or from a
 * previous sale, and supply it.
 *
 * WHAT TO WRITE DOWN WHEN IT RUNS
 *
 * The response codes. Zift documents separate approval, soft-decline and
 * hard-decline tables that this app has not read, and until it has,
 * `transactions.ts` cannot tell a retryable decline from a final one. The codes
 * this prints are the first thing to feed back into that module.
 */

import { ZiftClient } from "../src/modules/zift/client";
import { configFromEnv } from "../src/modules/zift/config";
import { buildLevelThreeParams, LEVEL_3_HOLDER_TYPE, MISSING_FOR_FULL_LEVEL_3 } from "../src/modules/zift/level3";
import { interpretTransaction } from "../src/modules/zift/transactions";
import { assessVerification } from "../src/modules/zift/verification";

const show = (label: string, value: unknown) => {
  console.log(`\n--- ${label} ---`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
};

const skip = (label: string, why: string) => console.log(`\n--- ${label}: skipped --- ${why}`);

const main = async () => {
  const config = configFromEnv();
  if (!config.configured) {
    console.error(config.reason);
    process.exitCode = 1;
    return;
  }

  if (config.environment !== "sandbox") {
    // This script stores cards and moves money. It does not do that against a
    // live merchant account, however carefully the operator meant it.
    console.error("Refusing to run against production. Unset ZIFT_ENVIRONMENT or set it to sandbox.");
    process.exitCode = 1;
    return;
  }

  console.log(`Zift sandbox at ${config.gatewayUrl}, account ${config.accountId}`);
  const client = new ZiftClient(config);

  // 1. Prove the credentials. Nothing else can run if this is wrong, and the
  //    message Zift returns is the one that says whether it is the password,
  //    the account id, or the user being disabled.
  const ping = await client.request("ping");
  show("requestType=ping", ping);
  if (ping.responseType === "exception") {
    console.error("\nCredentials rejected. Everything below needs them; stopping here.");
    process.exitCode = 1;
    return;
  }

  const token = process.env.ZIFT_TOKEN;
  const accountAccessory = process.env.ZIFT_ACCOUNT_ACCESSORY;

  if (!token || !accountAccessory) {
    skip("vault and charge ladder", "set ZIFT_TOKEN and ZIFT_ACCOUNT_ACCESSORY (MMYY) to go further");
    show("Level 3 fields we cannot fill, for the conversation with Zift", MISSING_FOR_FULL_LEVEL_3);
    return;
  }

  // 2. The $0 verification that mints a durable token — no hold, nothing to
  //    reverse.
  const verified = await client.request("account-verification", {
    accountType: "R",
    token,
    accountAccessory,
    holderName: "Smoke Test",
    zipCode: "18042",
  });
  show("requestType=account-verification ($0)", verified);
  show("interpreted", interpretTransaction("account-verification", verified));
  show(
    "verification",
    assessVerification({
      avsResponse: verified.avsResponseCode,
      cscResponse: verified.cscResponseCode,
      approved: true,
    }),
  );

  const durable = verified.token || token;

  // 3. A charge with Level II/III attached, which is the whole economic case.
  const level3 = buildLevelThreeParams({
    orderCode: `smoke-${Date.now()}`.slice(0, 17),
    orderDate: new Date().toISOString(),
    lines: [
      {
        productName: "DuroPC Rugged Workstation",
        variantName: "64 GB",
        sku: "DPC-RW-64",
        quantity: 1,
        unitPriceNet: 10,
        totalTax: 0.7,
      },
    ],
    shippingNet: 2,
    shippingTax: 0.14,
    destinationPostalCode: "18042",
  });
  show("Level II/III parameters as this app builds them", level3);

  const sale = await client.request("sale", {
    accountType: "R",
    token: durable,
    accountAccessory,
    holderName: "Smoke Test",
    holderType: LEVEL_3_HOLDER_TYPE,
    transactionIndustryType: "RE",
    amount: 1284,
    zipCode: "18042",
    ...level3,
  });
  show("requestType=sale with Level II/III", sale);
  show("interpreted", interpretTransaction("sale", sale));

  const reference = sale.transactionId;
  if (!reference) {
    console.log("\nNo transactionId on the sale, so there is nothing to reverse. Stopping here.");
    return;
  }

  // 4. Leave the sandbox as we found it. Void is the same-batch path; if it has
  //    settled the refund is the one that works. Both answers are useful, which
  //    is why neither is treated as an error.
  show("requestType=void", await client.request("void", { transactionId: reference }));
  show("requestType=refund", await client.request("refund", { transactionId: reference, amount: 1284 }));

  show("Level 3 fields we still cannot fill", MISSING_FOR_FULL_LEVEL_3);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
