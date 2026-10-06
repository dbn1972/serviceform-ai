# SF-M05-STITCH-A residuals (STOP items)

Not fixed by the stitch. The authorization forbids semantic diffs to accepted trees and edits to gates/envelopes.

## R-CMP016-DOWN2 — CLASS-A TEST HARNESS / MIGRATION ORDER → return to SF-M05-002 (owning builder)

- Suite: CMP-016 PostgreSQL integration, combined tree. **19/21** (baseline 21/21).
- Failing: `test/integration/migration.int.test.ts`
  - `applies both CMP-016 migrations as the tail of the chain` — `applied().slice(-2)` returns `1759540400000_cmp-029-sla-escalation`, `1759540400001_cmp-029-outbox`.
  - `down 2 removes sf_workflow completely and up re-applies cleanly` — `down 2` rolls back CMP-029, so `sf_workflow` still exists.
- Cause: the test assumes CMP-016 (`1759540160*`) is the tail of the migration chain. In the combined tree CMP-017 (`1759540170*`) and CMP-029 (`1759540400*`) sort after it. Product migrations and source are not implicated.
- Diagnostic (not committed): with the four CMP-017/029 migration files temporarily held out, the same suite is **21/21** (`logs/cmp-016-int-diagnostic-without-later-migrations.log`). Files restored; tree clean.
- The other 19 tests pass, including all 18 `db-isolation.int.test.ts` tenant/RLS/privilege tests.
- Precedent: SF-M04-STITCH-A R-CMP008-DOWN2 (isolated migrator DB in the test harness). Here the fix belongs to the SF-M05-002 builder because any diff would break tree fidelity with `50f56af`.

## R-STITCH-A-SCOPE-LOCKFILE — CI gate vs authorized lockfile write → orchestrator / human

- CI `ci` → job `architecture gates` → step `task envelope scope (agent branches only)` fails on this `agent/` branch.
- `scripts/gates/check_scope.py` refuses `pnpm-lock.yaml` unconditionally for every envelope task, even though `orchestrator/tasks/SF-M05-STITCH-A.yaml` lists `pnpm-lock.yaml` in `allowed_write_paths`. Local reproduction: `logs/check-scope.log` (1 error, only `pnpm-lock.yaml`).
- SF-M04-STITCH-A used a `cursor/` branch, so this step never ran there.
- Resolution options (none taken here; both outside the stitch write set): orchestrator changes `check_scope.py` to honour an explicit `pnpm-lock.yaml` entry for `agent_role: integration_agent`, or human authorizes the stitch on a non-`agent/` branch as in M04.
- Note: `orchestrator/tasks/SF-M05-STITCH-A.yaml` on main still reads `state: PLANNING`, `implementation_authorized: false`. Implementation ran under the human authorization; the envelope is orchestrator-owned and unchanged.
