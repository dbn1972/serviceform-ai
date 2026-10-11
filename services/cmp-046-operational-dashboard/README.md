# CMP-046 Operational Dashboard

SF-M08-004. Tenant-scoped, **non-authoritative** operational read models for staff: SLA summary,
work-queue summary, integration health, event-bus health and platform health.

- Reads CMP-029 (SLA), CMP-017 (queues), CMP-037 (integration hub), CMP-038 (event bus) and
  CMP-047 (observability) **only through read-only aggregate ports** (`src/ports/summary-port.ts`).
  Owners supply the adapters; an unbound port reports the view `UNAVAILABLE` (never fabricated).
- Owns derived snapshots in `sf_ops_dashboard` only. Case, task and SLA-clock state stay with their
  owners; no route approves, rejects, assigns, pauses, resumes or escalates anything.
- Every view is a PEP call on OPA (`OPS_VIEW_SLA|QUEUE|INTEGRATION|EVENTS|HEALTH`,
  `OPS_REFRESH_VIEW`), fail-closed on PDP outage; citizens never reach it.
- Ports run outside the database transaction; the snapshot, refresh log, domain event and audit
  event commit together with the SF-CON-OUTBOX rows.

Routes: `GET /v1/ops/views`, `GET /v1/ops/views/{view_code}`, `POST /v1/ops/views/{view_code}/refresh`
(see `contracts/openapi.json`). Host mount is deferred to SF-M08-007; UI is out of scope.
