# SF-55 Journey notifications (SIM) — evidence

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false`  
**Scope:** SAMPLE_LAB deficiency opened/closed, decision approve/reject, credential issued via CMP-025 SIM SMS (+ CMP-026 official notice). REAL SMS owner-held.

## Executed checks

| Check | Result |
|---|---|
| `pnpm exec vitest run apps/api/test/notification-lab.test.ts` | PASS (9) |
| `pnpm exec vitest run apps/api/test/deficiency-lab.test.ts apps/api/test/sla-lab.test.ts apps/api/test/composition-m06.test.ts` | PASS (18) |
| `pnpm --filter @serviceform/api run typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab run typecheck` | PASS |

Artifacts: `vitest-unit.log`, `typecheck-api.log`, `typecheck-m10.log`, `junit/unit.xml`.

## Honest limits

- SIMULATED SMS sink only; REAL/SANDBOX hub connectors not wired.
- DEFICIENCY_RESPONDED has no citizen SMS in this P1 slice (opened/closed only).
- CMP-026 official notice is fail-soft beside CMP-025.
- Agents do not self-certify. CERTIFIED=false. G6=false.
