# SF-M05-004 impact plan (CMP-029)

- Module/IDs: M05, CMP-029, INT-009, INT-011; Eng-v1.4-CMP-029, Constitution-16-sla-clock.
- Domain: pure `domain/calendar.ts` and `domain/clock.ts` (decide/apply/replay/verify); no I/O.
- Data: `sf_sla` schema, migrations `1759540400000_cmp-029-sla-escalation.sql` and
  `1759540400001_cmp-029-outbox.sql`; rollback drops the schema (privilege role retained).
- APIs/events: `contracts/openapi.json`, `contracts/asyncapi.json`, `contracts/events/*`; clock
  projection conforms to FROZEN `SF-CON-SLA-CLOCK`.
- Tenancy/authz: server-derived context only, OPA PEP before any state change, FORCE RLS, ADR-0006.
- Failure model: PDP outage fails closed (503); notification failure never rolls back SLA state;
  concurrent commands serialise on the clock row.
- Observability: audit and domain events through the SF-CON-OUTBOX; correlation id on every row.
- Lockfile: the package declares no dependencies, so the frozen-lockfile install is unaffected.
  Contract tests resolve AJV through `packages/contracts`; integration tests resolve the driver
  through `db`. Both are test-time resolutions, not package dependencies.
