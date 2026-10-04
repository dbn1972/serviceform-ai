# SF-M03-003 evidence — CMP-034 Master Data Service

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED.** Builder self-certification is false.

| Field | Value |
|---|---|
| Task | SF-M03-003 |
| Component | CMP-034 |
| Base | `origin/main` `bd14a4a05fef03a7621a0bf27bc3cbac876b354b` |
| Branch | `cursor/m03-masterdata-sf-m03-003-2c63` |
| Model | Composer (Cursor cloud agent); envelope route sonnet 5.5 high |
| Frozen contracts | unchanged (13/13; no CCR) |
| `pnpm-lock.yaml` | not committed (orchestrator regen) |

## Commands (executed)

```bash
python3 scripts/gates/migration_lint.py db/migrations/1759501100000_cmp-034-master-data.sql db/migrations/1759501100001_cmp-034-outbox.sql
pnpm exec tsc --noEmit -p services/cmp-034-master-data/tsconfig.json
pnpm exec vitest run --root . --config vitest.unit.config.ts   # from services/cmp-034-master-data
DATABASE_URL=postgres://…/serviceform_test pnpm exec vitest run --root . --config vitest.integration.config.ts
python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M03-003.yaml --base origin/main
```

## Results (builder-executed)

| Check | Result |
|---|---|
| migration_lint (CMP-034 files) | PASS 0 error(s) |
| typecheck | PASS |
| unit + contract | 11 passed |
| integration (RLS, privilege, API, INT-013) | 6 passed |
| CROSS_TENANT_LEAKAGE | 0 (T2 canary absent from T1 reads/API) |
| Published-version mutation | denied (SF-SYS-003 `PUBLISHED_IMMUTABLE`) |
| INT-013 PRODUCTION SIMULATED import | fail-closed (400) |
| Host mount | not in this envelope (SF-M03-008) |

JUnit: `evidence/SF-M03-003/junit/unit.xml`, `evidence/SF-M03-003/junit/integration.xml`.

Recommended gate: **IMPLEMENTATION_READY** for independent Verify. Human/CI only.
