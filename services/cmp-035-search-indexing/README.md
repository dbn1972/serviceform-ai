# CMP-035 Search & Indexing Service

SF-M08-001 (CG-02 Wave A). Tenant-safe search over non-authoritative projections. **Not CERTIFIED.**
Builder evidence only; gates are issued by human/CI. Host mount is deferred to SF-M08-007.

| Field | Value |
|---|---|
| Module / component | M08 / CMP-035 |
| Integrations | INT-010 (events → index), INT-011 (tenant isolation) |
| Frozen contract | SF-CON-SEARCH-DOCUMENT v1 (`contracts/m08/schemas/search-document.schema.json`) |
| Schema / role | `sf_search` / `sf_cmp035_rw` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS) |
| Migrations | `db/migrations/1759600350000_cmp-035-search-indexing.sql`, `db/migrations/1759600350001_cmp-035-outbox.sql` |

## Projection only

`SearchIndexConsumer.ingest({ topic, envelope })` is the handler the CMP-038 consumer runtime calls
for each SF-CON-EVENT-ENVELOPE. Nothing in CMP-035 reads another component's tables.

- Which topics, aggregate types and event types are indexed, and which facets are copied, comes from
  a published projection rule (`ProjectionRulePort`, pinned by `rule_id` + `rule_version`). The
  default port has no rules, so nothing is indexed until metadata says so. There is no
  service-, tenant- or source-specific code path.
- Only declared scalar facets are stored. The rest of the event payload is discarded.
- Each row keeps the source component, source record id, source aggregate type, source event id
  and source `aggregate_version`. The source stays authoritative; nothing is written back.
- Updates only move forward: an event whose source version is not newer than the stored one is
  `STALE` and changes nothing (also enforced by trigger). Remove events tombstone the row
  (`status = REMOVED`, empty facets) so a late older upsert cannot resurrect it.
- Re-delivery is idempotent through `sf_search.inbox_event` (consumer group `cmp-035.indexer`) and
  a deterministic RFC 9562 v8 (SHA-256 name-based) `document_id` per (tenant, source component, source record).
- Each projection write emits `SearchDocumentIndexed` / `SearchDocumentRemoved` and an audit event
  through the SF-CON-OUTBOX outbox (relayed by CMP-038) in the same transaction.
- Platform events (`tenant_id = null`) are never indexed.

## Tenant-safe query

`POST /search/queries` and `GET /search/documents/:documentId` take the tenant only from the
verified request context; tenant-identifying headers and a `tenant_id` body field are rejected.
Every query is authorized through the OPA port, runs under FORCE RLS with an explicit
`tenant_id = $1` predicate, and the service refuses to return a row whose tenant differs from the
caller (`SF-TEN-002`). Hits contain a frozen `SearchDocument` plus source version and projection pin.

## Ports and simulation

`AuthorizationPort` (OPA) and `ProjectionRulePort` (metadata) are called before the domain
transaction opens; calling them inside it fails with `NETWORK_IO_IN_DOMAIN_TX`.
`SimulatedProjectionRules` is refused in PRODUCTION and outside LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE
(INT-013). An OpenSearch mirror is not part of this slice; it would consume `sf.search.events.v1`
through SF-CON-CONNECTOR-BINDING later.

`package.json` declares no dependencies so the root lockfile is untouched.
