# SF-M05-002 — CMP-016 Workflow Engine: builder evidence (Temporal SDK binding)

Builder evidence only. **Not CERTIFIED. Not G4. Not G6. Builder does not self-certify.**
Independent INT / SEC / EVD verification is still required.

| Field | Value |
|---|---|
| Task / component | SF-M05-002 / CMP-016 (INT-005, INT-011) |
| Base SHA | `6e9f0481eb3007dedee5580838cab59ceea66f03` |
| Previous frozen head | `e60ca7cb4bb6b4e481b81d47ce39d29f71995644` (evidence archived in `history/bb667e4/`) |
| Code SHA under test | `4ea552d16345f066460524fd01d8121c4ac4f7c4` (`logs/commit-sha.txt`) |
| PR | [#89](https://github.com/dbn1972/serviceform-ai/pull/89) (draft, do not merge) |
| Temporal SDK | `@temporalio/{activity,client,common,worker,workflow}` 1.24.0, `@temporalio/testing` 1.24.0 (dev); exact pins, published 2026-09-15 (clears the 7-day `minimumReleaseAge`) |
| Environment | Local: Node 22.14.0, pnpm 10.28.0, PostgreSQL 16, Temporal time-skipping test server (via `@temporalio/testing`) |
| Model | claude-opus-5-5 (high), builder role |

## EXPECTED_STITCH_LOCKFILE_ADMISSION = yes

`pnpm install --frozen-lockfile` fails, and the only failure reason is the new importer specifiers. From `logs/install-frozen.log`:
"6 dependencies were added: @temporalio/testing@1.24.0, @temporalio/activity@1.24.0, @temporalio/client@1.24.0, @temporalio/common@1.24.0, @temporalio/worker@1.24.0, @temporalio/workflow@1.24.0".
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, frozen-lockfile, audit and trustPolicy are unchanged. The lockfile is STITCH-A owned.

How the SDK was installed for local testing:
- A non-frozen workspace install fails on the existing repo policy. Already-locked `pg-cloudflare@1.4.1` and `@next/swc-*` versions fail the `minimumReleaseAge` re-check. STITCH-A will hit the same condition.
- So the six packages were installed with npm into an isolated prefix outside the repo (`/tmp/temporal-deps`), then symlinked into the gitignored `services/cmp-016-workflow-engine/node_modules/@temporalio` (`logs/relink-local-temporal.log`).
- Nothing outside the allowed write paths was committed.

## Executed checks (`logs/exit-codes.txt`)

| Step | Result |
|---|---|
| frozen install | rc=1, EXPECTED_STITCH_LOCKFILE_ADMISSION (sole reason: 6 `@temporalio/*` specifiers) |
| format:check / lint / typecheck (recursive) | rc=0 / rc=0 / rc=0 |
| root `test:coverage` | rc=0, 171 files / 1002 tests, thresholds met |
| contracts:validate / test:cdc / deps:graph / build | rc=0 each |
| gate self-tests / `run_all.py` | rc=0 (25 passed) / 10/10 |
| migration lint / contracts lock / write scope | PASS / 19/19 MATCH / PASS |
| `pnpm db:test` | rc=0, 17/17 |
| CMP-016 unit + contract | rc=0, 9 files / 136 tests (`junit/unit.xml`) |
| CMP-016 Postgres integration (real LOGIN roles) | rc=0, 21/21 (`junit/integration.xml`) |
| CMP-016 Temporal SDK suite (real Worker + time-skipping server + Postgres) | rc=0, 12/12 (`junit/temporal.xml`) |

CMP-016 `src/**` coverage in the root unit run: lines 93.4%, branches 88.1%. The SDK workflow module is exercised by the Temporal suite, not by the root unit run.
Local semgrep 1.179.0 (CI rule packs) on the CMP-016 tree: 0 findings.

## Temporal binding

| Concern | Implementation |
|---|---|
| Client | `src/temporal/sdk/client.ts` `TemporalSdkClient`: canonical type only, configured task queue, `sf-wf:<tenant>:<application>` ids, `REJECT_DUPLICATE` + `FAIL`, only `sf.committedTransition` / `sf.migrate`, fail-closed error mapping |
| Worker | `src/temporal/sdk/worker.ts` `createCanonicalWorker` / `bundleCanonicalWorkflows` (workflow type `serviceformCanonicalWorkflow`) |
| Workflow binding | `src/temporal/sdk/workflows.ts`: `canonicalWorkflow(host, input)` wired to `defineSignal` handlers, `condition()` waits, `sleep()` durable timers in `CancellationScope`, `proxyActivities`, `sf.state` query. No clock, random, Node built-ins or network. |
| Activities | `src/temporal/sdk/activities.ts`: createHumanTask, closeHumanTask, evaluateRule, invokeActivity, invokePort, timerDuration, recordProgress. Published ports plus CMP-016's own projection; idempotency keys stable across retries. |
| Sandbox safety | Pure SHA-256 (verified equal to `node:crypto`) and JSON state clone, so graph-hash integrity runs inside the workflow |

## Required Temporal tests (`test/temporal/sdk-worker.int.test.ts`, SDK-backed)

| Requirement | Evidence |
|---|---|
| Start uses the canonical type | `describe()` type `serviceformCanonicalWorkflow`, task queue matches |
| Workflow id is tenant + application | `sf-wf:<T1>:<app>`; duplicate start → `WORKFLOW_ALREADY_STARTED` (client) and SF-APP-002 (DB) |
| Committed/migrate signals reach the running workflow | Signaled events; tokens advance; `sf.migrate` re-pins to v2, then a v2-pinned commit advances |
| No Temporal call inside a domain transaction | `TEMPORAL_CALL_INSIDE_DOMAIN_TXN`; 0 signaled events |
| Durable wait | After `env.sleep('4 days')` the workflow is still RUNNING at SCRUTINY, then completes on commit |
| Temporal timers | TimerStarted with 259200 s; TimerFired after the skip; TimerCanceled on withdrawal termination; no setTimeout in the workflow (static test) |
| Activity retry-safe / idempotent | Injected CMP-017 failure → 2 attempts with an identical idempotency key; 1 scheduled activity |
| Duplicate committed signal | 2 signaled events, 1 closeHumanTask, 1 port close; `seen_signals` holds one id |
| Failed CMP-015 commit cannot advance | Service rejects with `ADVANCE_BEFORE_DOMAIN_COMMIT` (0 signals); a raw uncommitted signal leaves the workflow state unchanged |
| Temporal cannot update CMP-015 DB | The activity surface is ports plus the projection; the worker DB login has 0 UPDATE/DELETE grants outside `sf_workflow` |
| BPMN import not a second engine | Imported draft → `VERSION_NOT_PUBLISHED` and no execution; `bpmnProcess` type refused; raw BPMN XML → `MODEL_INVALID`; `runtime: BPMN_ENGINE` → `BPMN_RUNTIME_FORBIDDEN` |
| Named officer rejected | Service `NAMED_OFFICER_FORBIDDEN`; the worker fails the execution with the same code |
| Cross-tenant signal | Signal with another tenant → rejected in the workflow (state unchanged); adapter SF-TEN-002 |

## Preserved

- CROSS_TENANT_LEAKAGE = 0 (Postgres suite).
- ADR-0006 privilege boundary and FORCE RLS: unchanged migrations, all suites green.
- contracts lock 19/19 MATCH; CCR false.
- No changes to `pnpm-lock.yaml`, `contracts/**` or `orchestrator/contracts-lock.yaml`.
