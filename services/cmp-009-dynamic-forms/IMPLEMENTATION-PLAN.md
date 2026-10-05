# SF-M04-005 CMP-009 Dynamic Forms Engine — implementation plan

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED. Not G6. M05 OFF.**

| Field              | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Task               | SF-M04-005                                                             |
| Component          | CMP-009                                                                |
| Integrations       | INT-011 (tenant isolation chain; re-verified later by independent INT) |
| Privilege role     | `sf_cmp009_rw` NOLOGIN (ADR-0006 Option A)                             |
| Schema             | `sf_forms`                                                             |
| Self-certification | **false**                                                              |

## Impact

- Domain: interpret and authoritatively validate tenant-pinned published FORM metadata (JSON Schema + UI schema).
- Data: `sf_forms` TENANT_SCOPED FORCE RLS; append-only snapshot and execution tables; no instance PII stored.
- Ports: `FormDefinitionPort` (published metadata), `LocalizationPort` (CMP-053), `AuthorizationPort` (OPA).
- Events: `FormValidated` on `sf.forms.events.v1` and audit outbox.
- Migration: `1759530500000_cmp-009-forms.sql`, `1759530500001_cmp-009-outbox.sql`.
- Rollback: down migration; component is not mounted until SF-M04-007.
- Lockfile: do not commit `pnpm-lock.yaml`. New workspace importer → `EXPECTED_STITCH_B_LOCKFILE_RESIDUAL`.

## Acceptance (builder evidence; not CERTIFIED)

1. Valid schema execute; invalid schema reject; UI schema; conditional visibility; required fields
2. Localization via CMP-053 port; version pin mismatch and unpublished reject
3. Wrong-tenant / leakage CROSS_TENANT_LEAKAGE=0; forged tenant headers denied
4. UX4G accessibility contract semantics without a second design system
5. Host mount deferred to SF-M04-007
