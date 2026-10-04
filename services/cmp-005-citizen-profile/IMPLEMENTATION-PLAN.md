# SF-M02-002 implementation plan — CMP-005 Citizen Profile

Status: **IMPLEMENTATION_READY** for independent Verify. **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M02-002 |
| Component | CMP-005 |
| Integrations | INT-001 (partial, SIMULATED DigiLocker), INT-011, INT-013 |
| Builder | serviceform-foundation-builder (this agent) |
| Branch | `cursor/m02-citizen-profile-76e4` |
| Base | `origin/main` @ `bd14a4a` (promote); lock prefix `8613d0ec` |
| Schema | `sf_citizen_profile` |
| Privilege role | `sf_cmp005_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **Not claimed.** |

## Impact

- Domain: tenant-owned citizen profile + provenance-aware claims in IDENTITY/ADDRESS/FAMILY/OCCUPATION sections. Catalog is platform vocabulary, not statute.
- Data: FORCE RLS on tenant-owned tables; outbox from frozen SF-CON-OUTBOX template.
- APIs: component-local OpenAPI under `/v1`. Host mount deferred to SF-M02-003.
- Events: ProfileEnsured, ProfileClaimUpserted, VerifiedClaimsImported (value hashes only) + AuditEventSubmitted.
- Consent: CMP-030 access-check **port** (fail-closed). No SQL into `sf_consent_privacy`.
- Identity: subject directory **port** + server-derived RequestContext. No client tenant headers.
- DigiLocker: SIMULATED adapter; PRODUCTION refuses non-REAL bindings. No network inside DB transactions.
- Authorization routes: dual `@fastify/rate-limit` + `fastify-rate-limit` (CMP-032/CodeQL pattern); 429 `SF-RATE-001`.

## Migrations

1. `1759500800000_cmp-005-citizen-profile.sql`
2. `1759500800001_cmp-005-outbox.sql` (template substitution only)

## Acceptance (builder evidence)

- PII not logged / not copied into domain events
- Purpose-bound access via consent port
- RLS FORCE; wrong-tenant zero rows; CROSS_TENANT_LEAKAGE=0
- Cross-component SQL DENY (peer role and consent schema)
- INT-013 SIMULATED / fail-closed
- Host mount deferred
