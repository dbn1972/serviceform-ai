# SF-M09-001 evidence (CMP-056 Appointment / Scheduler)

Builder evidence only. Not CERTIFIED. Not RELEASE CERTIFIED. Not G3. Not G4. Not G6. Do not merge.
Builder self-assessment is not verification; independent review/INT/SEC remain required.

| Field | Value |
|---|---|
| Task | SF-M09-001 (CG-03, M09 Wave A) |
| Component | CMP-056 (INT-014, INT-011) |
| Authorization | `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` (freeze SF-M09-CG-001 FROZEN_ON_MAIN via #158; Wave A READY via #159) |
| Branch | `cursor/m09-001-scheduler-1281` (see residual 1: duplicate lane on `-91f2`) |
| Base (exact, verified) | `fd7492b398b2945713957a53b42c4717a7940c3f` (merge of #159) |
| Implementation commits | schema `8f94391`, service `4880fb9`, lint fixes `c726708`, contracts + tests `dab3a77` |
| Schema / role | `sf_scheduler` / `sf_cmp056_rw` (NOLOGIN, NOBYPASSRLS) |
| Frozen contract produced | `SF-CON-APPOINTMENT` (`contracts/m09/schemas/appointment.schema.json`, lock hash asserted by test) |
| Model / effort | claude-opus-5-5 / high (route `opus`) |
| CCR | false (no frozen contract or contracts-lock change) |
| Lockfile | not committed (see residual 2) |

## Executed results at `dab3a77`

Local VM: Node 22.14.0, PostgreSQL 16.15 (private throwaway cluster, see residual 4).

| Suite | Result | Artifact |
|---|---|---|
| Unit + tenant-negative + contract (vitest) | 71/71 PASS (domain 24, booking 22, tenant-negative 12, contract 13) | `junit/unit.xml`, `logs/unit-contract.log` |
| PostgreSQL integration (runtime login `sf_app + sf_cmp056_rw`) | 11/11 PASS, 3 consecutive runs plus 1 after `pnpm db:test` | `junit/integration.xml`, `logs/integration-run*.log` |
| `tsc --noEmit` | PASS | `logs/typecheck.log` (empty = no diagnostics) |
| `eslint --max-warnings=0` (service) | PASS | — |
| `prettier --check` (service) | PASS | — |
| `scripts/gates/run_all.py` (10 gates; 42/42 contracts FROZEN) | 10/10 PASS | `logs/gates-run_all.log` |
| `scripts/gates/tests` (pytest) | 30/30 PASS | — |
| `migration_lint.py` (CMP-056 files) | PASS (2 files; 92 repo-wide in run_all) | `logs/migration-lint.log` |
| `check_scope.py --envelope orchestrator/tasks/SF-M09-001.yaml --base fd7492b` | PASS (38 files) | `logs/scope.log` |
| `pnpm db:test` (shared migration/isolation harness) | 17/17 PASS | `logs/db-test.log` |
| Migrations up → down 2 → up | PASS (integration test) | `junit/integration.xml` |
| semgrep 1.180.0 (p/default, p/typescript, p/nodejsscan, p/secrets, .semgrep/) on lane paths | 0 findings (331 rules, 29 files) | `logs/semgrep.log` |
| gitleaks (commits `fd7492b..HEAD` + lane dirs) | no leaks | `logs/gitleaks.log` |
| checkov 3.3.29 `--framework secrets` on service | PASS | `logs/checkov.log` |

## What the tests prove (requirement → test)

| Requirement | Evidence |
|---|---|
| FORCE RLS, NOLOGIN/NOBYPASSRLS role, tables owned by `sf_migrator` | integration: "roles are NOLOGIN/NOBYPASSRLS and every tenant table is FORCE RLS"; contract: isolation declaration + grants |
| Server-derived tenant; tenant/role headers refused | tenant-negative: header refusal, missing/tenant-less context refused before PDP or tx |
| Tenant isolation (INT-011) | tenant-negative (12 tests: read/reschedule/cancel/outcome cross-tenant 404, same `slot_ref` across tenants, idempotency replay across tenants, citizen-to-citizen); integration: tenant B sees none of A and cannot write for A; peer login `sf_cmp048_rw` gets 42501 |
| Atomic capacity | integration: 16 concurrent bookings into capacity 1 give exactly 1 (15 × 409 `SLOT_CAPACITY_EXHAUSTED`); capacity 3 under 12 give exactly 3; concurrent reschedules into last seat move exactly 1; raw seat change without appointment aborts at commit (deferred occupancy trigger) |
| Mutation check on capacity guard | with `booked_count < capacity` removed from `reserveSeat`, all 3 concurrency tests failed and the DB CHECK still prevented overbooking (reverted; not committed) |
| Notification failure never invalidates booking | unit + integration: FAILED CMP-025 outcome stored append-only; appointment stays BOOKED; `booking_invalidated` constrained false; duplicate `outcome_ref` idempotent, contradicting one 409 |
| Lifecycle (INT-014) | domain transition table; DB guard refuses terminal-state changes, provenance edits, version skips; history rows required per version |
| Frozen contract consumption | contract: lock hash matches; every lifecycle response validates as `SF-CON-APPOINTMENT`; frozen valid/invalid examples; envelopes, audit, error catalogue and PDP input validate against frozen SF-CON schemas |
| Outbox + idempotency in same tx | integration: outbox rows written in the booking commit; unit: failed booking leaves no seat/appointment/outbox/idempotency residue; Idempotency-Key replay and conflict |
| OPA fail-closed, no network in tx | unit: deny refuses before any write; PDP outage → 503; PDP never called inside a transaction; jurisdiction scope passed |
| No invented statutory calendar | contract: scan of `src` for holiday/weekday/business-day logic; slots are explicit tenant metadata |

## Residuals (for coordinator / STITCH / independent verifiers)

1. **Duplicate dispatch.** Draft [PR #164](https://github.com/dbn1972/serviceform-ai/pull/164) on
   `cursor/m09-001-scheduler-91f2` (another agent, still OPEN at observation) implements the
   same task. This lane did not touch that branch and pushed `cursor/m09-001-scheduler-1281`
   instead. The coordinator must pick one; the two must not both be stitched.
2. **Lockfile.** `@serviceform/cmp-056-scheduler` is not in `pnpm-lock.yaml` (read-only here);
   admission is a STITCH residual.
3. **Host mount** deferred to SF-M09-HOST (handler exported, not mounted in `apps/**`).
4. **Private cluster.** Integration ran on a throwaway PostgreSQL 16.15 cluster, not CI.
5. **`migrateDown(2)`** in the rollback test assumes the CMP-056 migrations are the latest
   applied; migration timestamp ordering against sibling M09 lanes must be checked at STITCH.
6. **Out of scope / not built:** slot-template generation, slot close API, cancellation-window
   policy (left to OPA/tenant configuration — no statute invented).
7. Not CERTIFIED, not G3, not G4, not G6. Independent INT/SEC/EVD verification still required.
