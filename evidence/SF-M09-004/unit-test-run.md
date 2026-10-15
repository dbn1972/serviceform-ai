# CMP-059 Migration Workbench – Unit Test Evidence

Component: CMP-059 Migration & Legacy Onboarding Workbench
Task: SF-M09-004
Branch: cursor/m09-004-migration-91f2
Base commit: fd7492b398b2945713957a53b42c4717a7940c3f
Model: Claude Sonnet 4.6 (claude-sonnet-4-5 routed as sonnet)
Run date: 2026-10-15T15:30:52Z
Environment: LOCAL

## Command

```
cd /workspace/services/cmp-059-migration-workbench && pnpm run test:unit
```

## Result

```
Test Files  4 passed (4)
     Tests  42 passed (42)
  Start at  15:30:52
  Duration  510ms
```

## Test files

| File | Tests | Status |
|---|---|---|
| test/contract/contracts.test.ts | 17 | PASS |
| test/unit/domain.test.ts | 16 | PASS |
| test/unit/plugin-http.test.ts | 5 | PASS |
| test/unit/tenant-negative.test.ts | 4 | PASS |

## Typecheck

```
cd /workspace/services/cmp-059-migration-workbench && pnpm run typecheck
# Exit code 0 – no type errors
```

## Key invariants verified

- `dry_run_required_before_execute = true`: execute rejected (422 + `DRY_RUN_REQUIRED_BEFORE_EXECUTE`) when project is not `DRY_RUN_DONE`
- Tenant isolation (INT-011): cross-tenant access returns 404; forbidden headers return 403
- Authorizer deny returns 403
- Full lifecycle: project → profile → mapping → dry-run → execute → reconciliation (all PASSED)
- All 4 required events (MigrationDryRunCompleted, MigrationBatchApplied, MigrationReconciliationFailed, MigrationCompleted) present in outbox

## Gate status (self-assessed, NOT certified)

CANDIDATE_COMPLETE. Awaiting independent integration/security/evidence gate.
