# M10 G6 prerequisites — blocker inventory (post-Odisha sample)

**G6 issued = false.** Policy sample from Odisha e-District is on SoT (`e1ffa81` / [#183](https://github.com/dbn1972/serviceform-ai/pull/183)).  
Tip after G6-prereq holds: `aa5f012` / [#184](https://github.com/dbn1972/serviceform-ai/pull/184).  
This inventory records what still blocks human `G6_RELEASE_CERTIFIED` issuance. No statute invented.

| # | Prerequisite | Status | Blocker (actionable) | Invent policy? |
|---|---|---|---|---|
| 1 | Owner policy inputs (Finding M-04) | **RESOLVED (sample)** | Odisha public portal facts applied; DigiLocker/DLT remain `SAMPLE_LAB_*` | No |
| 2 | Golden INT / tenant isolation | **PASS (harness)** | Local INT 24 passed · 6 todo with `SF_M10_OWNER_INPUTS_READY=1` | No |
| 3 | Golden E2E (Playwright) | **PARTIAL** | Health/tenant/ARIA **12 passed**; 7 journeys skipped — M00 shells lack IND-SOC-002 routes (`SHELL_JOURNEY_NOT_IMPLEMENTED`) | No |
| 4 | G5 performance / soak | **BLOCKED** | Schema-only `load-profile.yaml` (all targets `null`); needs PERF cell + human numbers (`SF_M10_G5_PERF_READY`) | No |
| 5 | Resilience / backup / restore / rollback | **BLOCKED** | Schema-only `resilience-checklist.yaml` (all targets `null`); needs ops runbook + cell | No |
| 6 | REAL DigiLocker connector | **BLOCKED** | SIMULATED lab unit **66 passed** (non-G6); PRODUCTION needs registrar credentials + registered doc type | No |
| 7 | REAL / SANDBOX payment | **N/A for ₹0 fee; REAL still blocked for general path** | Odisha fee ₹0 → lab skip OK; REAL payment still needs provider credentials for non-zero tenants | No |
| 8 | UX4G a11y / keyboard / responsive / visual | **PARTIAL (shells)** | Shell axe/keyboard/320px **20 passed**; journey UX4G still blocked (`SF-M10-005` PLANNING / `SF_M10_UX4G_READY`) | No |
| 9 | TSB immutability seal | **BLOCKED** | Maker/checker sample recorded; seal deferred until REAL DigiLocker/DLT bindings | No |

## Fail-closed hold suites + schema-only artifacts

| Suite | Config | Asserts |
|---|---|---|
| G5 perf hold | `tests/performance/m10/` + `load-profile.yaml` | `SF_M10_G5_PERF_READY` unset → no G5 PASS; targets remain `null` |
| UX4G hold | `tests/ux4g/m10/` | `SF_M10_UX4G_READY` unset → no UX4G PASS claim |
| Resilience hold | `tests/resilience/m10/` + `resilience-checklist.yaml` | `SF_M10_RESILIENCE_READY` unset → no resilience PASS; targets remain `null` |
| REAL connector / TSB hold | `tests/integration/m10/g6-connector-hold.test.ts` | SAMPLE_LAB refused in PRODUCTION; TSB seal=false |

Evidence pack: `evidence/SF-M10-G6-TODAY/` (shells + golden health + DigiLocker SIMULATED lab).

Planning envelopes `SF-M10-004` / `SF-M10-005` / `SF-M10-PERF` remain **PLANNING** (not READY, not dispatched). No load-profile numbers, DigiLocker doc types, or RTO/RPO invented.

## What still needs USER / ops / credentials

1. Authorized G5 load-profile numbers + PERF cell  
2. Resilience runbook + restore cell  
3. REAL DigiLocker registrar credentials + registered doc type  
4. IND-SOC-002 journey UI (Studio/citizen/officer) + UX4G READY pack  
5. TSB immutability seal after REAL DigiLocker/DLT  

## Explicit non-claims

CERTIFIED=false · G6=false · g6_issued=false · self_certified=false · production DigiLocker=false · G5 evidence=false · journey E2E=false · resilience evidence=false
