# SF-M05-003 builder evidence: CMP-017 Work Queue / Human Task

Builder output only. **Not verified. Not CERTIFIED. Not G4. Not G6.** Independent verification (opus route),
security, integration/stitch and evidence roles are separate and later. No merge.

- Task: SF-M05-003, component CMP-017, integrations INT-005 / INT-011.
- Base: `origin/main` at prefix `6e9f0481` (the exact authorized base).
- Branch: `agent/M05-tasks-SF-M05-003`. Implementation commit prefix: `bfeb12d3`.
- CI run IDs for the frozen head are recorded in the builder freeze report (a run ID cannot be committed
  before the run exists); they bind to the final head SHA of the PR.

## Executed locally (PostgreSQL 16.15, Node 22.14, pnpm 10.28.0)

| Check | Result | Log |
|---|---|---|
| `pnpm format:check` | exit 0 | `logs/format.txt` |
| `pnpm lint` (max-warnings 0) | exit 0 | `logs/lint.txt` |
| `pnpm typecheck` (includes CMP-017) | exit 0 | `logs/typecheck.txt` |
| `pnpm test:coverage` (whole repo) | 169 files / 940 tests pass; thresholds met (lines 88.2%) | `logs/root-test-coverage.txt` |
| CMP-017 unit + contract tests | 7 files / 74 tests pass (about 97% of CMP-017 source lines) | `logs/service-unit.txt` |
| CMP-017 PostgreSQL integration tests | 3 files / 21 tests pass | `logs/service-integration.txt` |
| `pnpm db:test` (all migrations up/down, RLS harness) | 3 files / 17 tests pass | `logs/db-test.txt` |
| `scripts/gates/migration_lint.py` | PASS | `logs/migration-lint.txt` |
| `scripts/gates/run_all.py` | 10/10 gates PASS | `logs/gates.txt` |
| gate self-tests | 25 passed | `logs/gate-selftests.txt` |
| contracts lock | 19 contracts, 19 FROZEN, PASS | `logs/contracts-lock.txt` |
| `pnpm contracts:validate`, `pnpm deps:graph` | exit 0 | `logs/contracts-validate.txt`, `logs/deps-graph.txt` |
| write scope vs `orchestrator/tasks/SF-M05-003.yaml` | PASS | `logs/write-scope.txt` |

`contracts/**`, `orchestrator/contracts-lock.yaml`, `pnpm-lock.yaml`, `apps/**`, `specs/**` are untouched.

## Required negative tests (all executed)

| Requirement | Unit/contract | PostgreSQL integration |
|---|---|---|
| Wrong tenant denied, CROSS_TENANT_LEAKAGE=0 | `test/unit/negative.test.ts` "wrong tenant is denied and leaks nothing" | `api-flow.int.test.ts` "wrong tenant ...", `privilege-rls.int.test.ts` "tenant isolation (FORCE RLS)" |
| Unauthorized claim denied | `negative.test.ts` "unauthorized claim is denied (OPA)" | `api-flow.int.test.ts` "unauthorized claim and reassignment are denied and audited" |
| Unauthorized reassignment denied | `negative.test.ts` "unauthorized reassignment is denied" | same |
| Named-officer published assignment rejected | `domain.test.ts`, `negative.test.ts`, `contracts.test.ts` (frozen invalid example fails the frozen schema) | `api-flow.int.test.ts`, `privilege-rls.int.test.ts` "assignment is criteria only" |
| Cross-component direct SQL rejected | `boundaries.test.ts` (guard + static scan), `pg-repository.test.ts` | `privilege-rls.int.test.ts` "component privilege boundary (ADR-0006)" |
| Completed/closed task cannot be reclaimed | `negative.test.ts` "completed or closed tasks cannot be reclaimed" | `api-flow.int.test.ts` "a completed task cannot be reclaimed ...", `privilege-rls.int.test.ts` "completed and cancelled/closed tasks are immutable" |

## Known limitations recorded for the verifier

1. `task_state` in `SF-CON-HUMAN-TASK` event data is the state after the operation (the frozen schema is silent).
2. The component is a dependency-free workspace project so that no lockfile change is needed; STITCH-A can admit a
   `@serviceform/contracts` importer. See `services/cmp-017-work-queue-tasks/README.md`.
3. Integration tests (`*.int.test.ts`) need PostgreSQL and are not part of the repository-wide CI jobs; they were
   executed locally for this evidence and should be re-run by the independent verifier.
4. A real OPA bundle is not exercised here (a contract-validating PDP double is). INT-005 end-to-end against the
   real PDP belongs to SF-M05-INT.
