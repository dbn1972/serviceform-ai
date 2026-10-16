# SF-M09-RESIDUAL-REM — clear non-critical INT/SEC residuals F-02/F-03/F-05/F-06

**Not CERTIFIED. Not G3. Not G4 issued. Not G6. self_certified false.**  
G4 remains **recommended** (SoT `52de009`) but **not issued** until human `finish g4`.

| Field | Value |
|---|---|
| Base SoT | `52de009` (post #177 G4 recommend merge) |
| Branch | `cursor/m09-residual-rem-91f2` |
| Owners | SF-M09-004 / CMP-059 · SF-M09-005 / CMP-060 |
| Auth | `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` |

## Defects cleared (owner rem)

| ID | Defect | Fix |
|---|---|---|
| F-02 | CMP-060 TX used non-FROZEN session keys | `withContextTx` → `dbSessionSettings` / `app.*` (SF-CON-DB-SESSION-CONTEXT) |
| F-03 | CMP-059 TX / helpers mismatched session keys | same; INT helpers `asTenant` set `app.*` |
| F-05 | SIMULATED ports constructible in PRODUCTION | `refuseSimulatedOutsideLab` on SimulatedReviewRouting + SimulatedAllowAll |
| F-06 | review routing inside authoritative DB tx | `routeToReview` only after COMMIT; DB row may mark review-needed in-tx |
| (align) | CMP-059 RLS `current_setting('sf.tenant_id')` | additive `1761100000002_cmp-059-session-rls-align.sql` → `sf_platform.current_tenant_id()` |

## Local executed evidence

| Suite | Result |
|---|---|
| CMP-060 unit | **30 passed** |
| CMP-060 contract | **8 passed** |
| CMP-059 unit | **32 passed** |
| SF-M09-INT independent | **55 passed · 3 expected fail** (F-01, F-07, F-08) |
| SF-M09-SEC | **36 passed** |

JUnit: `evidence/SF-M09-RESIDUAL-REM/junit/`.

## Still open (non-blocking for prior G4 recommend)

- **F-01** CMP-060 error envelope vs SF-CON-ERROR-RESPONSE  
- **F-07** CMP-060 advisory assessment schema / non-authoritative response shape  
- **F-08** CMP-058 validation-before-auth ordering  

Critical findings remain **0**. Independent INT/SEC re-verify of this rem is out of builder scope.

## Certification stance

CERTIFIED=false · g4_issued=false · G6=false · self_certified=false  
Do not issue G4 from this PR.
