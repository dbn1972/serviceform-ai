# SF-M03-001 implementation plan — CMP-001 Service Catalogue & Registry

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M03-001 |
| Component | CMP-001 |
| Integrations | INT-002 (catalogue side), INT-011, INT-013 fail-closed |
| Builder | serviceform-studio-builder |
| Schema | `sf_catalogue` |
| Privilege role | `sf_cmp001_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **false** |

## Impact

- Domain: generic categories, canonical services, tenant offerings, opaque jurisdiction/provider bindings, searchable tags/lifecycle. No named-service branching.
- Data: `sf_catalogue` only. GLOBAL canonical tables; TENANT_SCOPED offerings with FORCE RLS. No cross-schema SQL.
- APIs: list/create categories and canonical services; tenant offerings, versions, bindings.
- Events: `CanonicalServiceChanged`, `ServiceOfferingChanged`, `OfferingBindingChanged` + audit outbox.
- Versioning: insert-only versions. Published pins refused unless `app.privileged_marker=CATALOGUE_PIN` (owned later by CMP-052).
- Maker-checker / Studio / host mount: **not** this envelope (SF-M03-004/007/008).
- INT-013: plugin refuses PRODUCTION + critical SIMULATED.

## Tests

Unit (memory pool + domain), contract (OpenAPI/AsyncAPI/outbox template), integration (RLS, privilege boundary, pin immutability, header denial).
