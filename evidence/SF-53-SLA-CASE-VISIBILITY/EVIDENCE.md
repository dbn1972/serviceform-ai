# SF-53 SAMPLE_LAB SLA case visibility — evidence

**Stamp:** CERTIFIED=false · G6=false · self_certified=false  
**Requirement:** Officer/admin case detail SLA clock state, pause reason (DEFICIENCY_OPEN), breach/escalation indicators (CMP-029)  
**Branch:** `cursor/sla-case-visibility-aa61`  
**Base:** `main` @ `801b1e9f` (includes #246–#249, #247, #248)

## Executed checks

| Check | Result |
|---|---|
| `vitest` api + officer SLA helpers | PASS 7/7 |
| `pnpm --filter @serviceform/api typecheck` | PASS |
| `pnpm --filter @serviceform/web-officer typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab typecheck` | PASS |

Logs: `vitest-unit.log`, `junit/unit.xml`, `typecheck-*.log`.

## Architecture notes

- Host composition mounts CMP-029 when `DATABASE_URL_CMP029` is set; seeds calendar/policy from SAMPLE_LAB Odisha overlay (10 working days).
- Portal start event `APPLICATION_SUBMITTED` maps to FROZEN CMP-029 enum carrier `PUBLISHED_POLICY_ANCHOR` (no CCR; no invented statute).
- INT-009 deficiency pause/resume via `LabSlaClockPort` (SYSTEM workload) when CMP-029 mounted; otherwise UnboundSlaClockPort.
- Officer case detail shows clock status, pause reason, breach/escalation from server evaluate + read.
- Avoided overlap with open evidence-upload #251 (no CMP-013 / citizen upload path edits).

## Recommended gate

Builder evidence only. **Do not** mark CERTIFIED or G6. Human/CI may merge when CI green.
