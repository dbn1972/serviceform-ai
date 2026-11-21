# SF-47 Evidence Deficiency + Citizen Resubmit UI

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false`  
**Scope:** Officer Raise Deficiency + Citizen ACTION_REQUIRED resubmit against CMP-019 on SAMPLE_LAB.

## What landed

| Layer | Change |
|---|---|
| Platform lab | Optional `DATABASE_URL_CMP019` mounts CMP-019; `LabCaseCommandPort` → CMP-015; owner-enriching authorizer for citizen `DeficiencyNotice` |
| Bootstrap | `sf_lab_cmp019` / `sf_cmp019_rw` runtime login |
| OPA | `DEFICIENCY_OPEN/RESPOND/CLOSE/READ` + `DeficiencyNotice`; officer role grants; citizen owner grants |
| CMP-019 | PEP pre-read so respond/get/close carry `application_id` for owner path |
| Catalogue | `fixtures/lab/platform/deficiency-catalogue.json` + `@serviceform/m10-sample-lab` (IND-SOC-002 evidence item codes) |
| Officer | Raise Deficiency / Close on case detail; BFF `/api/portal/applications/[id]/deficiencies` |
| Citizen | ACTION_REQUIRED resubmit form; SIMULATED evidence refs |

## Checks executed

| Check | Result |
|---|---|
| `pnpm exec vitest run apps/web-officer/test/deficiency.test.ts apps/web-citizen/test/deficiency.test.ts apps/api/test/deficiency-lab.test.ts` | PASS (8) |
| `pnpm exec vitest run apps/api/test/platform-lab.test.ts` | PASS (includes CMP-019 mount when `DATABASE_URL_CMP019` set) |
| `pnpm --filter @serviceform/cmp-019-deficiency test:unit` | PASS (33) |
| `pnpm --filter @serviceform/web-officer typecheck` | PASS |
| `pnpm --filter @serviceform/web-citizen typecheck` | PASS |
| `pnpm --filter @serviceform/api typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab typecheck` | PASS |

## Gate recommendation

- **Recommended:** DESIGN/DEVELOP verified for SAMPLE_LAB UI wiring; CI must stay green before merge.
- **Not claimed:** CERTIFIED, G6, UX4G READY, REAL DigiLocker, TSB seal, production go-live.
- Agents do not self-certify.
