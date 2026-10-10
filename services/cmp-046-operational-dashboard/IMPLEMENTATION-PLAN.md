# SF-M08-004 impact plan (CMP-046)

- Module/IDs: M08, CMP-046, INT-011; Eng-v1.4-CMP-046, Constitution-OPA-authz.
- Domain: pure `domain/model.ts` (view catalogue, sample validation, freshness, status roll-up).
  Sample validation refuses anything that is not an aggregate (UUID-like or free-text dimensions,
  personal dimension names, unknown fields).
- Data: `sf_ops_dashboard` schema, migrations `1759542460000_cmp-046-operational-dashboard.sql` and
  `1759542460001_cmp-046-outbox.sql`; rollback drops the schema (privilege role retained). CHECK
  constraints pin each view to its owning source component and force `non_authoritative`.
- APIs/events: `contracts/openapi.json`, `contracts/asyncapi.json`, `contracts/events/*`; uses only
  FROZEN shared envelopes (outbox, audit, error, authz, request context, isolation).
- Tenancy/authz: server-derived context only, OPA PEP before any read or port call, FORCE RLS,
  ADR-0006 privilege role, no privilege on peer schemas. Cross-tenant/platform-wide operator views
  are NOT built (would need an ADR).
- Failure model: PDP outage fails closed (503); a failing, hung or invalid source never rolls back
  state, it records `UNAVAILABLE` and keeps last-known metrics; concurrent refreshes serialise on
  the snapshot row.
- Observability: refresh log (insert-only), `OpsViewRefreshed` events, audit for reads, refreshes
  and denials, correlation id on every row.
- Dependencies: none declared (frozen-lockfile unaffected). Tests resolve AJV through
  `packages/contracts` and the driver through `db`.
- Deferred: host mount (SF-M08-007); concrete owner adapters for the five ports; OPA policy data
  for the `OPS_*` actions (`policy/**` is read-only for this lane); UI (UX4G) work.
