# SF-65 SAMPLE_LAB citizen appointment booking + workflow wait — evidence

**Stamp:** CERTIFIED=false · G6=false · self_certified=false  
**Requirement:** Constitution #37 scheduling deepen — citizen self-serve booking + CMP-056 ↔ workflow wait-on-appointment (no polling)  
**Gap item:** overnight-gap-closure P3 scheduling deepen; platform-capability-gap-analysis rank 31  
**Branch:** `cursor/scheduling-citizen-booking-bfab`  
**Tip:** `ea2dcd8359ad8cffd6e8ac4c76e324ef7f71f205`

## Executed checks

| Check | Result |
|---|---|
| `pnpm --filter @serviceform/cmp-056-scheduler test:unit` | PASS 23/23 |
| `vitest` m10 catalogue + api wait-signal + citizen/officer portal helpers | PASS 16/16 |
| `pnpm --filter @serviceform/api typecheck` | PASS |
| `pnpm --filter @serviceform/web-citizen typecheck` | PASS |
| `pnpm --filter @serviceform/web-officer typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab typecheck` | PASS |
| `pnpm --filter @serviceform/cmp-056-scheduler typecheck` | PASS |

Logs: `vitest-cmp056.log`, `vitest-portals.log`, `junit/unit.xml`, `typecheck-*.log`.

## Architecture notes

- Citizen `:3000` → `/appointments` UX4G shell: list slots, book, mine, reschedule/cancel.
- Participant refs server-derived (`participant:citizen:{id}` / `participant:application:{uuid}`); never client-supplied.
- Lab wait bindings metadata release `WAIT_VERIFICATION` via CMP-015 `ENTER_DECISION_PENDING` when a correlated appointment COMPLETED (payment-style post-commit signal; notify ≠ cancel).
- CMP-056 lifecycle notify now fires after book/reschedule/cancel/complete/no-show; `listByParticipantRef` powers lab `/v1/lab/appointments/mine`.
- Opaque appointment_type_ref / slot_ref only — no invented statutory calendars. No DigiLocker/SMS/Payment in this path.

## Recommended gate

Builder evidence only. **Do not** mark CERTIFIED or G6. Human/CI may merge when CI green.
