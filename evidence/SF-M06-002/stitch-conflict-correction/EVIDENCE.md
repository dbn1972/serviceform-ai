# SF-M06-002 stitch-conflict correction — tip-count migrateDown

Status: BUILDER CORRECTION CANDIDATE. Not VERIFIED / CERTIFIED / G3 / G6. Builder cannot self-certify.

| Field | Value |
|---|---|
| Prior frozen head | `fb948840f15280b33c1bb981a28119b1d3d95de6` |
| Authorization | `HUMAN_SF_M06_002_STITCH_CONFLICT_CORRECTION_AUTHORIZATION` |
| Conflict | `M06_STITCH_A_SEMANTIC_CONFLICT` — privilege-rls tip-count `migrateDown(2)` tore CMP-020 tip after stitch |
| Fix | Named CMP-025 migrations + `withIsolatedCmp025Database` (no combined-catalog tip down) |
| Scope | `services/cmp-025-notification/test/integration/**` + this evidence + handover |
| Lockfile | untouched |

## Local results

| Check | Result |
|---|---|
| typecheck | PASS |
| eslint --max-warnings=0 | PASS |
| prettier --check | PASS |
| unit+contract | 163/163 PASS |
| PostgreSQL integration | 13/13 PASS |
| Combined proof (CMP-020 tip present, not editing CMP-020) | PASS — fee schema + cmp-020 migration rows unchanged after isolated CMP-025 reversibility |

## Non-claims

No STITCH-A re-run. No merge. No pnpm-lock.yaml. No CMP-020/CMP-026 edits. Not CERTIFIED.
