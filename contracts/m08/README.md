# M08 contracts (FROZEN_CANDIDATE)

Status of every artifact in this directory: **FROZEN** in the freeze candidate tree.

This is the SF-M08-CG-001 portion of the **combined CG-02** freeze preparation. It appends
NEW rows to `orchestrator/contracts-lock.yaml` together with M06. Repository freeze is **not**
effective until this PR merges to `origin/main` (not authorized in this slice). Wave A is
**not** eligible. Builders remain OFF.

The existing 19 frozen contracts (13 shared + 6 M05) remain FROZEN and unmodified.

| ID | File | Owner | Subject |
|---|---|---|---|
| SF-CON-SEARCH-DOCUMENT | `schemas/search-document.schema.json` | CMP-035 | Tenant-safe search index document |
| SF-CON-DISCOVERY-QUERY | `schemas/discovery-query.schema.json` | CMP-006 | Discovery query with catalogue pins |
| SF-CON-RECOMMENDATION | `schemas/recommendation.schema.json` | CMP-007 | NON_AUTHORITATIVE; CMP-039 only |
| SF-CON-ANALYTICS-METRIC | `schemas/analytics-metric.schema.json` | CMP-045 | Aggregates only; no raw PII |
| SF-CON-RETENTION-POLICY | `schemas/retention-policy.schema.json` | CMP-049 | Policy-neutral shape; owner period input required |

`STATUTORY_RETENTION_POLICY_INPUT_REQUIRED=true` remains. No invented retention periods.

Catalog: `catalog.json`. Examples: `examples/valid`, `examples/invalid`.
Validate with `evidence/SF-M08-CG-001/validate-m08-schemas.mjs` (does not mutate `packages/contracts`).
