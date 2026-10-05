# M05 envelope summary (PLANNING, not dispatched)

`planning_only: true`. `implementation_authorized: false`. `state: PLANNING`. `dispatched: false`.  
`builders_dispatched_this_envelope: false`. `self_certified: false`. `certified: false`. `release_certified: false`. `g6: false`.

Machine-readable copies: `orchestrator/handovers/SF-M05-*.yaml` and `orchestrator/tasks/` mirrors. Plan: `docs/planning/M05-PLAN.md`. Locks: `orchestrator/dispatch/M05-SERIAL-LOCKS.md`.

## Normative topology (wording)

PLANNING → SF-M05-CG-001 freeze → Wave A `001∥002∥003∥004` → STITCH-A → Wave B `005∥006∥007∥008` → STITCH-B → `009` → `INT∥SEC` → EVD recommend → human G4.

Wave A is **not** eligible now. CG-001 freeze is **not** authorized in this PR.

## Sequencing

- SF-M05-CG-001 after LOCK-1 (planning on `main`); **before** any Wave A builder. Identify/freeze **NEW** M05 contracts only. CCR+STOP if any of the existing 13 frozen shared contracts must change.
- SF-M05-001 … 004 after CG-001 freeze on `main` (LOCK-3). Parallel; **non-overlapping writes** (table below).
- SF-M05-STITCH-A after 001–004 immutable heads (Wave A service/migration paths + `pnpm-lock.yaml`; mechanical/format/lockfile only).
- SF-M05-005 … 008 after STITCH-A on `origin/main` (LOCK-5). Parallel; non-overlapping writes.
- SF-M05-STITCH-B after 005–008 immutable heads (Wave B service/migration paths + `pnpm-lock.yaml`; mechanical only).
- **Hard serial host:** SF-M05-009 after STITCH-B; single writer `apps/api/src/app.ts`; additive `composition/m05.ts`; preserve M01–M04 mounts.
- SF-M05-INT ∥ SF-M05-SEC after 009; SF-M05-EVD after both. EVD recommends G4 only; cannot issue G4.

Builders/host/INT/SEC/EVD must not write `pnpm-lock.yaml`, existing `contracts/shared/**`, or `orchestrator/contracts-lock.yaml`. STITCH-A and STITCH-B must not run concurrent (`must_not_run_concurrent_with`). Uniqueness gate for CG-01 is unchanged and still requires M02/M03 envelopes `READY` / `dispatched: false`.

## Wave A path uniqueness (proved)

Concurrent Wave A writers share **no** write prefix. CMP tokens in migration globs are disjoint. Evidence and handover files are per-task-id.

| Envelope | `allowed_write_paths` (product) | Concurrent with |
|---|---|---|
| SF-M05-001 | `services/cmp-015-application-case/**`, `db/migrations/*_cmp-015-*.sql` | 002, 003, 004 |
| SF-M05-002 | `services/cmp-016-workflow-engine/**`, `db/migrations/*_cmp-016-*.sql` | 001, 003, 004 |
| SF-M05-003 | `services/cmp-017-work-queue-tasks/**`, `db/migrations/*_cmp-017-*.sql` | 001, 002, 004 |
| SF-M05-004 | `services/cmp-029-sla-escalation/**`, `db/migrations/*_cmp-029-*.sql` | 001, 002, 003 |

Overlap check: `cmp-015` ∩ `cmp-016` ∩ `cmp-017` ∩ `cmp-029` = empty. No shared `apps/**`, `contracts/**`, or `pnpm-lock.yaml`.

## Wave B path uniqueness (proved)

| Envelope | `allowed_write_paths` (product) | Concurrent with |
|---|---|---|
| SF-M05-005 | `services/cmp-018-inspection-verification/**`, `db/migrations/*_cmp-018-*.sql` | 006, 007, 008 |
| SF-M05-006 | `services/cmp-019-deficiency/**`, `db/migrations/*_cmp-019-*.sql` | 005, 007, 008 |
| SF-M05-007 | `services/cmp-027-grievance-feedback/**`, `db/migrations/*_cmp-027-*.sql` | 005, 006, 008 |
| SF-M05-008 | `services/cmp-028-appeal-review/**`, `db/migrations/*_cmp-028-*.sql` | 005, 006, 007 |

STITCH-A may rewrite Wave A trees only **after** 001–004 are immutable (not concurrent). STITCH-B may rewrite Wave B trees only **after** 005–008 are immutable (not concurrent with STITCH-A).

## Envelopes

| ID | CMP / purpose | Writes | Wave / lock |
|---|---|---|---|
| SF-M05-CG-001 | NEW M05 contract identify/freeze (later) | `contracts/m05/**` (later freeze only), evidence/handover | LOCK-2 |
| SF-M05-001 | CMP-015 Case | `services/cmp-015-application-case/**`, `db/migrations/*_cmp-015-*.sql` | A / LOCK-3 |
| SF-M05-002 | CMP-016 Workflow | `services/cmp-016-workflow-engine/**`, `db/migrations/*_cmp-016-*.sql` | A / LOCK-3 |
| SF-M05-003 | CMP-017 Human Task | `services/cmp-017-work-queue-tasks/**`, `db/migrations/*_cmp-017-*.sql` | A / LOCK-3 |
| SF-M05-004 | CMP-029 SLA | `services/cmp-029-sla-escalation/**`, `db/migrations/*_cmp-029-*.sql` | A / LOCK-3 |
| SF-M05-STITCH-A | Wave A mechanical stitch | Wave A service/migration paths + `pnpm-lock.yaml` | LOCK-4 |
| SF-M05-005 | CMP-018 Inspection | `services/cmp-018-inspection-verification/**`, `db/migrations/*_cmp-018-*.sql` | B / LOCK-5 |
| SF-M05-006 | CMP-019 Deficiency | `services/cmp-019-deficiency/**`, `db/migrations/*_cmp-019-*.sql` | B / LOCK-5 |
| SF-M05-007 | CMP-027 Grievance | `services/cmp-027-grievance-feedback/**`, `db/migrations/*_cmp-027-*.sql` | B / LOCK-5 |
| SF-M05-008 | CMP-028 Appeal | `services/cmp-028-appeal-review/**`, `db/migrations/*_cmp-028-*.sql` | B / LOCK-5 |
| SF-M05-STITCH-B | Wave B mechanical stitch | Wave B service/migration paths + `pnpm-lock.yaml` | LOCK-6 |
| SF-M05-009 | API host M05 mounts | `apps/api/src/composition/m05.ts`, serialized `app.ts` | LOCK-7 |
| SF-M05-INT | INT-004/005/006/009 + INT-011/013 | `tests/integration/m05/**`, `evidence/SF-M05-INT/**` | LOCK-8 |
| SF-M05-SEC | tenant/OPA/RLS/case isolation | `tests/security/m05/**`, `evidence/SF-M05-SEC/**` | LOCK-8 |
| SF-M05-EVD | recommend G4 only | `evidence/SF-M05-EVD/**`, `docs/verification/M05-G4-RECOMMENDATION.md` | LOCK-9 |
