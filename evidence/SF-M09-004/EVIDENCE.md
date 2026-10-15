# SF-M09-004 — CMP-059 Migration Workbench evidence

Not CERTIFIED. Not G4. Not G6. Builder CANDIDATE_COMPLETE only.

| Field | Value |
|---|---|
| Task | SF-M09-004 |
| Component | CMP-059 Migration & Legacy Onboarding Workbench |
| Branch | `cursor/m09-004-migration-91f2` |
| Contract | SF-CON-MIGRATION-PROJECT (FROZEN; `dry_run_required_before_execute: true`) |
| Schema / role | `sf_migration` / `sf_cmp059_rw` |
| Integrations | INT-017, INT-011 |
| Base | `fd7492b` (Wave A READY) |

## Commands

```bash
pnpm exec vitest run \
  services/cmp-059-migration-workbench/test/unit/domain.test.ts \
  services/cmp-059-migration-workbench/test/contract/contracts.test.ts \
  services/cmp-059-migration-workbench/test/unit/plugin-http.test.ts \
  services/cmp-059-migration-workbench/test/unit/tenant-negative.test.ts
```

## Results

| Suite | Result |
|---|---|
| Unit + contract (root vitest) | 32/32 PASS |
| Frozen schema hash | matches contracts-lock `62e8b164…` |
| Projector AJV validate | PASS against SF-CON-MIGRATION-PROJECT |
| dry_run_required_before_execute gate | 422 + `DRY_RUN_REQUIRED_BEFORE_EXECUTE` |
| Tenant-negative (INT-011) | forbidden headers 403; cross-tenant 404; deny authz 403 |

Artifacts: `evidence/SF-M09-004/junit/unit.xml`, `evidence/SF-M09-004/logs/unit-contract.log`.

## Residuals

- `pnpm-lock.yaml` untouched; STITCH-A / HOST admits importer deps (`@fastify/rate-limit` deferred).
- PostgreSQL FORCE RLS integration harness present under `test/integration/`; run with `DATABASE_URL` in INT gate.
- Not self-certified.
