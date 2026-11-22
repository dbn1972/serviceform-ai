# BPMN / .sfpackage SAMPLE_LAB interop hygiene lab demo

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · DigiLocker/SMS/Payment **unchanged / not touched**  
**Gap item:** platform-capability-gap-analysis.md rank 8 (P3) — BPMN / `.sfpackage` / in-flight migration lab demo  
**Module:** M09 interop hygiene · CMP-016 BPMN profile · SF-CON-SFPACKAGE-MANIFEST · Constitution #33–#35  
**Branch:** `cursor/bpmn-sfpackage-lab-demo-1398`

## What landed (lab)

- SAMPLE_LAB interop hygiene catalogue (`packages/m10-sample-lab` + `fixtures/lab/platform/interop-hygiene-catalogue.json`)
- Platform lab routes under `/v1/lab/interop/*` (catalogue, prove, BPMN screen, `.sfpackage` validate, migration simulate)
- Studio thin desk at `/interop` with Prove BFF (`/api/lab/interop/prove`)
- Hygiene proves: Temporal-only BPMN profile, Camunda construct refused, `.sfpackage` no embedded secrets, migration dry-run only (silent repoint refused)

## Executed checks

| Check | Result |
|---|---|
| `@serviceform/m10-sample-lab` typecheck | PASS (see typecheck-m10.log) |
| `@serviceform/api` typecheck | PASS (see typecheck-api.log) |
| `@serviceform/web-studio` typecheck | PASS (see typecheck-studio.log) |
| eslint (changed files) | PASS (see lint.log) |
| Unit vitest (catalogue + API routes + Studio markup) | **15/15 PASS** |

## Honest limits

- Lab demo / hygiene prove only — not a second BPMN runtime (no Camunda/Zeebe).
- `.sfpackage` promotion is catalogue validation + content-address / signature-ref hygiene; not production signing cutover.
- In-flight migration is **dry-run only** (`applied=false`); never silently repoints active cases.
- FROZEN contracts untouched. No DigiLocker/SMS/Payment changes. No invented statute.
- Agents do not self-certify. **CERTIFIED=false. G6=false.**
