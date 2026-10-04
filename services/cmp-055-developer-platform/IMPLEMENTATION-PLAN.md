# SF-M01-W2-005 / CMP-055 implementation plan

| Field | Value |
|---|---|
| Task | SF-M01-W2-005 |
| Component | CMP-055 Developer Platform |
| Baseline | `origin/main` @ plan merge `f397e13` |
| Self-certified | false |
| CERTIFIED | false |

## Impact

| Area | Change |
|---|---|
| Domain | Developer platform helpers only; no tenant/domain state |
| Data | None (no migrations; CR-13 enforces `db/migrations` only) |
| APIs/events | Component-local OpenAPI/AsyncAPI lint helpers; no frozen contract edits |
| Tenancy/authz | N/A (tooling) |
| Tests | Unit tests under `services/cmp-055-developer-platform/test`; gate self-tests |
| Observability | Evidence manifest helper (commit SHA / run ids) |
| Rollback | Revert additive gates/workflow/service package |

## Acceptance (planning → build)

1. Existing gates still pass after additive changes
2. New workflow jobs are pin-safe and secret-free
3. Scope check + `contracts_lock_gate` remain mandatory
4. No architecture constitution or frozen hash drift
5. `migration_lint` default scan = `db/migrations`; misplaced `services/*/migrations` fail closed (CR-13)

## Stop conditions

- FROZEN contract / constitution change required → CCR/ADR
- Gate weakening requested → refuse
- Write outside allowed paths → refuse
