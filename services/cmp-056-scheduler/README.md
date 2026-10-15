# CMP-056 Appointment / Scheduler

SF-M09-001. Reusable appointment booking bound to the FROZEN `SF-CON-APPOINTMENT` contract
(INT-014). Owner-supplied opaque `appointment_type_ref` / `slot_ref` only — **no invented
hearing/inspection statutory calendars**.

- **Atomic capacity.** `capacity_atomic: true`. A single-capacity slot cannot be overbooked;
  booking locks the slot and refuses when `booked_count >= capacity` (service + DB trigger).
- **Notify ≠ cancel.** `notification_failure_invalidates_booking: false`. CMP-025 notify runs
  *after* the booking transaction commits; a notify failure only sets `notification_status=FAILED`.
- **OPA PEP** on every route (`APPOINTMENT_*` actions), fail-closed on PDP outage, never inside a
  DB transaction. Tenant from server-derived request context only.
- State, event log, domain event and audit commit together through SF-CON-OUTBOX; commands are
  idempotent. Schema `sf_scheduler`, privilege role `sf_cmp056_rw` (NOLOGIN, FORCE RLS).

Routes: see `contracts/openapi.json`. Host mount deferred to SF-M09-HOST; no UI. Not CERTIFIED /
not G4 / not G6 / not self-certified.
