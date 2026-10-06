# SF-M05-006 impact plan (CMP-019)

- Module/IDs: M05, CMP-019, INT-009, INT-011; Eng-v1.4-CMP-019.
- Domain: notice lifecycle OPEN → RESPONSE_RECEIVED → CLOSED; no LLM statutory determination.
- Data: `sf_deficiency`; migrations   `1759541900000_cmp-019-deficiency.sql` and
  `1759541900001_cmp-019-outbox.sql`; down drops schema (privilege role retained).
- APIs/events: component-local OpenAPI/AsyncAPI; shared frozen envelopes read-only.
- Tenancy/authz: server-derived context, OPA PEP, FORCE RLS, ADR-0006 `sf_cmp019_rw` NOLOGIN.
- Ports after commit: CMP-015 command, CMP-029 INT-009 clock, CMP-025 notification.
- Lockfile: no package dependencies.
