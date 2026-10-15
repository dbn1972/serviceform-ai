# M09 contracts (FROZEN_CANDIDATE)

Status of every artifact in this directory: **FROZEN** in the freeze candidate tree.

This is the SF-M09-CG-001 freeze preparation (LOCK-2, authorized by
`HUMAN_CG03_THROUGH_EVD_AUTHORIZATION`). It appends eight NEW rows to
`orchestrator/contracts-lock.yaml` (lock v2.7). Repository freeze is **not** effective until this
branch merges to `origin/main`. Wave A is **not** eligible. Builders remain OFF.

The existing 34 frozen contracts (13 shared + 6 M05 + 5 M06 + 5 M08 + 5 M07) remain FROZEN and unmodified.

| ID | File | Owner | Subject |
|---|---|---|---|
| SF-CON-APPOINTMENT | `schemas/appointment.schema.json` | CMP-056 | Appointment / slot booking; atomic capacity; notify failure ≠ cancel |
| SF-CON-ASSISTED-SESSION | `schemas/assisted-session.schema.json` | CMP-057 | Assisted session; `applied_by` ≠ `applied_for` |
| SF-CON-SEMANTIC-ELEMENT | `schemas/semantic-element.schema.json` | CMP-058 | Canonical semantic element version |
| SF-CON-MIGRATION-PROJECT | `schemas/migration-project.schema.json` | CMP-059 | Migration project; dry-run required before execute |
| SF-CON-RISK-ASSESSMENT | `schemas/risk-assessment.schema.json` | CMP-060 | Explainable risk signals; non-authoritative |
| SF-CON-PRIVACY-REQUEST | `schemas/privacy-request.schema.json` | CMP-061 | Privacy rights request; orchestration only; no cross-SQL |
| SF-CON-SFPACKAGE-MANIFEST | `schemas/sfpackage-manifest.schema.json` | CROSS | Signed `.sfpackage` manifest; no embedded secrets |
| SF-CON-BPMN-PROFILE | `schemas/bpmn-profile-report.schema.json` | CROSS | BPMN profile report; Temporal remains runtime |

## Invariants encoded

- Appointment capacity is atomic; notification failure must not invalidate a committed booking.
- Assisted session requires `applied_by_distinct_from_applied_for: true`.
- Risk assessment never makes an authoritative decision (`authoritative_decision_by_this_component: false`).
- Migration requires dry-run evidence before execute.
- Privacy Centre orchestrates owner-domain tasks only; direct cross-component mutation forbidden.
- `.sfpackage` manifests forbid embedded secrets.
- BPMN interchange does not replace Temporal; canonical model remains ServiceForm Workflow Model.
- No invented statutory calendars, representation authority, eligibility, fee, or privacy statute.

Catalog: `catalog.json`. Examples: `examples/valid`, `examples/invalid` (every contract has both).
Validate with `node evidence/SF-M09-CG-001/validate-m09-schemas.mjs` (does not mutate `packages/contracts`).
