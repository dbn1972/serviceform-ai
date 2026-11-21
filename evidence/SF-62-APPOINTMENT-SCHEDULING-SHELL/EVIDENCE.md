# SF-62 SAMPLE_LAB appointment / scheduling shell — evidence

**Stamp:** CERTIFIED=false · G6=false · self_certified=false  
**Requirement:** Constitution #37 scheduling/appointment calendars as reusable platform metadata; thin UI beside CMP-018 inspection  
**Gap item:** platform-capability-gap-analysis.md rank 4 (P2)  
**Branch:** `cursor/appointment-scheduling-shell-189f`

## Executed checks

| Check | Result |
|---|---|
| `pnpm --filter @serviceform/cmp-056-scheduler test:unit` | PASS 22/22 |
| `vitest` m10 catalogue + api parse + officer desk helpers | PASS 8/8 |
| `pnpm --filter @serviceform/api typecheck` | PASS |
| `pnpm --filter @serviceform/web-officer typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab typecheck` | PASS |
| `pnpm --filter @serviceform/cmp-056-scheduler typecheck` | PASS |

Logs: `vitest-cmp056.log`, `vitest-portals.log`, `junit/unit.xml`, `typecheck-*.log`.

## Architecture notes

- CMP-056 mounted in SAMPLE_LAB when `DATABASE_URL_CMP056` is set (m09 + lab catalogue/ensure routes).
- Opaque appointment_type_ref / slot_ref / resource_calendar_ref only — no invented statutory calendars.
- Atomic capacity; notify failure does not invalidate booking.
- OPA `Appointment` / `AppointmentSlot` / `AppointmentType` + `APPOINTMENT_*` actions; inspection + case officers + SYSTEM seed role.
- Officer `/scheduling` desk beside `/inspection` (CMP-018).
- Lab seed publishes catalogue types/slots on host start (fail-soft) and via `/v1/lab/appointments/ensure`.

## Recommended gate

Builder evidence only. **Do not** mark CERTIFIED or G6. Human/CI may merge when CI green.
