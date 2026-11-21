# SF-54 SAMPLE_LAB assisted-service apply shell — evidence

**Stamp:** CERTIFIED=false · G6=false · self_certified=false  
**Requirement:** Operator `applied_by` + citizen `applied_for` + representation basis + fail-closed consent; never impersonate (Constitution #36 / CSC channel)  
**Branch:** `cursor/sf-54-assisted-service-apply-4e8f`  
**Base tip:** `c5707e38` (includes SF-53 SLA #253)

## Executed checks

| Check | Result |
|---|---|
| `pnpm --filter @serviceform/cmp-057-assisted-service test:unit` | PASS 30/30 |
| `vitest` api + officer assisted helpers | PASS 9/9 |
| `pnpm --filter @serviceform/api typecheck` | PASS |
| `pnpm --filter @serviceform/web-officer typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab typecheck` | PASS |

Logs: `vitest-cmp057.log`, `vitest-portals.log`, `junit/unit.xml`, `typecheck-*.log`.

## Architecture notes

- CMP-057 mounted in SAMPLE_LAB when `DATABASE_URL_CMP057` is set (M09 + lab consent/apply routes).
- `applied_by` is always the authenticated officer (server-owned); client cannot supply it.
- Consent fail-closed: lab ledger + `read_back_acknowledged === true` required before VERIFY_REPRESENTATION.
- Assisted apply creates the draft under `applied_for` via server-mediated filing; officer cookie is never swapped (no impersonation).
- OPA actions/resource type `AssistedSession` + SAMPLE_LAB_CASE_OFFICER grants.
- Opaque representation refs only; no invented statute.

## Recommended gate

Builder evidence only. **Do not** mark CERTIFIED or G6. Human/CI may merge when CI green.
