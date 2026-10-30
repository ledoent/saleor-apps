# Saleor App: Paya (Sage Payments)

A Saleor Payment App for the Paya / Sage Payments Bankcard API, built for
B2B card acceptance where **Level 3 line-item data** is the point.

## Why this app exists

Paya attaches a *default* Level 3 record to commercial-card transactions, which
qualifies partially. Full line-item detail must be POSTed to
`/v2/transactionlevel3s`, and that is what earns the interchange reduction —
roughly 0.5–1.5% on a commercial card. The WooCommerce gateway the legacy
DuroPC store used never made that call.

Since Visa retired standalone Level 2 interchange on 18 April 2026 under its
Commercial Enhanced Data Program, full Level 3 is the only route to a Visa
discount. Mastercard still recognises both.

## Before trusting any of this

Level 3 must be **enabled for the merchant location**, and eligibility varies by
backend processor. A correct integration on a location that is not enabled
qualifies for nothing. `PayaClient.isLevel3EnabledForLocation()` performs the
check Paya documents: run a transaction, then expand `transaction_level3` and
see whether it is populated or null.

## Provenance and licence

Written against Paya's public API documentation. **No code is derived from the
GPL v3 WooCommerce gateway plugin** the legacy site used; this repository is
BSD-3 and the two licences are incompatible. The plugin was read only to
establish which API generation the merchant account uses (v2 REST at
`api.sagepayments.com`, not the older `eftbankcard.dll` endpoint).

## Status

Scaffold. Level 3 mapping and the API client are implemented and unit-tested.
The six Saleor payment webhooks are stubbed and not yet wired to Paya
authorise/capture calls.
