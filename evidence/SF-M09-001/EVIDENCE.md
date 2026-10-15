# SF-M09-001 evidence — CMP-056 Appointment / Scheduler

Builder candidate evidence only. **Not CERTIFIED / not G4 / not G6 / not self-certified.** No gate is
issued here; independent INT / SEC / EVD review and a human or CI gate are still required.
Recommended gate status: none (builder candidate).

- Authorization: `HUMAN_CG03_THROUGH_EVD` Wave A READY (main tip `fd7492b` after SF-M09-CG-001).
- Execution base: `fd7492b398b2945713957a53b42c4717a7940c3f` (`origin/main` at build).
- Branch: `cursor/m09-001-scheduler-91f2`. Implementation head: `c2924dd891e2253c7c8feb301bf547866ba5efac`. DRAFT PR #164.
- Agent / model: Cursor Cloud Agent, route `opus` (per `MODEL-ROUTING-QUALITY.md`; self-assessment is not evidence).

## SF-CON-APPOINTMENT consumption
- Consumes FROZEN `contracts/m09/schemas/appointment.schema.json` only (read-only).
- `capacity_atomic: true` — service + DB CHECK/trigger refuse overbooking a single-capacity slot.
- `notification_failure_invalidates_booking: false` — CMP-025 notify runs after commit; failure sets
  `notification_status=FAILED` only; booking lifecycle stays `BOOKED`.
- `invented_statutory_policy_forbidden: true` — opaque owner refs only; statute-looking calendars refused.

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package) | exit 0 | `typecheck.log` |
| Unit + contract (vitest 5.0.3) | 22/22 pass (5 domain, 8 service/API, 9 contract) | `unit-contract.log`, `junit/unit.xml` |

Commands (from `services/cmp-056-scheduler`):
`tsc --noEmit -p tsconfig.json`; `vitest run --root . --config vitest.unit.config.ts`.

## Requirement → test traceability
- Atomic capacity: `domain.test.ts`, `service.test.ts` "refuses a second concurrent booker".
- Notify failure ≠ invalidate: `service.test.ts` "keeps the booking when notification fails".
- No invented statutory calendars: `domain.test.ts`, `service.test.ts`, `contracts.test.ts`.
- FROZEN schema: `contracts.test.ts` validates booked responses and frozen examples.
- Migration FORCE RLS / `sf_cmp056_rw` / constants: `contracts.test.ts` migration pin check.

## Scope
Allowed paths only: `services/cmp-056-scheduler/**`, `db/migrations/*_cmp-056-*.sql`,
`evidence/SF-M09-001/**`, `orchestrator/handovers/SF-M09-001.yaml`. No `pnpm-lock.yaml`, no
`apps/**`, no frozen contract edits.

## Residuals (explicit)
1. `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` — new workspace package needs an importer row in `pnpm-lock.yaml` (not modified here).
2. OPA policy data for `APPOINTMENT_*` actions lives in `policy/**` (read-only for this lane); until added the PDP denies (fail-closed).
3. Host mount deferred to SF-M09-HOST; no UI.
4. PostgreSQL integration (FORCE RLS login roles) deferred to INT/SEC lanes — unit/contract executed here.
