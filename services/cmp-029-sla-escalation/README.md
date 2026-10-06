# CMP-029 SLA & Escalation Engine

SLA clocks for a service application: explicit start and completion anchors, a pinned business
calendar version and SLA policy version, a server-computed deadline, explicit pause and resume,
breach detection, escalation levels and an insert-only, replayable clock history
(Eng v1.4 CMP-029, Constitution #16, FROZEN `SF-CON-SLA-CLOCK`).

Status: SF-M05-004 builder output. Not CERTIFIED, not G4, not G6.

## What it owns (schema `sf_sla`, role `sf_cmp029_rw`, ADR-0006)

| Table | Behaviour |
|---|---|
| `sla_calendar` | Immutable calendar versions: UTC offset, working weekdays, daily window, holidays. A later version never changes an existing clock. |
| `sla_policy` | Published policy versions (duration, basis, anchors, calendar pin, allowed pause reason codes, warning and escalation schedule). Content is immutable; only `PUBLISHED -> RETIRED`. |
| `sla_clock` | One clock per application stage. Deadline changes only on a `PAUSED -> RUNNING` resume (DB trigger). |
| `sla_clock_event` | Insert-only history of every transition (actor, correlation, before/after deadline). |
| `idempotency_record`, `outbox_event`, `inbox_event` (+ `_platform`) | SF-CON-IDEMPOTENCY / SF-CON-OUTBOX template. |

All tenant tables use `FORCE ROW LEVEL SECURITY` with `sf_platform.current_tenant_id()`. The runtime
login inherits only `sf_app` and `sf_cmp029_rw`; it is not the table owner and has no privilege on any
other component's schema.

## Rules enforced

- **Server-authoritative time.** The only time source is the injected service clock. Every request
  member that could carry a clock value (`now`, `occurred_at`, `deadline_at`, `started_at`, ...)
  is refused with `CLIENT_TIME_NOT_AUTHORITATIVE`; unknown members are refused.
- **Pause** is accepted only for a `RUNNING` clock whose published policy lists the reason code and
  whose deadline has not elapsed. The caller cannot assert that a pause is allowed.
- **Resume** is accepted only for a `PAUSED` clock; the deadline is recomputed from the remaining
  working time on the pinned calendar.
- **Complete** requires the policy's completion anchor and a resumed clock. A late completion keeps
  `breach_at`.
- **Evaluate** (timer wakeup) computes warning, breach and escalation from server time. Paused and
  completed clocks never breach.
- **No case-state mutation.** CMP-029 holds no reference to CMP-015 and no privilege on case tables.
  Events are SLA events only (`sf.sla.events.v1`).
- **No provider code.** Breach notification is the `SlaNotificationPort` toward CMP-025 (M06), called
  after commit, carrying identifiers and codes only. No SMS, e-mail, push or other provider exists
  here; the package declares no dependencies.

## Interfaces

HTTP routes are framework-neutral (`createSlaApi(...).handle(request)`); `contracts/openapi.json`
documents them. Mapping to Eng v1.4: `POST /sla/calculate` = `POST /v1/sla-clocks`,
`GET /applications/{id}/sla` = `GET /v1/applications/{id}/sla-clocks`, `POST /sla/{id}/pause|resume`
= `POST /v1/sla-clocks/{id}/pause|resume`.

Events (`contracts/asyncapi.json`): `SlaClockStarted`, `SlaClockPaused`, `SlaClockResumed`,
`SlaClockCompleted`, `SlaBreachApproaching`, `SlaBreached`, `EscalationTriggered`.

Ports:

- `DeficiencyClockPort` (INT-009): `pauseForDeficiency` / `resumeAfterDeficiency`, implemented by
  `SlaService`; CMP-019 (Wave B) consumes the interface via the published API, not by importing code.
- `SlaNotificationPort` (CMP-025, M06): `UnboundNotificationPort` is the default until M06.
- `AuthorizationPort` (OPA PEP, fail closed), `ContextResolver` (server-derived request context).

## Non-goals

- Host mount on `apps/api` (SF-M05-009). The host adapts `createSlaApi` and supplies a `SqlPool`.
- Notification providers and channel selection (M06 / CMP-025).
- Any statutory interpretation: durations, anchors, calendars and pause reasons all come from
  published policy data.

## Tests

- `pnpm --filter @serviceform/cmp-029-sla-escalation run test:unit`: calendar math, clock domain,
  API/service behaviour, contract conformance against the FROZEN schemas.
- `DATABASE_URL=... pnpm --filter @serviceform/cmp-029-sla-escalation run test:integration`:
  PostgreSQL privilege boundary, FORCE RLS, DB guards and an end-to-end flow on a real login role.
