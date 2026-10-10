# SF-M06-002 evidence — CMP-025 Notification Service

Status: BUILDER CANDIDATE. Recommended gate status only; not VERIFIED, not CERTIFIED, not G3/G6.
Evidence is builder-produced; independent review (INDEPENDENT_CG_02_WAVE_A_BUILDER_REVIEW) is required.

| Field | Value |
|---|---|
| Dispatch base (exact) | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` |
| Code commit under test | `59fb6d4d06ceb4d63d8bc55e3e92dabafea7142a` |
| Branch | `agent/M06-notification-SF-M06-002` |
| Authorization | HUMAN_CG_02_WAVE_A_DISPATCH_AUTHORIZATION (lane SF-M06-002 only) |
| Model route (envelope) | claude-sonnet-5-5, effort high (actual effort not independently observable) |
| Run environment | Node v22.14.0, pnpm 10.28.0, PostgreSQL 16.15 (local, fresh database), run dated 2026-10-10 UTC |
| Run identifiers | local cloud-agent run; no CI run id at code commit (CI runs on the PR head) |

The final PR head differs from the code commit only by `evidence/SF-M06-002/**` and
`orchestrator/handovers/SF-M06-002.yaml` (see `logs/scope.log`).

## Pre-dispatch guard

`origin/main == 8b1c26ce…` PASS; envelope READY / implementation_authorized / dispatched=false /
wave_eligible_now PASS; `cg01_path_uniqueness_gate.py` PASS; `contracts_lock_gate.py` 29/29 FROZEN MATCH
PASS; PRs #107, #108, #109 still OPEN (unmerged) PASS.

## Executed checks (logs in `logs/`, junit in `junit/`)

| Check | Result | Log |
|---|---|---|
| `tsc --noEmit` | PASS | typecheck.log |
| `eslint --max-warnings=0` (incl. security plugin, parameterised-SQL rule) | PASS | eslint.log |
| `prettier --check` | PASS | prettier.log |
| Unit + contract tests | 119/119 PASS | unit.log, junit/unit.xml |
| PostgreSQL integration (RLS, privileges, constraints, concurrency, rollback) | 13/13 PASS | integration.log, junit/integration.xml |
| Coverage of `src/` | stmts 93.19 / br 86.54 / fn 98.63 / lines 96.23 | coverage.log |
| `scripts/gates/run_all.py` (10 gates incl. migration-lint, contracts-lock, hardcoding, openapi-asyncapi) | 10/10 PASS | gates.log |
| dependency-cruiser | PASS | depcruise.log |
| Path scope / lockfile untouched | PASS | scope.log |

## What the tests prove (mapped to acceptance)

- **Dispatch idempotent and tenant-scoped**: replay returns the stored response; same key with a different
  body is 409; a dispatch key is unique per tenant; other tenants get 404 on read, are refused another
  tenant's binding, and cannot drain the queue; Postgres FORCE RLS hides rows, blocks cross-tenant writes
  and an unset tenant context returns nothing; peer-component login is denied.
- **INT-013 marker on SIMULATED paths**: every SIMULATED dispatch, attempt row, outbox event and sink record
  carries a frozen-schema SimulationMarker; sink messages are prefixed `[TEST/SIMULATED run=…]`;
  REAL/SANDBOX carry none. `isSimulationMarker` agrees with SF-CON-SIMULATION-MARKER on a case table.
- **Fail-closed critical deps**: unbound/unknown/down binding source, wrong type, wrong environment, wrong
  tenant, missing secret ref or simulator version, unmapped channel (PUSH/IN_APP), PDP outage, missing
  adapter. Critical non-REAL in PRODUCTION is refused at dispatch, again at delivery, and by database CHECK
  constraints. An exhaustive environment x mode x critical x secret x simulator matrix proves the policy is
  never more lenient than SF-CON-CONNECTOR-BINDING.
- **No network in a DB transaction**: provider I/O, binding lookup and recipient resolution run while no
  transaction is open (counted by a transaction-probing pool against PostgreSQL; in-memory guard asserts
  `NETWORK_IN_TX`); delivery is claim-tx -> send -> finalize-tx; leases make crashes recoverable;
  a worker that lost its lease writes nothing; concurrent drains never double-claim (SKIP LOCKED).
- **No secrets/PII in logs, events, rows or errors**: canary phone, e-mail and secret-ref values never
  appear in logs, outbox envelopes, dispatch/attempt rows, idempotency bodies or API errors, including
  when the directory and hub fail with messages that embed them. Log keys are allow-listed. Template
  parameters pass a deterministic PII guard; PII-shaped parameter names are refused at publish.
- **Contract conformance**: returned dispatches validate against the FROZEN notification-dispatch schema;
  the file hash equals its contracts-lock row; outbox/audit/error envelopes validate against shared
  schemas; OpenAPI/AsyncAPI/topic/isolation declarations match code and migrations.
- **Migrations**: SF-CON-OUTBOX template copy; up/down/up verified; NOLOGIN privilege role, no
  BYPASSRLS/SUPERUSER, no PUBLIC grants, no DELETE grant on dispatch, insert-only templates/attempts.

## Mutation spot checks (builder self-check, not independent)

| Mutation | Unit result |
|---|---|
| Remove PRODUCTION critical non-REAL refusal | 6 tests fail (killed) |
| Do not persist SimulationMarker | 32 tests fail (killed) |
| Disable template-parameter PII guard | 1 test fails (killed) |
| Remove `lease_owner` comparison in finalize | 0 fail (SURVIVED) |

The surviving mutant is a defence-in-depth check: for every reachable state a lost lease is already
detected by status/attempt-count mismatch, and the database trigger independently guards transitions.
It is reported, not hidden; the independent reviewer may want an exhaustion-race test.

## Limits (no overclaim)

- REAL and SANDBOX delivery were exercised only through an in-test `HubTransport` double. No real or
  sandbox provider or CMP-037 connector was validated. Production readiness needs real critical-connector
  validation by the independent verifier.
- No performance, resilience, backup/restore or host (apps/api) evidence; host mount is SF-M06-005.
- Runtime role/RLS proof used a local PostgreSQL 16.15 with a superuser admin role for setup only.
- `pnpm-lock.yaml` was not modified (`EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`: the new importer row is
  needed on main; `pnpm install` rewrites it locally and the rewrite was discarded).

## Security correction (HUMAN_CG_02_WAVE_A_SECURITY_CORRECTION_AUTHORIZATION)

Prior head `c6410dbb71d9aaeb879c0569c16e335d8df3617d` failed the SAST (semgrep) job with 3 blocking findings
(regex_dos in `src/domain/simulation.ts` and `src/service/input.ts`; node_secret in `test/doubles/fixtures.ts`).
The sections above describe that prior head; the corrected run is in `correction/` (supersedes counts above).

- Regex matching of client-supplied text was replaced by linear, length-bounded validators in
  `src/domain/model.ts` (same charsets and bounds; `isSecretRef` adds a 512 character cap, stricter and fail-closed).
  `test/unit/model-validators.test.ts` records a truth table from the previous patterns and proves multi-megabyte
  hostile input is refused in well under a second.
- The secret-shaped fixture is now `CANARY_CONNECTOR_REF` = a synthetic, non-credential reference that still passes
  secret-ref validation and is still asserted absent from logs, events, rows and errors.
- No suppression comments, workflow, semgrep config, lockfile or contract change.

| Check (corrected tree) | Result |
|---|---|
| unit + contract | 163/163 PASS |
| PostgreSQL integration | 13/13 PASS |
| eslint max-warnings 0 / tsc / prettier | PASS / PASS / PASS |
| `run_all.py` | 10/10 PASS |
| coverage stmts / branches | 93.67 / 87.84 |
| semgrep (CI config, local run 1.180.0) | 0 findings; same config reports 3 on the prior head |
