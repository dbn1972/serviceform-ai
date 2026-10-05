# SF-M04-006 CMP-014 Document Intelligence / OCR: implementation plan

Status: **DEVELOP complete (builder)**. **Not VERIFIED. Not CERTIFIED. Not G6.** M05 OFF.

| Field | Value |
|---|---|
| Task | SF-M04-006 |
| Component | CMP-014 |
| Integrations | INT-011 (tenant isolation), INT-013 (SIMULATED OCR, fail-closed in production) |
| Privilege role | `sf_cmp014_rw` NOLOGIN (ADR-0006 Option A) |
| Schema | `sf_docintel` (TENANT_SCOPED + FORCE RLS; outbox/inbox PLATFORM_OPERATIONAL where templated) |

## Impact plan

- Domain: OCR orchestration, classify/redact before CMP-039, structured extraction, confidence, provenance, human review. Assistive only.
- Data: `extraction_policy` (insert-only), `intelligence_job` (deterministic transitions + decision-boundary CHECKs), idempotency, SF-CON-OUTBOX copy.
- APIs/events: component-local OpenAPI + AsyncAPI. Shared frozen contracts consumed, not changed.
- Tenancy/authz: server-derived context; OPA; FORCE RLS; source ACL before gateway.
- Transactions: OCR and CMP-039 invoke are outside DB transactions.
- Migration: `1759530600000_cmp-014-document-intelligence.sql`, `1759530600001_cmp-014-outbox.sql`.
- Host mount: deferred to SF-M04-007.

## Residuals

- `EXPECTED_STITCH_B_LOCKFILE_RESIDUAL`: new workspace importer `@serviceform/cmp-014-document-intelligence` is not in `pnpm-lock.yaml` (builders must not commit the lockfile). Isolated CI `pnpm install --frozen-lockfile` may go red solely for that importer. Do not weaken frozen-lockfile CI.
