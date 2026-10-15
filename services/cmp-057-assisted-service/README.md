# CMP-057 Assisted Service / Omnichannel

SF-M09-002. Legally auditable assisted applications through counters, CSC/kiosks, call centres,
authorized representatives, guardians or institutional operators (INT-015).

Bound to the FROZEN `SF-CON-ASSISTED-SESSION` contract:

- **`applied_by_distinct_from_applied_for: true`** always. Self-assisted submissions are refused
  in the service and by a database CHECK / `guard_session()`.
- **No invented representation statute.** `representation_authority_ref` is an opaque
  owner-supplied reference; CMP-057 never interprets guardian calendars, power-of-attorney
  statutes or eligibility rules. `invented_statutory_policy_forbidden: true` is a constant.
- **OPA PEP on every route.** Operator cannot exceed role/jurisdiction; PDP outage fails closed.
- **Citizen resume** via one-time handoff token preserves `applied_for_citizen_id` and
  `application_id` unchanged.
- Tenant comes only from the server-derived request context. State, operator action, domain
  event and audit event commit together through SF-CON-OUTBOX; commands are idempotent.

Routes: see `contracts/openapi.json`. Host mount deferred to SF-M09-HOST; no UI. Schema
`sf_assisted`, privilege role `sf_cmp057_rw`.
