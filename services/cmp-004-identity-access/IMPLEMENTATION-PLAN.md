# CMP-004 implementation (SF-M02-001)

Human-authorized CG-01 implementation. Not CERTIFIED.

## Domain
Officer IdP session issuance (SIMULATED), citizen OTP/session, DigiLocker identity **link**
(SIMULATED adapter, not CMP-012), recovery, PrincipalVerifier for CMP-048.

## Data
Schema `sf_identity`, privilege `sf_cmp004_rw`. TENANT_SCOPED officer tables ENABLE+FORCE RLS.
Citizen tables CITIZEN_PRIVATE. `session_lookup` PLATFORM_OPERATIONAL for token verify without
client tenant headers.

## Out of scope
- `apps/api` host composition (SF-M02-003)
- REAL Keycloak / SMS / DigiLocker
- Frozen contract edits
- Cross-component SQL
