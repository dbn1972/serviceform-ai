# CMP-058 — Government Semantic & Data Dictionary Registry

SF-M09-003 builder package. Host mount deferred to SF-M09-HOST.

## Scope
- Schema `sf_semantics`, privilege role `sf_cmp058_rw` (ADR-0006 Option A).
- Canonical **GLOBAL** semantic elements (opaque refs only).
- Tenant **FORCE RLS** field bindings (INT-016 Studio/runtime pin by `element_id` + version).
- Contracts: SF-CON-SEMANTIC-ELEMENT; invented statutory / field meanings forbidden.

## APIs (`/v1`)
| Method | Path | Notes |
|---|---|---|
| GET | `/elements` | Latest version per element |
| GET | `/elements/:id` | Latest version |
| GET | `/elements/:id/versions/:version` | Exact version |
| POST | `/elements` | Privileged admin + MFA → DRAFT |
| POST | `/elements/:id/publish` | DRAFT → PUBLISHED (immutable payload) |
| POST | `/elements/:id/deprecate` | PUBLISHED → DEPRECATED |
| GET/POST/DELETE | `/bindings[/:id]` | Tenant field → published element |
| POST | `/mappings/validate` | Opaque-ref validation (INT-016) |
| GET | `/usage/:id` | Tenant impact analysis |

## Non-claims
Not CERTIFIED. Not G3/G4/G6. No invented government field meanings.
