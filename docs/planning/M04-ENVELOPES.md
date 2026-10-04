# M04 envelope summary (READY, not dispatched)

`planning_only: false`. `implementation_authorized: true`. `state: READY`. `dispatched: false`.  
`base_commit` prefix `df6a4af1` + suffix `fc7c300616b59a34cf363db80be642e4`. Not CERTIFIED. Builders OFF. M05 OFF.

Machine-readable copies: `orchestrator/handovers/SF-M04-*.yaml` and `orchestrator/tasks/` mirrors. Plan: `docs/planning/M04-PLAN.md`. Locks: `orchestrator/dispatch/M04-SERIAL-LOCKS.md`.

## Wave A eligible now (dispatch still HOLD)

SF-M04-001, SF-M04-002, SF-M04-003, SF-M04-004 (`wave_eligible_now: true`). Do **not** spawn until LOCK-1 (planning merged + gates green) and an orchestrator dispatch record.

## Sequencing (not Wave A now)

- SF-M04-STITCH-A after 001–004 immutable heads (lockfile-only).
- SF-M04-005 after STITCH-A on `main` **and** CMP-008 + CMP-011.
- SF-M04-006 after STITCH-A on `main` **and** CMP-039 + CMP-013.
- SF-M04-STITCH-B after 005 + 006 immutable heads (lockfile-only).
- **Hard serial host:** SF-M04-007 after STITCH-B; single writer `apps/api/src/app.ts`.
- SF-M04-INT ∥ SF-M04-SEC after 007; SF-M04-EVD after both.

## Envelopes

| ID | CMP / purpose | Writes | Wave / lock |
|---|---|---|---|
| SF-M04-001 | CMP-008 Rules | `services/cmp-008-rules/**`, `db/migrations/*_cmp-008-*.sql` | A / LOCK-2 |
| SF-M04-002 | CMP-011 Evidence | `services/cmp-011-evidence/**`, `db/migrations/*_cmp-011-*.sql` | A / LOCK-2 |
| SF-M04-003 | CMP-013 Upload | `services/cmp-013-document-upload/**`, `db/migrations/*_cmp-013-*.sql` | A / LOCK-2 |
| SF-M04-004 | CMP-039 AI Gateway | `services/cmp-039-ai-gateway/**`, `db/migrations/*_cmp-039-*.sql` | A / LOCK-2 |
| SF-M04-STITCH-A | Wave A lockfile | `pnpm-lock.yaml` only (plus stitch evidence/handover) | LOCK-3 |
| SF-M04-005 | CMP-009 Forms | `services/cmp-009-forms/**`, `db/migrations/*_cmp-009-*.sql` | B / LOCK-5 |
| SF-M04-006 | CMP-014 OCR | `services/cmp-014-document-intelligence/**`, `db/migrations/*_cmp-014-*.sql` | B / LOCK-6 |
| SF-M04-STITCH-B | Wave B lockfile | `pnpm-lock.yaml` only (plus stitch evidence/handover) | LOCK-7 |
| SF-M04-007 | API host M04 mounts | composition `m04` + serialized `app.ts` | LOCK-7 |
| SF-M04-INT | INT-011 / INT-013 re-verify | `tests/integration/m04/**`, `evidence/SF-M04-INT/**` | LOCK-7 |
| SF-M04-SEC | tenant/AI isolation | `tests/security/m04/**`, `evidence/SF-M04-SEC/**` | LOCK-7 |
| SF-M04-EVD | recommend G3 only | `evidence/SF-M04-EVD/**`, `docs/verification/M04-G3-RECOMMENDATION.md` | LOCK-7 |

Builders must not write `pnpm-lock.yaml`, `contracts/**`, or `orchestrator/contracts-lock.yaml`. STITCH-A and STITCH-B must not run concurrent (`must_not_run_concurrent_with`). Uniqueness gate for CG-01 is unchanged and still requires M02/M03 envelopes `READY` / `dispatched: false`.
