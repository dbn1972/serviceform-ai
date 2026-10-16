# SF-M09-RESIDUAL-F-REM — clear F-01 / F-07 / F-08

**Not CERTIFIED. Not G3. Not G4 issued. Not G6. self_certified false.**

| Field | Value |
|---|---|
| Base | post-#180 SoT `41a4438` (after F-02/03/05/06 rem) |
| Branch | `cursor/m09-residual-f-rem-91f2` |
| Owners | CMP-060 · CMP-058 |
| Auth | `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` |

## Defects cleared

| ID | Defect | Fix |
|---|---|---|
| F-01 | CMP-060 nested `{error:{code…}}` refusal body | `sendError` → SF-CON-ERROR-RESPONSE (`error_code`, `message`, `correlation_id`) |
| F-07 | Assessment response had extra properties vs frozen schema | Strip `risk_tier` / `raw_risk_score` / `signal_count` / `review_requested`; lifecycle encodes review need |
| F-08 | CMP-058 POST `/v1/elements` → 400 before auth | Move context resolve to `onRequest` (before Fastify schema validation) |

## Local executed evidence

| Suite | Result |
|---|---|
| CMP-060 unit | **30 passed** |
| CMP-058 unit | **35 passed** |
| SF-M09-INT independent | **58 passed** (0 expected fail) |
| SF-M09-SEC | **36 passed** |

## Certification stance

CERTIFIED=false · g4_issued=false · G6=false · self_certified=false  
G4 remains **recommended** on prior SoT; **do not issue** without human `finish g4`.
