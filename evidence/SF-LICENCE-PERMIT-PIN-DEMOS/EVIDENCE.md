# Licence/Permit pack maintainability + Studio→TSB pin demos

**Branch:** `cursor/licence-permit-pin-demos-3161`  
**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · DigiLocker/SMS/Payment **SIMULATED** · Licence/Permit **not citizen-offerable**

## Scope

- Extract shared pack-factory helpers so Certificate + Licence + Permit packs stay regenerable from one path.
- Add SAMPLE_LAB Studio→TSB pin demos for three real registry ids (Trade Licence, Factory Licence, Building Construction Permit).
- Align CMP-018 / CMP-056 catalogue placeholders (`IND-LIC-*`) to those real ids.
- Keep DRAFT/DUMMY; never place on citizen portal; invent no statute.

## Delivered

| Layer | Change |
|---|---|
| Generator lib | `scripts/catalogue/lib/pack-factory.mjs` + `licence-permit-pin-demos.mjs` |
| Pack regen | Pin-demo overlays on workflow.yaml / owner-config / README for demo targets |
| Fixture | `fixtures/lab/platform/licence-permit-pin-demos.json` |
| m10 helpers | `packages/m10-sample-lab/src/licence-permit-pin-demos.ts` |
| Inspection / schedule | Real catalogue ids `IND-BTP-001` / `IND-LAB-019` |
| Lab host | `GET /v1/lab/licence-permit-pin-demos[/:catalogueId]` (LOCAL/CI only) |

## Executed checks

| Check | Result |
|---|---|
| Pack generator | **212 generated** · **3 pin demos** · **0 citizen-offerable Licence/Permit** |
| Unit (m10 + api + service-templates catalogue) | **453 passed** (`junit/unit.xml`, `logs/vitest-unit.log`) |
| `@serviceform/api` typecheck | **pass** |
| `@serviceform/m10-sample-lab` typecheck | **pass** |

## Explicit non-claims

- CERTIFIED=false
- G6=false
- Licence/Permit **not** on `placement.citizen.json`
- No DigiLocker / SMS / Payment REAL
- No invented statute / Act / fee / eligibility as real policy
- Agents do not self-certify

## Recommended gate

Design/Develop complete for maintainability + lab pin demos. **Not** VERIFIED/CERTIFIED for citizen offer.
