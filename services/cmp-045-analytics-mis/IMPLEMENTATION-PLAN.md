# SF-M08-003 impact plan (CMP-045)

- Module/IDs: M08, CMP-045, INT-010, INT-011; Eng-v1.4-CMP-045, Constitution purpose limitation.
- Domain: pure `domain/period.ts`, `domain/privacy.ts`, `domain/projection.ts` (event -> one aggregate
  contribution), `domain/envelope.ts`; no I/O. Only allowlisted top-level event fields are read and
  nothing from the event is retained except the aggregated delta.
- Data: `sf_analytics` schema, migrations `1759560450000_cmp-045-analytics-mis.sql` and
  `1759560450001_cmp-045-outbox.sql`; rollback drops the schema (privilege role retained). Tables:
  published metric definitions, projection state (generation swap), aggregate metric points, dedupe
  ids, idempotency, SF-CON-OUTBOX template. No person-level, case, application or payment column.
- APIs/events: `contracts/openapi.json`, `contracts/asyncapi.json`, `contracts/events/*`; metric
  projection conforms to FROZEN `SF-CON-ANALYTICS-METRIC`. Event ingestion is a CMP-038 subscription
  handled by `AnalyticsService.ingest`.
- Tenancy/authz: tenant from the validated envelope (consumer) or server-derived request context
  (API); OPA PEP before any read or state change; FORCE RLS; ADR-0006 role `sf_cmp045_rw`.
- Purpose limitation: each definition declares one purpose; a read must declare the same purpose
  (server context wins over a query parameter) or is refused and audited.
- Disclosure control: per-definition minimum cohort size; cells below it are never returned.
- Failure model: PDP outage fails closed (503); duplicate delivery is a no-op (inbox + applied-event
  ids); schema-version mismatch and invalid values fail explicitly; rebuild uses a leased,
  token-checked generation and replaces the active generation only on completion.
- Observability: audit and domain events through the SF-CON-OUTBOX; correlation id on every row.
- Not in scope: host mount (SF-M08-007), retention/archival (SF-M08-005), export jobs, jurisdiction
  row filtering beyond OPA resource attributes, BI/lake storage.
- Lockfile: the package declares no dependencies, so the frozen-lockfile install is unaffected
  (`EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`: the workspace importer is added at STITCH-A).
