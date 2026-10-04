# SF-M03-001 builder evidence (not CERTIFIED)

| Field | Value |
|---|---|
| Task | SF-M03-001 |
| Component | CMP-001 |
| Base | origin/main `bd14a4a` |
| Recommended gate | DEVELOP complete; Verify pending independent stitch/security |
| CERTIFIED | **false** |

Commands (local builder):

- `python3 scripts/gates/migration_lint.py db/migrations/1759510000000_cmp-001-catalogue.sql db/migrations/1759510000001_cmp-001-outbox.sql`
- `python3 scripts/gates/check_scope.py --envelope orchestrator/handovers/SF-M03-001.yaml --base origin/main`
- `pnpm --filter @serviceform/cmp-001-catalogue run typecheck`
- `pnpm --filter @serviceform/cmp-001-catalogue run test:unit`
- `pnpm --filter @serviceform/cmp-001-catalogue run test:integration` (requires `DATABASE_URL`)

INT-011: tenant FORCE RLS + privilege-boundary tests (`CROSS_TENANT_LEAKAGE=0` canary).
INT-013: plugin fail-closed on PRODUCTION + critical SIMULATED.
INT-002: catalogue events/APIs for later Studio → maker-checker (SF-M03-004 owns publish).

Frozen contracts: unchanged.
