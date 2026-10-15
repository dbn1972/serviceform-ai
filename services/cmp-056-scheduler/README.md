# CMP-056 Appointment / Scheduler

Appointment slots and bookings for ServiceForm (SF-M09-001, INT-014 + INT-011). The service
produces the FROZEN `SF-CON-APPOINTMENT` view and consumes the shared frozen envelopes
(request context, authz decision, error response, event envelope, idempotency, audit, outbox).

## Data

- Schema `sf_scheduler`, privilege role `sf_cmp056_rw` (NOLOGIN, NOBYPASSRLS), tables owned by
  `sf_migrator`, FORCE RLS on every tenant table (`db/migrations/*_cmp-056-*.sql`).
- Tenant context is server-derived and set per transaction with `set_config('app.*', …, true)`;
  tenant/role headers are refused (`SF-TEN-002`).

## Capacity

Seats are taken with one conditional `UPDATE … booked_count < capacity`. The database backs
this with `CHECK (booked_count <= capacity)` and a deferred constraint trigger that asserts at
commit that `booked_count` equals the slot's non-cancelled appointments. Reschedule locks both
slots in `slot_id` order.

## Notifications

CMP-025 delivery outcomes are append-only rows (`booking_invalidated` is constrained to
`false`). A FAILED outcome never changes the appointment.

## Calendars

No holiday, business-day or cancellation-window logic exists here. Slots are explicit tenant
metadata; any time-based policy belongs to OPA or tenant configuration.

## HTTP

| Method | Path                                                | Action                                   |
| ------ | --------------------------------------------------- | ---------------------------------------- |
| POST   | `/v1/appointment-slots`                             | APPOINTMENT_SLOT_PUBLISH                 |
| GET    | `/v1/appointments/slots`                            | APPOINTMENT_SLOT_LIST                    |
| POST   | `/v1/appointments`                                  | APPOINTMENT_BOOK                         |
| GET    | `/v1/appointments/{appointment_id}`                 | APPOINTMENT_READ                         |
| POST   | `/v1/appointments/{appointment_id}/reschedule`      | APPOINTMENT_RESCHEDULE                   |
| POST   | `/v1/appointments/{appointment_id}/cancel`          | APPOINTMENT_CANCEL                       |
| POST   | `/v1/appointments/{appointment_id}/attendance`      | APPOINTMENT_ATTENDANCE_RECORD            |
| POST   | `/v1/appointments/{appointment_id}/notification-outcomes` | APPOINTMENT_NOTIFICATION_OUTCOME_RECORD |

Every POST requires `Idempotency-Key`. The OPA PEP is called outside any transaction and fails
closed (503). Host mounting is deferred to SF-M09-HOST.

## Tests

```bash
pnpm --filter @serviceform/cmp-056-scheduler typecheck
pnpm --filter @serviceform/cmp-056-scheduler test:unit
DATABASE_URL=postgres://… pnpm --filter @serviceform/cmp-056-scheduler test:integration
```

Integration tests need a superuser `DATABASE_URL`; they apply migrations and create throwaway
login roles.
