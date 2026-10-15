# SF-M09-005-REM — CMP-060 authz fail-closed

**Not CERTIFIED. Not G3. Not G4. Not G6. self_certified false.**

| Field | Value |
|---|---|
| Defect | `registerRiskRoutes` defaulted to `SimulatedAllowAllTenantAuthz` (fail-open) |
| Fix | Default `DenyAllTenantAuthz`; SimulatedAllowAll for explicit unit-test injection only |
| Branch | `cursor/m09-005-rem-authz-failclosed-91f2` |
| Owner | SF-M09-005 / CMP-060 |

## Certification stance

CERTIFIED=false · G4=false · G6=false · g4_recommended=false until independent INT/SEC re-verify PASS.
