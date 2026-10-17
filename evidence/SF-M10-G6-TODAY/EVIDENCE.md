# SF-M10-G6-TODAY — finishable G6 scaffolding (no invented policy)

**Not CERTIFIED. G6 not issued. self_certified=false.**

Advances M10 G6 prerequisites that do **not** require DigiLocker registrar credentials, PERF load numbers, RTO/RPO, or statute invention.

| Field | Value |
|---|---|
| Base tip | `aa5f012` (#184) |
| Branch | `cursor/m10-g6-today-91f2` |

## Executed locally

| Suite | Result | Notes |
|---|---|---|
| G5 hold + schema `load-profile.yaml` | **3 passed · 1 skipped** | All targets `null` / OWNER_REQUIRED |
| Resilience hold + `resilience-checklist.yaml` | **3 passed · 1 skipped · 1 todo** | All targets `null` / OWNER_REQUIRED |
| UX4G hold | **2 passed · 1 skipped · 1 todo** | Shell bar separate (below) |
| CMP-012 DigiLocker unit (SIMULATED) | **66 passed** | Lab-only; not REAL G6 clearance |
| Playwright shells.spec.ts | **20 passed** | axe WCAG 2.1 A/AA, keyboard, 320px, headers |
| Playwright golden IND-SOC-002 | **12 passed · 7 skipped** | Health/tenant/ARIA pass; journeys skipped (`SHELL_JOURNEY_NOT_IMPLEMENTED` / policy gate) |

## Still blocked for human G6 (unchanged)

1. G5 PERF cell + authorized numeric load profile (`SF_M10_G5_PERF_READY`)  
2. Resilience runbook + restore cell (`SF_M10_RESILIENCE_READY`)  
3. REAL DigiLocker registrar credentials + registered doc type  
4. IND-SOC-002 journey UI beyond M00 shells + UX4G READY pack  
5. TSB immutability seal after REAL DigiLocker/DLT  

## Non-claims

G6=false · CERTIFIED=false · G5 PASS=false · REAL DigiLocker=false · invented policy=false · journey E2E=false
