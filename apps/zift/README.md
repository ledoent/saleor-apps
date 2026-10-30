# Saleor Payment App — Zift

A [Saleor](https://saleor.io) Payment App for the **Zift** payment gateway
(`/gates/xurl`), supporting stored cards with Level II/III line-item data and
**ACH bank debits**.

Built by **Ledo Enterprises LLC** for Measurement Instruments' DuroPC
industrial-computer store.

There is no official Saleor app for Zift, so this is one. It is offered as a
reference implementation and as the basis of a gateway partnership
conversation.

> **Licensing.** The repository root is BSD-3-Clause, copyright Saleor
> Commerce. **This directory is not** — `apps/zift/` is original work by Ledo
> Enterprises LLC, licensed under Apache-2.0. See [LICENSE](LICENSE) and
> [NOTICE](NOTICE) in this directory, which govern it.

## What it does

The merchant sells industrial machines on invoice: an order is confirmed by a
person, freight is quoted afterwards, and lead times run to weeks. That shapes
the whole design.

```
 checkout                                  ship day
 --------                                  --------
 collect the payment method                AR presses Charge in the dashboard
   -> tokenize                              -> TRANSACTION_CHARGE_REQUESTED
   -> $0 account-verification                -> requestType=sale for the real
   -> Saleor transaction, amount 0              total, with Level III
   -> the order completes UNPAID             -> card: CHARGE_SUCCESS
                                             -> ACH:  pending, see below
```

**Nothing is charged at checkout, and nothing is authorised either.** Card
authorisations expire in about a week while lead times are longer, and the final
amount is usually *higher* once freight is quoted — so
capture-against-an-authorisation is the wrong shape. Zift's
`account-verification` is a **$0** operation that returns a durable token and
AVS results on the same call, which fits exactly: no hold on the buyer's credit
line, nothing to reverse, and no failed-reversal state to alert on.

### Webhooks

All six Saleor payment webhooks are implemented.

| Saleor webhook | Zift | Notes |
|---|---|---|
| `PAYMENT_GATEWAY_INITIALIZE_SESSION` | — | Returns the environment, the tokenizer URL and which methods are available. No credentials ever reach the browser |
| `TRANSACTION_INITIALIZE_SESSION` | `account-verification` | Stores a card or a bank account. Returns a **zero-amount** authorisation |
| `TRANSACTION_PROCESS_SESSION` | — | A structured refusal; this flow is single-step |
| `TRANSACTION_CHARGE_REQUESTED` | `sale` | Ship day. The only call that moves money |
| `TRANSACTION_REFUND_REQUESTED` | `credit` | |
| `TRANSACTION_CANCELATION_REQUESTED` | `void` | |

## The rule the whole app is built around

**An unrecognised gateway response is `unknown`, never `approved`.** Nothing may
look paid for that has not been. A wrong decline is a support call; a wrong
approval is an unpaid machine on a truck.

`manifest.test.ts` asserts no handler hard-codes a `*_SUCCESS` except the one
whose success is a statement about doing nothing. Approval also requires a
`transactionId` — a transaction that cannot be named later cannot be voided,
captured or refunded, and calling it a success would strand a real charge.

## ACH

Zift exposes bank debits through the same endpoint: `accountType` is `C`
(checking) or `S` (savings) instead of `R` (card), and the routing number
travels in `accountAccessory`, the field a card uses for its expiry. One
character in the request, and four things different everywhere else.

### 1. An acceptance is not a payment

A card `sale` approval is an issuer guaranteeing funds. An ACH `sale` acceptance
means the debit entered the network — returns arrive one to three business days
later, or after that.

So an accepted debit is answered with a `pspReference` and **no `result`**,
which is Saleor's documented async flow: it records a pending `CHARGE_REQUEST`
and waits for a `transactionEventReport`. `CHARGE_SUCCESS` there would mark a
five-figure order paid and release the machine before the money was real.
`ach-vault.test.ts` asserts the absence of a result rather than trusting the
comment.

### 2. The stored credential can be changed by the bank

Receiving banks send Notices of Change, which Zift delivers as
`processing.noc-processed`, correcting the account number, routing number,
account type, or the name on the account. An unapplied NOC is not a harmless
no-op: the next debit repeats the rejected detail and returns again, with a fee
each time — and the debit that triggered the notice may well have succeeded, so
nothing looks broken at the time.

`noc.ts` applies NACHA codes C01–C06, matches on `tokenOriginal`, and updates
**every** stored row holding that token, because the same account can be stored
against several transactions and correcting one leaves the others stale. Every
refusal carries a reason, including an unrecognised change code.

### 3. Nothing validates a bank account number

Zift's documentation is explicit that during tokenization bank account numbers
are verified *by length*, while card numbers additionally get Luhn. A card typo
fails in the browser; a bank-account typo tokenizes cleanly and surfaces a week
later as a return.

The routing number does carry a checksum, so the ABA 3-7-1 weighting is enforced
on the way in — in the tokenizer and again on the server. It is the only
integrity check available anywhere in an ACH debit.

### 4. There is no Level III

Level II/III exist to reduce card interchange. An ACH debit has none, so
`buildAchSaleParams` sends no line items at all.

### Verification before storing

Storing an account goes through `account-verification` with
`verificationMode=PF`, so the processor's verdict decides whether anything is
stored. NACHA's WEB Debit Account Validation Rule wants an account validated
before first use, and Zift's own guidance is to validate *before* tokenizing.

## Level II and III for cards

`level3.ts` maps a Saleor order to Zift's Level III fields, and
`MISSING_FOR_FULL_LEVEL_3` is the authoritative list of what a typical order
cannot supply. Three things about this API are not cosmetic:

1. **Amounts are integers of cents.** Six conversions in one request, and
   `Math.round(dollars * 100)` is not sufficient — `0.145 * 100` is
   `14.499999999999998`, so plain rounding loses a cent that decimal arithmetic
   would not. A cent lost per line is a Level III record that does not
   reconcile, and one that does not reconcile is rejected in full. See
   `money.ts`.
2. **Line items are a bracket-and-semicolon subrecord**, not JSON:
   `items=(code=001;quantity=1;description=t-shirt;totalAmount=50000)(...)`.
   `(`, `)`, `;` and `=` are structural and no escape is documented for them
   inside a value, so an ordinary catalogue string like
   `"Workstation (rugged); 64 GB"` would silently produce malformed items. They
   are neutralised once, in `subrecord.ts`, and a test asserts a product name
   cannot inject an extra line.
3. **`commodityCode` is String(4), acquirer-designated** — not the 8-digit
   UNSPSC other gateways take. It is omitted rather than invented: an
   unrecognised code can fail the record outright, where an absent optional
   field degrades to Level II.

## Status

Built, unit tested, and deployed — and **it has never talked to Zift.** One
thing gates that: no sandbox credential has been issued yet. Nothing else does.
The sandbox was probed directly on 2026-09-09 with no credentials:

```
POST https://sandbox-secure.zift.io/gates/xurl   requestType=ping
-> responseType=exception&responseCode=L01&responseMessage=Username+or+password+is+invalid.
```

It rejects on credentials and on nothing else, so `scripts/sandbox-smoke.ts`
runs the day a login arrives. Without credentials the app still boots, serves
its manifest, installs into Saleor, and declines every payment naming the
variable that is missing — deliberately; see `src/lib/env.ts`.

### What is known and what is assumed

`scripts/sandbox-smoke.ts` turns the right column into the left one.

| Known (observed or documented) | Assumed until the smoke run |
| --- | --- |
| One endpoint, `POST /gates/xurl`; `requestType` selects the operation | which `responseCode` values mean approved, soft decline, hard decline |
| Request **and response** are form-urlencoded | whether `commodityCode` is required for full Level III or merely accepted |
| Credentials are `userName`/`password`/`accountId` inline — no OAuth, no token to cache | the exact field list of a Level III `items` subrecord beyond code/quantity/description/totalAmount |
| Amounts are integers **of cents** | whether descriptions have an escape for `(`, `)`, `;`, `=` |
| `responseType` echoes the request on success, is `exception` on failure | `transactionIndustryType` for a bank debit (`RE` is sent, copied from the card sale) |
| `account-verification` is $0, returns a token, and applies to bank accounts as well as cards | the SEC / entry-class code an ACH debit settles under, and whether Zift derives it from `holderType` |
| `accountAccessory` is required on a charge **even with a token** — card expiry, or ACH routing number | the response field carrying a masked bank account number |
| `accountType`: `R` card, `C` checking, `S` savings | which `responseCode` values are an ACH *acceptance* rather than an approval |
| `holderType`: `P` personal, `O` organization; `O` required for Level II/III | |
| `verificationMode`: `NN` none, `PF` processor verifies and declines tokenization on failure | |
| NOC arrives as `processing.noc-processed` with `*Updated` fields | |

## Open questions for Zift

These are the things the documentation does not settle, and they are the reason
this repository exists as something to talk about.

1. **Where does the buyer's PO number belong?** `orderCode` is the *merchant's*
   order id. No published field is obviously the buyer's own PO — which is the
   number a purchasing-card holder reconciles against, and what other gateways
   expose as a customer reference.
2. **What `commodityCode` does the acquirer expect?** It is String(4) and
   acquirer-designated, and nothing in the docs says which values apply.
3. **How is a notification authenticated?** `noc.ts` has the decision logic and
   deliberately **no HTTP endpoint**: the envelope and the authentication of a
   Zift callback are not in the public docs, and an unauthenticated endpoint
   that rewrites stored payment credentials is the worst thing here to guess at.
4. **Which response codes are an ACH acceptance, a soft decline, and a hard
   decline?** Anything unrecognised is currently treated as a failure, which is
   safe and coarse.
5. **Is there a settlement notification**, so a pending ACH charge can be
   resolved to `CHARGE_SUCCESS` without polling?
6. **Does the tax split matter?** Level III wants a local/national tax
   breakdown; a single total is what most tax services return.

## A note on PCI scope

**Read this before wiring a browser to this app.**

Zift documents two ways to collect a card and neither is an iframe:
**Hosted Payment Pages**, which is a redirect, and **proxynization.js**, which
in Zift's words lets you *"create your own payment page and utilize our
proxynization API to help reduce your PCI scope."*

Proxynization reads the card from an input element on the merchant's own page
and posts it to Zift from the browser. That keeps the PAN off the merchant's
*servers*. It does not keep it out of the merchant's *page* — and under the PCI
SSC's own division, a redirect or a third-party iframe is SAQ A eligible, while
a merchant-script or Direct Post implementation is SAQ A-EP. The delta is
roughly 20-odd requirements against something between 140 and 190, plus
quarterly ASV scanning.

That is a statement about the SAQ split, not a criticism of the product: the
claim "reduce your PCI scope" is accurate. It is simply a different claim from
SAQ A eligibility, and which one a merchant needs is a decision for whoever
signs the attestation. **Nobody here is a QSA.**

For that reason **this app ships no browser component** and stops at the server
boundary. The mock environment serves a stand-in tokenizer for development only.

## `ZIFT_ENVIRONMENT=mock`

Three environments, not two: `production`, `sandbox`, and `mock`. An environment
should be able to work before the vendor's paperwork does. `mock` answers from a
table and serves its own stand-in tokenizer at `/api/mock/proxynization`, which
a storefront mounts exactly as it mounts Zift's real script.

| Test card | What it does |
|---|---|
| `4111 1111 1111 1111` | Visa — approves, address matches |
| `5454 5454 5454 5454` | Mastercard commercial — approves, address matches |
| `4000 0000 0000 0002` | Visa — declines |
| `4000 0000 0000 0010` | Visa — **approves, address does NOT match** |

| Test bank account | Routing | What it does |
|---|---|---|
| `1234567890` | `011000015` | Business checking — verifies, debit accepted and left **pending** |
| `9876543210` | `021000021` | Savings — verifies, debit accepted and left **pending** |
| `0000000001` | `121000358` | Checking — **verification fails, nothing is stored** |

The last of each is the one worth clicking. The card stores *and* records a
failed AVS, which is the gap `verification.ts` exists for. The bank account
fails verification under `verificationMode=PF`, so nothing is stored at all.

**The rule this mode enforces:** a real card number can never produce an
approval. The mock only recognises tokens its own tokenizer minted, so a
half-configured environment where the browser reaches a real Zift cannot store a
token no processor has heard of. An order that cannot be collected is worse than
one that was never taken.

Card charge and refund are deliberately **not** mocked: they run against a real
processor and a mocked approval would be a fake receipt for a machine on a
truck. An ACH debit *is* mocked, which follows from the same rule rather than
breaking it — an accepted debit is pending, not paid, so it cannot be a fake
receipt, and being able to demonstrate that it stays pending is the point.
Settlement and returns stay unmocked.

`mock` must never be set once real orders are being taken.

## Running it

```sh
pnpm install --frozen-lockfile
pnpm test          # 182 unit tests, no network, no merchant account
pnpm check-types
pnpm smoke         # needs .env; see .env.example
```

Postgres is required at runtime for the APL and the stored-token table
(`pnpm migrate`). Nothing in the test suite touches a database or a network.

## Security

Credentials are read from the environment, never from Saleor app metadata, which
is readable by anyone holding `MANAGE_APPS`. The request body carrying
`userName`/`password` must never be logged at any level, including error paths.

There is no column for a PAN, a CSC, or a bank account number, and there must
never be one — a CSC may not be retained after authorisation under any
circumstances, and a schema is where that rule gets quietly broken first.

To report a vulnerability, see [SECURITY.md](SECURITY.md).
