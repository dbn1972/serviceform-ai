# M06 contracts (FROZEN_CANDIDATE)

Status of every artifact in this directory: **FROZEN** in the freeze candidate tree.

This is the SF-M06-CG-001 portion of the **combined CG-02** freeze preparation. It appends
NEW rows to `orchestrator/contracts-lock.yaml` together with M08. Repository freeze is **not**
effective until this PR merges to `origin/main` (not authorized in this slice). Wave A is
**not** eligible. Builders remain OFF.

The existing 19 frozen contracts (13 shared + 6 M05) remain FROZEN and unmodified.

| ID | File | Owner | Subject |
|---|---|---|---|
| SF-CON-FEE-QUOTE | `schemas/fee-quote.schema.json` | CMP-020 | Deterministic fee quote; client amounts not authoritative |
| SF-CON-PAYMENT-INTENT | `schemas/payment-intent.schema.json` | CMP-021 | Amount locked from fee quote; INT-013 connector modes |
| SF-CON-PAYMENT-CALLBACK | `schemas/payment-callback.schema.json` | CMP-021 | Verified callback; INT-007 exactly-once financial effect |
| SF-CON-NOTIFICATION-DISPATCH | `schemas/notification-dispatch.schema.json` | CMP-025 | Template/channel dispatch; no raw PII; INT-013 |
| SF-CON-MESSAGE-THREAD | `schemas/message-thread.schema.json` | CMP-026 | Tenant-scoped messaging; no cross-tenant participants |

Catalog: `catalog.json`. Examples: `examples/valid`, `examples/invalid`.
Validate with `evidence/SF-M06-CG-001/validate-m06-schemas.mjs` (does not mutate `packages/contracts`).
