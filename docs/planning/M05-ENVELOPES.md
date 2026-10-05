# M05 envelope summary (Wave A READY; others PLANNING)

Wave A `SF-M05-001` … `SF-M05-004`: `planning_only: false`. `implementation_authorized: true`. `state: READY`. `wave_eligible_now: true`. `dispatched: false`.  
CG-001 handover: `state: FROZEN_ON_MAIN`. `repository_freeze_effective: true`. Original 13 **MATCH**. Lock **19/19 FROZEN**.  
STITCH-A, Wave B `005+`, `009`, INT, SEC, EVD remain **PLANNING** / not eligible / not dispatched.  
`builders_dispatched_this_envelope: false`. `self_certified: false`. `certified: false`. `release_certified: false`. `g4: false`. `g6: false`.

Machine-readable copies: `orchestrator/handovers/SF-M05-*.yaml` and `orchestrator/tasks/` mirrors. Plan: `docs/planning/M05-PLAN.md`. Locks: `orchestrator/dispatch/M05-SERIAL-LOCKS.md`. Dispatch: `orchestrator/dispatch/DISPATCH-PLAN-M05-WAVE-A.md`.

## Normative topology (wording)

PLANNING → SF-M05-CG-001 freeze (**SATISFIED** on `origin/main` prefix `ae6c21e1`) → Wave A `001∥002∥003∥004` (**READY GRANTED**; spawn pending activation merge) → STITCH-A (**OFF**) → Wave B `005∥006∥007∥008` (**OFF**) → STITCH-B → `009` → `INT∥SEC` → EVD recommend → human G4.

Wave A is **READY** only. STITCH-A / 005+ / INT / SEC / EVD are **not** promoted.

## Sequencing

- SF-M05-CG-001 freeze is on `origin/main` (**LOCK-2 SATISFIED**). Identify/freeze of **NEW** M05 contracts is complete. CCR+STOP if any of the existing 13 frozen shared contracts or the six M05 hashes must change.
- SF-M05-001 … 004 after CG-001 freeze on `main` (LOCK-3). Parallel; **non-overlapping writes** (table below). READY now; **not dispatched**.
- SF-M05-STITCH-A after 001–004 immutable heads (Wave A service/migration paths + `pnpm-lock.yaml`; mechanical/format/lockfile only). **Not READY.**
- SF-M05-005 … 008 after STITCH-A on `origin/main` (LOCK-5). Parallel; non-overlapping writes. **Not READY.**
- SF-M05-STITCH-B after 005–008 immutable heads (Wave B service/migration paths + `pnpm-lock.yaml`; mechanical only).
- **Hard serial host:** SF-M05-009 after STITCH-B; single writer `apps/api/src/app.ts`; additive `composition/m05.ts`; preserve M01–M04 mounts.
- SF-M05-INT ∥ SF-M05-SEC after 009; SF-M05-EVD after both. EVD recommends G4 only; cannot issue G4. SF-M05-SEC covers APPLICATION/CASE, WORKFLOW/TEMPORAL, TASKS, INT-006 inspection+evidence, INT-009 deficiency+SLA, GRIEVANCE, APPEAL, plus COMMON probes (FORCE RLS, SUPERUSER=0, BYPASSRLS=0, ownership=0, cross-component SQL=0, secret/PII=0, statutory AI=0, CROSS_TENANT_LEAKAGE=0).

Builders/host/INT/SEC/EVD must not write `pnpm-lock.yaml`, existing `contracts/shared/**`, or `orchestrator/contracts-lock.yaml`. STITCH-A and STITCH-B must not run concurrent (`must_not_run_concurrent_with`). Uniqueness gate for CG-01 is unchanged and still requires M02/M03 envelopes `READY` / `dispatched: false`.

## Wave A path uniqueness (proved)

Concurrent Wave A writers share **no** write prefix. CMP tokens in migration globs are disjoint. Evidence and handover files are per-task-id. Proof: `evidence/SF-M05-WAVE-A-ACTIVATION/**`.

| Envelope | `allowed_write_paths` (product) | Concurrent with | State |
|---|---|---|---|
| SF-M05-001 | `services/cmp-015-application-case/**`, `db/migrations/*_cmp-015-*.sql` | 002, 003, 004 | **READY** |
| SF-M05-002 | `services/cmp-016-workflow-engine/**`, `db/migrations/*_cmp-016-*.sql` | 001, 003, 004 | **READY** |
| SF-M05-003 | `services/cmp-017-work-queue-tasks/**`, `db/migrations/*_cmp-017-*.sql` | 001, 002, 004 | **READY** |
| SF-M05-004 | `services/cmp-029-sla-escalation/**`, `db/migrations/*_cmp-029-*.sql` | 001, 002, 003 | **READY** |

Overlap check: `cmp-015` ∩ `cmp-016` ∩ `cmp-017` ∩ `cmp-029` = empty. No shared `apps/**`, `contracts/**`, or `pnpm-lock.yaml`. Mandatory rules preserved: Temporal never authoritative case state; ADR-0003/0005; no named officer; BPMN import/export only; SLA no case mutation; no M06 providers.

## Wave B path uniqueness (proved; Wave B OFF)

| Envelope | `allowed_write_paths` (product) | Concurrent with | State |
|---|---|---|---|
| SF-M05-005 | `services/cmp-018-inspection-verification/**`, `db/migrations/*_cmp-018-*.sql` | 006, 007, 008 | PLANNING |
| SF-M05-006 | `services/cmp-019-deficiency/**`, `db/migrations/*_cmp-019-*.sql` | 005, 007, 008 | PLANNING |
| SF-M05-007 | `services/cmp-027-grievance-feedback/**`, `db/migrations/*_cmp-027-*.sql` | 005, 006, 008 | PLANNING |
| SF-M05-008 | `services/cmp-028-appeal-review/**`, `db/migrations/*_cmp-028-*.sql` | 005, 006, 007 | PLANNING |

STITCH-A may rewrite Wave A trees only **after** 001–004 are immutable (not concurrent). STITCH-B may rewrite Wave B trees only **after** 005–008 are immutable (not concurrent with STITCH-A).

## Envelopes

| ID | CMP / purpose | Writes | Wave / lock | This package |
|---|---|---|---|---|
| SF-M05-CG-001 | NEW M05 contract freeze (done on main) | Freeze already on main; handover reconciled `FROZEN_ON_MAIN`. `contracts/shared/**` READ-ONLY. | LOCK-2 SATISFIED | handover only |
| SF-M05-001 | CMP-015 Case | `services/cmp-015-application-case/**`, `db/migrations/*_cmp-015-*.sql` | A / LOCK-3 | **READY** |
| SF-M05-002 | CMP-016 Workflow | `services/cmp-016-workflow-engine/**`, `db/migrations/*_cmp-016-*.sql` | A / LOCK-3 | **READY** |
| SF-M05-003 | CMP-017 Human Task | `services/cmp-017-work-queue-tasks/**`, `db/migrations/*_cmp-017-*.sql` | A / LOCK-3 | **READY** |
| SF-M05-004 | CMP-029 SLA | `services/cmp-029-sla-escalation/**`, `db/migrations/*_cmp-029-*.sql` | A / LOCK-3 | **READY** |
| SF-M05-STITCH-A | Wave A mechanical stitch | Wave A service/migration paths + `pnpm-lock.yaml` | LOCK-4 | **OFF** |
| SF-M05-005 | CMP-018 Inspection | `services/cmp-018-inspection-verification/**`, `db/migrations/*_cmp-018-*.sql` | B / LOCK-5 | **OFF** |
| SF-M05-006 | CMP-019 Deficiency | `services/cmp-019-deficiency/**`, `db/migrations/*_cmp-019-*.sql` | B / LOCK-5 | **OFF** |
| SF-M05-007 | CMP-027 Grievance | `services/cmp-027-grievance-feedback/**`, `db/migrations/*_cmp-027-*.sql` | B / LOCK-5 | **OFF** |
| SF-M05-008 | CMP-028 Appeal | `services/cmp-028-appeal-review/**`, `db/migrations/*_cmp-028-*.sql` | B / LOCK-5 | **OFF** |
| SF-M05-STITCH-B | Wave B mechanical stitch | Wave B service/migration paths + `pnpm-lock.yaml` | LOCK-6 | **OFF** |
| SF-M05-009 | API host M05 mounts | `apps/api/src/composition/m05.ts`, serialized `app.ts` | LOCK-7 | **OFF** |
| SF-M05-INT | INT-004/005/006/009 + INT-011/013 | `tests/integration/m05/**`, `evidence/SF-M05-INT/**` | LOCK-8 | **OFF** |
| SF-M05-SEC | independent security verifier (INT-004/005/006/009 + INT-011/013) | `tests/security/m05/**`, `evidence/SF-M05-SEC/**` | LOCK-8 | **OFF** |
| SF-M05-EVD | recommend G4 only | `evidence/SF-M05-EVD/**`, `docs/verification/M05-G4-RECOMMENDATION.md` | LOCK-9 | **OFF** |
