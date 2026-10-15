# SF-M09-INT evidence — independent integration stitcher

**Not CERTIFIED. Not G3. Not G4. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M09-INT |
| Branch | `cursor/m09-int-91f2` |
| Local vitest | **49 passed · 9 expected fail (FINDINGS)** |
| CROSS_TENANT_LEAKAGE (HTTP) | **0** |
| Production code modified | **false** |
| recommended_result | **`SF_M09_INT_FAIL`** |
| G4 recommended | **false** (blocking owner FINDINGS) |

## Blocking FINDINGS (owner; not patched)

F-01..F-07 CMP-060/059: error envelope, session-context mismatch, authz default-allow, SIMULATED in PRODUCTION, review-in-tx, schema additionalProperties, CMP-059 session keys. F-08 CMP-058 validation-before-auth (non-blocking).

Independent stitcher: [SF-M09-INT stitcher suites](bc-0a208368-24c7-5b12-a472-7aa555f0c533).

## Certification stance

CERTIFIED=false · G3=false · G4=false · G6=false · self_certified=false.
