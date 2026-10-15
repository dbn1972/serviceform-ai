# SF-M09-SEC evidence — independent security verifier

**Not CERTIFIED. Not G3. Not G4. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M09-SEC |
| Branch | `cursor/m09-sec-91f2` |
| Local vitest (default) | **36/36 PASS** |
| CROSS_TENANT_LEAKAGE (HTTP) | **0** (282 forged requests) |
| CROSS_TENANT_LEAKAGE (Postgres live) | **1** (CMP-059 outbox; critical) |
| Critical findings | **2** |
| recommended_result | **`SF_M09_SEC_FAIL`** |
| G4 recommended | **false** |

## Critical FINDINGS (owner; not patched)

1. **CMP-059** `sf_migration.outbox_event`: PLATFORM_OPERATIONAL + tenant_id, no FORCE RLS; live T2 read of T1 event.
2. **CMP-060** host without authz → `SimulatedAllowAllTenantAuthz` fail-open.

Additional HIGH: CMP-059/060 session-context deviations; CMP-060 review-in-tx; SIMULATED PRODUCTION ungated.

Independent verifier: [SF-M09-SEC security suites](bc-296c4d68-ae66-55fe-a9bb-2acc70124c0a).

## Certification stance

CERTIFIED=false · G3=false · G4=false · G6=false · self_certified=false.
