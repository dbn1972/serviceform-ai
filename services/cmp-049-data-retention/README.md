# CMP-049 Data Retention / Archival

SF-M08-005. **Policy-neutral** retention eligibility machinery bound to the FROZEN
`SF-CON-RETENTION-POLICY` contract. It records which eligibility state a tenant's resource is in
(`ACTIVE`, `ARCHIVE_ELIGIBLE`, `DELETE_ELIGIBLE`, `LEGAL_HOLD`) and enforces the transitions the
tenant's published policy allows.

- **No statutory periods.** No code, column or route carries a retention period, day count, due
  date or erasure timeline. `statutory_retention_policy_input_required` and
  `invented_statutory_period_forbidden` are always `true`. Periods arrive only as an opaque
  `owner_supplied_period_ref` bound once by an owner (duration-like values are refused in the
  service and by a database CHECK).
- **Fail closed.** `ARCHIVE_ELIGIBLE` / `DELETE_ELIGIBLE` are refused with `409 SF-APP-001`
  detail `POLICY_INPUT_REQUIRED` while the policy's period ref is null, in the service and again
  in the `sf_retention.retention_subject` trigger and `retention_transition_log` CHECK. Refusals
  are audited (`FAILED`).
- **Eligibility only.** Nothing here archives, purges or deletes another component's data; owners
  act on `RetentionEligibilityChanged` events. Resource ids are opaque references.
- Every route is a PEP call on OPA (`RETENTION_POLICY_REGISTER|READ|BIND_PERIOD_REF`,
  `RETENTION_SUBJECT_ENROLL|READ|EVALUATE`, `RETENTION_TRANSITION_<TO>`, plus
  `RETENTION_LEGAL_HOLD_RELEASE` when leaving `LEGAL_HOLD`), fail-closed on PDP outage, never
  inside a database transaction. Citizens never reach it; policy definition/binding is limited to
  `PRIVILEGED_ADMIN` / `SYSTEM` actors.
- Tenant comes only from the server-derived request context. State, transition log, domain event
  and audit event commit together through the SF-CON-OUTBOX rows; commands are idempotent.

Routes: see `contracts/openapi.json`. Host mount is deferred to SF-M08-007; no UI.
