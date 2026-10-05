# SF-M05-002 — CMP-016 Workflow Engine: builder evidence

Builder evidence only. **Not CERTIFIED. Not G4. Not G6. Builder does not self-certify.**
Independent INT / SEC / EVD verification is still required (SF-M05-INT, SF-M05-SEC, SF-M05-EVD).

| Field | Value |
|---|---|
| Task / component | SF-M05-002 / CMP-016 (INT-005, INT-011) |
| Base SHA | `6e9f0481eb3007dedee5580838cab59ceea66f03` |
| Code SHA under test | `bb667e4a2abfc7106acc04928950c7e785658915` (`logs/commit-sha.txt`) |
| Branch / PR | `agent/M05-workflow-SF-M05-002` / [#89](https://github.com/dbn1972/serviceform-ai/pull/89) (draft) |
| Environment | Local: Node 22.14.0, pnpm 10.28.0, PostgreSQL 16, Python 3 + `scripts/requirements.txt` |
| Model | claude-opus-5-5 (high), builder role |

The commit that adds this `evidence/` folder changes only `evidence/SF-M05-002/**`. Exact-head CI run
IDs for the final head are recorded in the freeze report, not here.

## Executed checks (`logs/exit-codes.txt`)

| Step | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | rc=0 (local install wrote an empty importer; `pnpm-lock.yaml` restored, never committed) | `logs/install-frozen.log` |
| `pnpm format:check` | rc=0 | `logs/format-check.log` |
| `pnpm lint` | rc=0 | `logs/lint.log` |
| `pnpm typecheck` (recursive, includes CMP-016) | rc=0 | `logs/typecheck.log` |
| `pnpm test:coverage` (root) | rc=0, 170 files / 995 tests; thresholds met | `logs/test-coverage.log`, `coverage-summary.json` |
| `pnpm contracts:validate` | rc=0 | `logs/contracts-validate.log` |
| `pnpm test:cdc` | rc=0 | `logs/test-cdc.log` |
| `pnpm deps:graph` | rc=0 (no violations) | `logs/deps-graph.log` |
| `pnpm build` | rc=0 | `logs/build.log` |
| gate self-tests (`pytest scripts/gates/tests`) | rc=0, 25 passed (first attempt rc=1: pytest not installed locally) | `logs/gate-selftests.log` |
| `scripts/gates/run_all.py` | 10/10 gates passed | `logs/gates-run-all.log` |
| `migration_lint.py` | PASS | `logs/migration-lint.log` |
| `contracts_lock_gate.py` | PASS (19/19 hashes match) | `logs/contracts-lock.log` |
| `check_scope.py` vs base | PASS | `logs/check-scope.log` |
| `pnpm db:test` (all migrations up/down incl. CMP-016) | rc=0, 17/17 | `logs/db-test.log` |
| CMP-016 unit + contract | rc=0, 8 files / 129 tests | `logs/cmp016-unit.log`, `junit/unit.xml` |
| CMP-016 Postgres integration (real LOGIN roles) | rc=0, 2 files / 21 tests | `logs/cmp016-integration.log`, `junit/integration.xml` |

CMP-016 `src/**` coverage (root run): lines 98.0%, branches 90.4%, functions 98.5%, statements 95.2%.

Local semgrep 1.179.0 (CI image version) with the CI rule packs on CMP-016 paths: 0 findings. The same
scan on the previous head reproduced the 3 CI findings (regex_dos, 2 × insecure-object-assign).

## Required negative tests

| Requirement | Test(s) |
|---|---|
| Temporal cannot directly update CMP-015 state | `unit/temporal.test.ts` "exposes no operation that writes CMP-015 case state"; `unit/constitution.test.ts` "Temporal cannot update CMP-015 state"; `unit/temporal.test.ts` "activity effects map only to sibling ports" |
| Cannot silently mutate a published version | `unit/versioning-migration.test.ts`; `unit/service.test.ts` "published version cannot be silently mutated"; `integration/db-isolation.int.test.ts` "published version model/hash cannot be mutated even by direct SQL" |
| Imported BPMN cannot execute as alternate runtime | `unit/temporal.test.ts` "imported BPMN cannot execute as an alternate runtime"; `unit/service.test.ts` "imported BPMN drafts cannot start an execution"; `unit/bpmn.test.ts` engine-construct rejections |
| Named officer assignment rejected | `unit/validate.test.ts` (FROZEN invalid example + 5 field variants); `unit/bpmn.test.ts` humanPerformer/potentialOwner/assignee/candidateUsers; `unit/service.test.ts`; `contract/contracts.test.ts` human-task |
| Cross-component authoritative SQL rejected | `unit/constitution.test.ts` static scan; `integration/db-isolation.int.test.ts` "cross-component authoritative SQL is denied", "cannot SET ROLE", "another component login cannot read or write sf_workflow" |
| Advance after failed CMP-015 commit rejected | `unit/interpreter.test.ts`; `unit/temporal.test.ts`; `unit/service.test.ts` "advance after a failed CMP-015 commit is rejected before DB or Temporal", "failed instance/request commit never starts/signals Temporal" |
| No silent version retarget | `integration/db-isolation.int.test.ts` "pinned version cannot be silently retargeted without an approved plan"; `unit/interpreter.test.ts` pin mismatch |

## Tenant isolation

`integration/db-isolation.int.test.ts` on real PostgreSQL 16 through the `sf_t016_rt` LOGIN (member of
`sf_app` + `sf_cmp016_rw` only): FORCE RLS on all 8 tenant tables, **CROSS_TENANT_LEAKAGE = 0** across every
table for both tenant directions, fail-closed without tenant context, IDOR read/update/bind denied,
WITH CHECK refuses foreign-tenant writes, and the service layer for tenant B cannot reach tenant A data.

## Privilege boundary (ADR-0006 condition 10)

- Runtime login is not superuser, has no BYPASSRLS, and is a member only of `sf_app` and `sf_cmp016_rw`.
- `sf_cmp016_rw` is NOLOGIN. The runtime login owns no `sf_workflow` objects; `sf_migrator` owns the schema.
- Own DML succeeds.
- No SELECT/INSERT/UPDATE/DELETE on any other component's authoritative tables. The frozen SF-CON-OUTBOX template grants `sf_app` INSERT on outbox/inbox tables; that is unchanged here.
- `SET ROLE sf_cmp008_rw` is denied, and a peer component login is denied on `sf_workflow` tables.
- No DDL in `sf_workflow`.

## Out of scope / deferred

- Temporal SDK worker binding (`@temporalio/*`) needs lockfile admission (STITCH-A). The workflow body runs behind `WorkflowHost` and was exercised with a deterministic in-memory host.
- Host mount is deferred to SF-M05-009.
- Coordinating migration with CMP-015's pin repoint (SF-CON-VERSION-PINNING) is left to STITCH/INT.
