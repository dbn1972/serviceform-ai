# SF-M08-002 CMP-007 Recommendation Engine: implementation plan

Status: **DEVELOP complete (builder candidate)**. **Not VERIFIED. Not CERTIFIED. Not G3. Not G6.**

| Field | Value |
|---|---|
| Task | SF-M08-002 (CG-02 Wave A) |
| Component | CMP-007 |
| Integrations | INT-003 (recommendation -> draft, non-authoritative), INT-011 (tenant isolation) |
| Requirements | Eng-v1.4-CMP-007, INT-003, AI-GOVERNANCE-via-CMP-039 |
| Privilege role | `sf_cmp007_rw` NOLOGIN (ADR-0006 Option A) |
| Schema | `sf_recommendation` (TENANT_SCOPED + FORCE RLS; outbox/inbox templated) |
| Frozen contracts consumed | SF-CON-RECOMMENDATION and the 28 other FROZEN contracts (read-only; `CCR_REQUIRED=false`) |

## Impact plan

- Domain: coded, aliased, consent-gated recommendation; policy-pinned reason/signal lists; citizen
  disposition. No statutory decision, no application/case/fee/payment writes.
- Data: `recommendation_policy` (insert-only), `recommendation` (transition guard + decision-boundary
  CHECKs, immutable content once generated), idempotency, SF-CON-OUTBOX copy.
- APIs/events: component-local OpenAPI + AsyncAPI; shared frozen contracts consumed, not changed.
- Tenancy/authz: server-derived context, OPA, FORCE RLS, owner checks, cross-tenant 404.
- Transactions: consent, catalogue, profile and CMP-039 calls are outside DB transactions; claim +
  insert in a first short transaction, finalise in a second.
- Migration: `1759550070000_cmp-007-recommendation.sql`, `1759550070001_cmp-007-outbox.sql`
  (down drops schema; privilege role retained).
- Rollback: down migration; no shared state mutated.
- Host mount: deferred to SF-M08-007.

## Residuals

- `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`: new workspace importer
  `@serviceform/cmp-007-recommendation` is not in `pnpm-lock.yaml` (builders must not commit the
  lockfile). Isolated CI `pnpm install --frozen-lockfile` may go red solely for that importer.
  Do not weaken frozen-lockfile CI.
- An idempotency key whose first transaction committed but whose finalisation failed stays
  `IN_PROGRESS` until TTL (replay returns `SF-APP-002`); the row is recoverable via GET.
