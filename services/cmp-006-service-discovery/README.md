# CMP-006 Service Discovery Engine

SF-M08-006. Tenant-safe, jurisdiction-aware discovery of published catalogue services, bound to
the FROZEN `SF-CON-DISCOVERY-QUERY` contract (INT-003, INT-011).

- **Non-statutory.** Results are catalogue/search projections. `result_is_non_statutory` is
  constant `true` (service, frozen schema and DB CHECK). Nothing here decides eligibility.
- **Non-mutating until the citizen acts (INT-003).** Running a query writes only CMP-006's own
  query log. `POST /v1/discovery/queries/{id}/selections` is the single hand-off: the citizen
  who ran the query selects one of its results and CMP-006 emits `DiscoveryServiceSelected` with
  the catalogue version and TenantServiceBinding version pins. The draft owner creates the draft;
  `draft_created` is constant `false` here. Composite FKs make the database refuse selections by
  anyone but the query's citizen, of anything but a recorded result, or with different pins.
- **Catalogue pins.** The requested `catalogue_version_id` must be a published version of the
  caller's tenant (`404` unknown, `409 CATALOGUE_VERSION_NOT_PUBLISHED` otherwise); selection
  re-checks it.
- **Jurisdiction-aware.** Requested codes are resolved through CMP-003 master data (unknown or
  inactive codes are `400`); a service is available when its catalogue jurisdictions intersect
  the requested codes or the enclosing codes master data lists. No code names a jurisdiction.
- **Ports only.** `CataloguePort` (CMP-001), `JurisdictionPort` (CMP-003), `SearchPort`
  (CMP-035), `LocalizationPort` (CMP-053), `AuthorizationPort` (OPA). No peer imports, no
  cross-component SQL. Port calls never run inside a DB transaction; outages fail closed
  (`503 SF-INT-001`) except localization, which degrades to codes (`localization_status`).
- **Tenant safety.** Tenant only from the server-derived request context; tenant headers/body
  fields refused. Any search hit, catalogue entry or pin of another tenant aborts the query
  (`403 CROSS_TENANT_RESULT_BLOCKED`, audited). FORCE RLS on every tenant table; runtime via
  `sf_cmp006_rw` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS) + `sf_app`.
- **Data minimisation.** Raw keyword text is returned to the caller but never stored, emitted
  or audited; only `keyword_count` is kept.
- **No retention period** is defined here; retention of these rows is owner input via CMP-049.

Every route is a PEP call on OPA (`DISCOVERY_QUERY`, `DISCOVERY_QUERY_READ`,
`DISCOVERY_SERVICE_SELECT`); denials are audited `DENIED`, post-authorization refusals `FAILED`.
State, results, domain event and audit event commit together through SF-CON-OUTBOX rows.

Routes: `contracts/openapi.json`. Events: `contracts/asyncapi.json`. Host mount is deferred to
SF-M08-007; no UI.
