# SF-M10-G6-PREREQ — fail-closed prerequisite holds

**Not CERTIFIED. G6 not issued. self_certified=false.**

Post-Odisha-sample inventory of remaining G6 blockers with executed hold suites that refuse PASS claims until human-authorized env flags are set.

| Field | Value |
|---|---|
| SoT tip at authoring | `e1ffa81` (#183 Odisha sample MERGED) |
| Branch | `cursor/m10-g6-prereq-91f2` |
| Inventory | `docs/verification/M10-G6-PREREQUISITES.md` |

## Local executed (this evidence pack)

| Suite | Command | Result |
|---|---|---|
| G5 hold | `pnpm exec vitest run --config tests/performance/m10/vitest.config.ts` | **2 passed · 1 skipped** |
| UX4G hold | `pnpm exec vitest run --config tests/ux4g/m10/vitest.config.ts` | **2 passed · 1 skipped · 1 todo** |
| Resilience hold | `pnpm exec vitest run --config tests/resilience/m10/vitest.config.ts` | **2 passed · 1 skipped · 1 todo** |
| M10 INT + connector hold | `SF_M10_OWNER_INPUTS_READY=1 pnpm exec vitest run --config tests/integration/m10/vitest.config.ts` | **24 passed · 6 todo** |

JUnit under `evidence/SF-M10-G6-PREREQ/junit/`.

## Blockers (human / ops / credentials — not inventable)

1. G5 PERF cell + authorized load-profile targets (`SF_M10_G5_PERF_READY`)  
2. Resilience runbook + restore cell (`SF_M10_RESILIENCE_READY`)  
3. DigiLocker registrar credentials + registered doc type (not on e-District portal)  
4. UX4G Design System evidence pack (`SF_M10_UX4G_READY`)  
5. TSB immutability seal after REAL DigiLocker/DLT bindings  

## Non-claims

G6=false · CERTIFIED=false · G5 PASS=false · UX4G PASS=false · resilience PASS=false · production DigiLocker=false · invented policy=false
