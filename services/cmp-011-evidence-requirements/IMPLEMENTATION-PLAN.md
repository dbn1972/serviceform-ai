# CMP-011 implementation plan (SF-M04-003)

- Module M04; CMP-011; INT-011 (tenant isolation chain), INT-013 (external dependency simulation).
- Domain: `src/domain` (policy parser, tri-state predicates, resolver). Pure, no I/O.
- Data: `sf_evidence.evidence_policy` (draft/published, immutable once published), `evidence_resolution` (append-only), idempotency, outbox/inbox from the frozen template.
- API/events: component-local OpenAPI/AsyncAPI in `contracts/`; shared contracts consumed unchanged (13/13 FROZEN).
- Tenancy/authz: context from resolver only, tenant headers rejected, OPA decision per action, FORCE RLS, tenant-scoped idempotency.
- Failure paths: port unavailable -> SF-SYS-004; DigiLocker outage -> degrade; pin mismatch -> fail closed.
- Rollback: down migrations drop `sf_evidence` (role retained).
- Host mount deferred to SF-M04-007.
