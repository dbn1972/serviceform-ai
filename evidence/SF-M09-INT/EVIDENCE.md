# SF-M09-INT evidence — independent integration stitcher

**Not CERTIFIED. Not G3. Not G4. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M09-INT |
| Branch | `cursor/m09-int-91f2` |
| Base | post SF-M09-HOST #170 on main |
| Suites | INT-011 host · INT-014 scheduler · INT-015 assisted · INT-016..019 seams |
| Local vitest | **60/60 PASS** |
| Production code modified | **false** |
| CROSS_TENANT_LEAKAGE | **0** (forged-tenant probes) |

## Recorded FINDINGS (owner; not patched by stitcher)

1. CMP-058 `POST /v1/elements` validates body before auth (400 SF-SYS-003 when context null).
2. CMP-060 unauth error envelope is nested `{error:{code}}` (not SF-CON-ERROR-RESPONSE).
3. CMP-059/060 session keys deviate from SF-CON-DB-SESSION-CONTEXT (`sf.*` / `app.current_*`).
4. CMP-060 host without authz port allows create; review routing may run inside DB tx; risk-assessment response has additionalProperties vs FROZEN schema.

5. CMP-060 admits SIMULATED review-routing and SimulatedAllowAllTenantAuthz on PRODUCTION host mounts.

## Certification stance

CERTIFIED=false · G3=false · G4=false · G6=false · recommended_result `SF_M09_INT_PASS_WITH_FINDINGS`.
