/**
 * The mock stand-in for Zift's proxynization.js.
 *
 * `config.ts` points `proxynizationScriptUrl` here when `ZIFT_ENVIRONMENT=mock`,
 * so the storefront mounts this exactly as it would mount Zift's own script —
 * a `<script src>` whose only requirement is the content type. Nothing in
 * `CardFields` knows which one it got.
 *
 * WHY THIS SHAPE
 *
 * Zift's proxynization is not hosted fields: it reads the card out of inputs on
 * the merchant's page rather than an iframe of its own (see the header of
 * webhooks/payment-gateway-initialize-session.ts, and the PCI consequence
 * discussed there and in the README). This mock is faithful to that — it takes
 * values the page already holds and hands back a token.
 *
 * **The real global's exact name and signature are unverified.** No sandbox
 * login exists yet, so the contract below is ours, not Zift's, and the day a
 * credential arrives it is the first thing the smoke ladder settles. When it
 * changes, this file and `CardFields` change together and nothing else does.
 *
 * The table is generated from MOCK_CARDS so the browser and the gateway cannot
 * disagree about which numbers are test cards.
 */

import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/lib/env";
import { MOCK_BANK_ACCOUNTS, MOCK_CARDS, MOCK_TOKEN_PREFIX } from "@/modules/zift/mock";

const script = () => {
  const cards = MOCK_CARDS.map((card) => ({
    pan: card.pan,
    scenario: card.scenario,
    label: card.label,
    brand: card.brand,
  }));

  const banks = MOCK_BANK_ACCOUNTS.map((account) => ({
    accountNumber: account.accountNumber,
    routingNumber: account.routingNumber,
    accountType: account.accountType,
    scenario: account.scenario,
    label: account.label,
  }));

  return `/* Mock Zift proxynization. Serves ${cards.length} test cards and ${banks.length} test bank accounts. Not a real gateway. */
(function () {
  "use strict";

  var CARDS = ${JSON.stringify(cards)};
  var BANKS = ${JSON.stringify(banks)};
  var PREFIX = ${JSON.stringify(MOCK_TOKEN_PREFIX)};

  function digits(value) {
    return String(value == null ? "" : value).replace(/\\D/g, "");
  }

  function nonce() {
    return Math.random().toString(36).slice(2, 10);
  }

  function find(pan) {
    var wanted = digits(pan);
    for (var i = 0; i < CARDS.length; i++) {
      if (CARDS[i].pan === wanted) return CARDS[i];
    }
    return null;
  }

  /**
   * Rejects anything that is not a published test card, which is the same rule
   * the gateway enforces server-side. Two checks rather than one because this
   * one can give the tester a useful message, and that one cannot be bypassed.
   */
  function tokenize(input) {
    input = input || {};
    var card = find(input.pan);

    if (!card) {
      return Promise.reject(
        new Error(
          "This environment runs a mock payment gateway and only accepts its published test cards. Nothing is charged and no real card will work here."
        )
      );
    }

    if (digits(input.expiry).length < 4) {
      return Promise.reject(new Error("Enter the card expiry as MMYY."));
    }

    return Promise.resolve({
      token: PREFIX + "-" + card.scenario + "-" + nonce(),
      brand: card.brand,
      lastFour: card.pan.slice(-4),
      accountAccessory: digits(input.expiry).slice(0, 4)
    });
  }

  function findBank(accountNumber) {
    var wanted = digits(accountNumber);
    for (var i = 0; i < BANKS.length; i++) {
      if (BANKS[i].accountNumber === wanted) return BANKS[i];
    }
    return null;
  }

  /**
   * The ABA checksum, mirrored from ach.ts.
   *
   * Checked in the browser as well as the server because this is the one typo
   * in an ACH debit that anything can catch, and catching it at the keyboard
   * beats catching it as a return a week later.
   */
  function routingValid(routing) {
    var d = digits(routing);
    if (d.length !== 9) return false;
    var weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += Number(d.charAt(i)) * weights[i];
    return sum % 10 === 0;
  }

  function tokenizeBankAccount(input) {
    input = input || {};
    var account = findBank(input.accountNumber);

    if (!account) {
      return Promise.reject(
        new Error(
          "This environment runs a mock payment gateway and only accepts its published test bank accounts. Nothing is debited and no real account will work here."
        )
      );
    }

    if (!routingValid(input.routingNumber)) {
      return Promise.reject(new Error("That is not a valid nine-digit ABA routing number."));
    }

    if (digits(input.routingNumber) !== account.routingNumber) {
      return Promise.reject(
        new Error("Use the routing number published alongside this test account.")
      );
    }

    return Promise.resolve({
      token: PREFIX + "-" + account.scenario + "-" + nonce(),
      accountType: account.accountType,
      routingNumber: account.routingNumber,
      lastFour: account.accountNumber.slice(-4)
    });
  }

  window.ZiftProxynization = {
    mock: true,
    testCards: CARDS,
    testBankAccounts: BANKS,
    tokenize: tokenize,
    tokenizeBankAccount: tokenizeBankAccount
  };
})();
`;
};

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  if (env.ZIFT_ENVIRONMENT !== "mock") {
    // Serving a tokenizer that mints unbacked tokens from an environment wired
    // to a real gateway is the one way this file could do harm. It is off
    // unless the environment says mock.
    return res.status(404).json({ error: "Not found." });
  }

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  // Short, so editing the table does not strand testers on a cached copy.
  res.setHeader("Cache-Control", "public, max-age=60");
  // The storefront is a different origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).send(script());
}
