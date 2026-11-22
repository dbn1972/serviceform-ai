# SF-65 — SAMPLE_LAB catalogue lab-offer expansion

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false`  
**Connectors:** DigiLocker / SMS / Payment remain **SIMULATED** (no REAL)  
**Policy:** SAMPLE_LAB DUMMY sample parameters only — not statute / not production policy  
**Income:** IND-SOC-031 stays DUMMY-labeled; no invented statute (SF-33 owner)

## What changed

Citizen SAMPLE_LAB placement expanded from **6 → 13** lab offers using existing DRAFT Certificate / Licence / Permit stubs + packs:

| Catalogue | Type | Notes |
|---|---|---|
| IND-SOC-002 | Certificate | Residence PUBLISHED (unchanged) |
| IND-SOC-031 | Certificate | Income M11 shell DUMMY (unchanged) |
| IND-SOC-001 | Certificate | Domicile (unchanged) |
| IND-CIV-001 | Certificate | Birth Registration (unchanged) |
| IND-AGR-002 | Certificate | Farmer (unchanged) |
| IND-EDU-004 | Certificate | Transfer · fee>0 SIM (unchanged) |
| IND-SOC-003 | Certificate | Permanent Residence — **new** |
| IND-EDU-002 | Certificate | Bonafide Student — **new** |
| IND-BTP-001 | Licence | Trade Licence — **new** |
| IND-AGR-010 | Licence | Seed Dealer — **new** |
| IND-LAB-019 | Licence | Factory Registration / Licence — **new** |
| IND-ULB-007 | Permit | Building Construction — **new** |
| IND-ENV-002 | Permit | Tree Transit — **new** |

Inspection/appointment pins remapped from placeholder `IND-LIC-001` / `IND-LIC-FACTORY-001` → real stubs `IND-BTP-001` / `IND-LAB-019`.

## Executed checks

```text
pnpm exec vitest run \
  packages/service-templates/test/lab-offer-sample-data.test.ts \
  packages/service-templates/test/catalogue.test.ts \
  packages/m10-sample-lab/test/appointment-catalogue.test.ts \
  packages/m10-sample-lab/test/m08-ops-catalogue.test.ts \
  packages/m10-sample-lab/test/fee-catalogue.test.ts \
  apps/web-citizen/test/catalogue.test.ts \
  apps/web-citizen/test/m11-income-gated.test.ts \
  apps/api/test/scheduler-lab.test.ts \
  apps/api/test/payment-lab.test.ts
```

Result: **all passed** (676 tests across those files; lab-offer suite alone 229 + catalogue 439).

Form pin IDs for all 13 offers verified against `stubVersionId` / handcrafted version ids.

## Recommended gate

Design/Develop complete for lab-offer expansion. **Not** VERIFIED/CERTIFIED. `CERTIFIED=false`. `G6=false`.
