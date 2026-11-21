# SF-60 — SAMPLE_LAB TSB immutability seal engineering

**Branch:** `cursor/tsb-immutability-seal-f948`  
**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · DigiLocker **SIMULATED** · `lab_eng_sealed=true` · `tsb_immutability_sealed=false` (G6 gate)

## Scope

Lab-prove CMP-052 published pin-graph immutability seal engineering on SAMPLE_LAB.
Does **not** claim human G6 seal, CERTIFIED, or REAL DigiLocker/DLT readiness.

## Delivered

| Layer | Change |
|---|---|
| m10 helpers | `packages/m10-sample-lab/src/tsb-seal-catalogue.ts` — hash recompute, prove, fail-closed outside SAMPLE_LAB/LOCAL/CI |
| Lab fixture | `fixtures/lab/platform/tsb-seal-catalogue.json` |
| Host adapter | `apps/api/src/platform/tsb-seal.ts` — GET catalogue / GET status / POST prove |
| Runtime | Always registers seal routes on platform lab; optional CMP-052 pool read |
| Golden honesty | Additive `lab_eng_gate.lab_eng_sealed=true`; **keeps** `tsb_immutability_sealed=false` |
| Admin UI | Bindings desk “Prove lab eng seal” + BFF `/api/lab/tsb-seal/:id/prove` |
| G6 hold | Dual-flag assertion: lab eng may be true; G6 seal gate stays false |

## Executed checks

| Check | Result |
|---|---|
| m10 + api + admin unit | **15 passed** (`junit/sf60.xml`, `vitest-unit.log`) |
| G6 connector / seal hold | **3 passed · 3 todo** (`junit/g6-hold.xml`, `vitest-g6-hold.log`) |
| `@serviceform/api` typecheck | **pass** (`typecheck-api.log`) |
| `@serviceform/m10-sample-lab` typecheck | **pass** (`typecheck-m10.log`) |
| `@serviceform/web-admin` typecheck | **pass** (`typecheck-admin.log`) |

## Explicit non-claims

- CERTIFIED=false
- G6=false / g6_issued=false
- `tsb_immutability_sealed=false` (production/G6 gate — owner + REAL DigiLocker/DLT)
- No REAL DigiLocker / DLT
- Agents do not self-certify; owner still owns human G6 seal claim
