# CMP-005 Citizen Profile Service

Platform citizen profile aggregate, sectioned claims, and verified-claim provenance for ServiceForm AI (M02 / SF-M02-002).

**Not CERTIFIED.** Host mount is deferred to SF-M02-003. Do not edit `apps/api/src/app.ts` in this task.

## Scope

- Authoritative schema: `sf_citizen_profile`
- Privilege role: `sf_cmp005_rw` (ADR-0006 Option A)
- Component-local APIs: `PUT/GET /v1/profiles/{subjectId}`, `PUT /v1/profiles/{subjectId}/claims`, `POST /v1/profiles/{subjectId}/verified-claims/import`
- Consent via CMP-030 **port** (no consent-store reimplementation, no cross-component SQL)
- Identity subject existence via **port** + frozen request-context (CMP-004 is a peer; unmerged sibling is not source of truth)
- DigiLocker: INT-013 **SIMULATED** adapter only, fail-closed in PRODUCTION
- Events: `ProfileEnsured`, `ProfileClaimUpserted`, `VerifiedClaimsImported` (hashes only; no claim values)

## Non-goals

- Recommendation engine CMP-007 (M08)
- Full CMP-012 DigiLocker connector (M07)
- Statutory profile fields (caste, religion, income, eligibility)
- Host registration in `apps/api`
