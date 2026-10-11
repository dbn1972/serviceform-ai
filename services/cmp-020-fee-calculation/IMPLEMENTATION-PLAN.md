# SF-M06-001 impact plan (CMP-020)

- Module/IDs: M06, CMP-020, INT-007 (fee hop), INT-011; Eng-v1.4-CMP-020; Constitution deterministic rules.
- Domain: deterministic fee quote from pinned published fee policy + pinned CMP-008 rules; no fee schedule, waiver or statutory amount in code; no LLM.
- Data: `sf_fee`; migrations `1759620200000_cmp-020-fee-calculation.sql` and `1759620200001_cmp-020-outbox.sql`; quotes/lines insert-only; deferred total = sum(lines) check; down drops schema (privilege role retained).
- APIs/events: component-local OpenAPI/AsyncAPI; produces frozen SF-CON-FEE-QUOTE; shared envelopes read-only.
- Tenancy/authz: server-derived context, OPA PEP (`FEE_QUOTE_CREATE`/`FEE_QUOTE_READ`), FORCE RLS, ADR-0006 `sf_cmp020_rw` NOLOGIN.
- Ports before the transaction: CMP-015 pins, fee-policy metadata, CMP-008 rules. Unbound → fail closed.
- Lockfile: no package dependencies; new workspace importer is the expected STITCH-A lockfile admission residual.
- Rollback: down migration; no peer schema touched.
