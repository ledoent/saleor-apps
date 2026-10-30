# Security

## Reporting a vulnerability

Report privately to **security@ledoweb.com**. Please do not open a public issue
for anything exploitable.

Include what you can: the affected file or endpoint, a description of the
impact, and a reproduction if you have one. You will get an acknowledgement
within three business days.

## Scope

This is a Saleor Payment App. The things most worth looking at:

- **`src/modules/zift/transactions.ts`** — the approval/decline interpretation.
  Any input that makes an unrecognised or failed gateway response read as
  `approved` is the highest-severity bug in this repository.
- **`src/modules/zift/ach-vault.ts`** — an accepted ACH debit must never report
  `CHARGE_SUCCESS`. A path that marks a pending debit paid is the ACH
  equivalent of the above.
- **`src/modules/zift/noc.ts`** — Notice-of-Change handling rewrites stored
  payment credentials. Anything that applies a correction to the wrong record,
  or applies an unvalidated one, matters here.
- **`src/modules/zift/subrecord.ts`** — Level III line items are encoded in a
  delimiter-structured format with no documented escape. Injection of an extra
  item through a product name or SKU is in scope.
- **Credential handling** — `userName`, `password` and `accountId` travel in
  the request body. Any path that logs a request body, including error paths,
  is a finding.

## Out of scope

- Zift's own gateway, and Saleor itself.
- The `mock` environment's test cards and test bank accounts. They are
  published fixtures and mint tokens no processor honours.
- Dependency advisories with no demonstrated path through this code — report
  those upstream.

## What this is not

Nothing here has been assessed by a Qualified Security Assessor, and no part of
this repository is a PCI DSS or NACHA attestation. The README's discussion of
SAQ scope is engineering context for implementers. A merchant's compliance
posture is the merchant's own.
