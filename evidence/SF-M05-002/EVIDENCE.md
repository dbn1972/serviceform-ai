# SF-M05-002 — CMP-016 Workflow Engine: builder evidence (R-CMP016-UNHANDLED-REJECTION test-harness fix)

Builder evidence only. **Not CERTIFIED. Not G4. Not G6. STITCH-A OFF. Builder does not self-certify.**
Independent INT / SEC / EVD verification is still required.

| Field | Value |
|---|---|
| Task / component | SF-M05-002 / CMP-016 (INT-005, INT-011) |
| Residual | R-CMP016-UNHANDLED-REJECTION (Track A2; raised in the R-CMP016-DOWN2 return, `history/b01ed4c/`) |
| Base SHA | `6e9f0481eb3007dedee5580838cab59ceea66f03` (unchanged; no rebase) |
| Previous head | `83811c74ca2be3856de4c99f343b0ad03da4d65e` (evidence for code `b01ed4c` archived in `history/b01ed4c/`) |
| Code SHA under test | `b0924d2501f00bdf033f18f2951eea8884bca2ff` (`logs/commit-sha.txt`) |
| PR | [#89](https://github.com/dbn1972/serviceform-ai/pull/89) (draft, do not merge) |
| Environment | Local: Node 22.14.0, pnpm 10.28.0, PostgreSQL 16 (apt; one cluster per tree), Temporal time-skipping test server via `@temporalio/testing` 1.24.0 |
| Model | claude-opus-5-5 (high), builder role |

## Root cause (test timing, not a domain defect)

`test/integration/db-isolation.int.test.ts`, test "service layer: tenant B cannot export, start, signal or
request on tenant A data", built an array of three service promises (`exportBpmn`, `startInstance`,
`submitRequest`) and then awaited `errorOf(p)` one at a time. All three calls start running when the array is
built. If a later call (observed: `submitRequest`, `SF-SYS-002`) rejected while an earlier one was still being
awaited, Node saw a rejected promise with no handler and vitest reported `Unhandled Rejection` / `Errors 1`
(rc=1) even though all 21 tests passed. The service correctly returned `SF-SYS-002` for every call; only the
handler attachment was late.

## Change (test harness only; 1 file)

| File | Change |
|---|---|
| `test/integration/db-isolation.int.test.ts` | The three calls are now thunks (`() => svc.…(…)`). The loop invokes each thunk inside `errorOf(call())`, so each promise is created at the moment its handler attaches. Same three calls, same arguments, same assertion (`['SF-SYS-002','SF-SYS-002','SF-SYS-002']`). Test count unchanged (18 in the file; 21 in the suite). |

No `process.on('unhandledRejection')`, no vitest `dangerouslyIgnoreUnhandledErrors`, no catch-all, no warning
suppression. `helpers.ts`, `src/**`, vitest configs and `package.json` are untouched. A search of
`services/cmp-016-workflow-engine/test/**` found no other eagerly-built promise group (the remaining
`for (const x of [...])` loops iterate SQL strings or action names).

## Mechanism proof (deterministic probe, not committed)

The intermittent failure did not reproduce in 10 fresh-DB runs of the unchanged `83811c7` file on this host
(`logs/stability/baseline-83811c7-m89-10x-summary.log`; the prior host saw 3/8). To show the mechanism directly,
two temporary copies of the file were run with a 200 ms delay before each `errorOf` (widening the race window),
then deleted:

| Variant | Runs | rc | Tests | Unhandled Rejection blocks |
|---|---|---|---|---|
| Old pattern (`83811c7` file + delay) | 3 | 1, 1, 1 | 18/18 each | 3 per run |
| New pattern (fixed file + delay) | 3 | 0, 0, 0 | 18/18 each | 0 |

Logs: `logs/probe/probe-summary.log`, `probe-old-run1.log` (shows `Cmp016Error: Resource or route not found`
reported as unhandled), `probe-new-run1.log`.

## Stability proof (code `b0924d2`)

Each run: drop and recreate `serviceform_test`, drop all non-system roles, then `pnpm run test:integration`
(fresh CI-shaped database). Script: `logs/stability/run-int-loop.sh.txt`. Per-run logs: `logs/stability/runs/`.
The recorded helper scripts read the local throwaway database URL from `LOCAL_DB_URL_<port>`; no connection
string or credential is recorded in this evidence.

| Tree | Consecutive runs | Result each run | rc=0 | Unhandled count |
|---|---|---|---|---|
| #89 tree | 20 | 21/21 | 20/20 | **0** (`logs/stability/m89-tree-20x-summary.log`) |
| Combined Wave A migration chain | 20 | 21/21 | 20/20 | **0** (`logs/stability/combined-wave-a-20x-summary.log`) |

Combined chain = the #89 tree plus the six CMP-015/017/029 migration files copied read-only from STITCH-A
[#91](https://github.com/dbn1972/serviceform-ai/pull/91) head `2135940` (53 migrations). The `db/migrations`
listing of `2135940` differs from this branch by exactly those six files; the CMP-016 pair is blob-identical
(`d7cb511`, `ce95893`). The overlay was deleted afterwards (`logs/worktree-after.log` empty) and never
committed. Post-conditions after run 20 (`logs/combined-wave-a-postconditions.log`): CMP-015/016/017/029 all
applied, `sf_application_case`/`sf_workflow`/`sf_tasks`/`sf_sla` present, 0 leftover `sf_cmp016_rev_*` DBs,
0 leftover `cmp016-rev-*` temp dirs.

## Executed checks (`logs/exit-codes.txt`, code SHA `b0924d2`)

| Step | Result |
|---|---|
| frozen install | rc=1, EXPECTED_STITCH_LOCKFILE_ADMISSION (sole reason: 6 `@temporalio/*@1.24.0` specifiers; `logs/install-frozen.log`) |
| format:check / lint / typecheck (recursive) | rc=0 / rc=0 / rc=0 |
| root `test:coverage` | rc=0, 171 files / 1002 tests; CMP-016 src lines 93.44%, branches 88.09% (identical to `b01ed4c`) |
| contracts:validate / test:cdc / deps:graph / build | rc=0 each |
| gate self-tests / `run_all.py` | 25 passed / 10/10 PASS |
| migration lint / contracts lock / write scope | PASS (47 files) / 19/19 FROZEN MATCH / PASS (envelope SF-M05-002 vs `origin/main`) |
| `pnpm db:test` | rc=0, 17/17 (single-database cluster) |
| CMP-016 unit + contract | rc=0, 9 files / 136 tests (`junit/unit.xml`) |
| CMP-016 Postgres integration, #89 tree (canonical) | rc=0, 21/21, 0 unhandled (`junit/integration.xml`) |
| CMP-016 Postgres integration, combined Wave A (run 20) | rc=0, 21/21, 0 unhandled (`junit/integration-combined-wave-a.xml`) |
| CMP-016 Temporal SDK suite | rc=0, 12/12 (`junit/temporal.xml`) |

## Preserved

- CROSS_TENANT_LEAKAGE = 0: the fixed test still asserts `SF-SYS-002` for all three tenant-B calls on tenant-A data; the FORCE-RLS / IDOR / WITH CHECK tests pass in every run.
- Diff vs `83811c7` outside `db-isolation.int.test.ts`, `evidence/SF-M05-002/**` and the handover = 0. `src/**`, `db/migrations/**`, `helpers.ts`, `package.json`, vitest configs, `contracts/**`, `orchestrator/contracts-lock.yaml`, `pnpm-lock.yaml`, `apps/**` untouched.
- contracts lock 19/19 MATCH; CCR_REQUIRED false. No Temporal semantic or dependency change.
- EXPECTED_STITCH_LOCKFILE_ADMISSION unchanged; lockfile is STITCH-A owned.
