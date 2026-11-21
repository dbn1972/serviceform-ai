# SF-52 SAMPLE_LAB grievance / helpdesk — evidence

**Stamp:** CERTIFIED=false · G6=false · self_certified=false  
**Requirement:** Citizen raise/track + officer helpdesk (CMP-027) · ONDC IGM–inspired categories  
**Branch:** `cursor/grievance-helpdesk-dd41`  
**Commit:** `b1aad49a5ad61a27cb1a44112b40833320088d1b`

## Executed checks

| Check | Result |
|---|---|
| `pnpm --filter @serviceform/cmp-027-grievance-feedback test:unit` | PASS 33/33 |
| `vitest` api/citizen/officer grievance helpers | PASS 7/7 |
| `pnpm --filter @serviceform/api typecheck` | PASS |
| `pnpm --filter @serviceform/web-citizen typecheck` | PASS |
| `pnpm --filter @serviceform/web-officer typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab typecheck` | PASS |

Logs: `vitest-cmp027.log`, `vitest-portals.log`, `junit/unit.xml`.

## Architecture notes

- No bespoke named-service backend; CMP-027 metadata routing + SAMPLE_LAB catalogue.
- Additive `ESCALATE` command; list via lab host routes (frozen OpenAPI unchanged).
- OPA fail-closed; citizen owner path; officer role path on `GrievanceFeedback`.
- AI cannot RESOLVE/CLOSE/ESCALATE statutory grievance.

## Recommended gate

Builder evidence only. **Do not** mark CERTIFIED or G6. Human/CI may merge when CI green.
