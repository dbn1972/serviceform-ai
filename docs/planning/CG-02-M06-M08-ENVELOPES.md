# CG-02 M06 / M08 envelope summary (Wave A READY for seven lanes — builders OFF)

Wave A READY promotion under `HUMAN_CG_02_READY_PROMOTION_AUTHORIZATION`.  
`base_commit` prefix `5acb291e` + suffix `a828894c40110396f0eafd62462e4572`.  
Freeze: SF-M06-CG-001 ∥ SF-M08-CG-001 **FROZEN_ON_MAIN** / `repository_freeze_effective: true`.  
Contracts-lock **29/29 MATCH**; existing 19 unchanged. **Not CERTIFIED. Not G6. Builders OFF.** M07+ OFF.

Machine-readable copies: `orchestrator/handovers/SF-M06-*.yaml`, `orchestrator/handovers/SF-M08-*.yaml`, plus `CG-02-PLAN.yaml`, `M06-PLAN.yaml`, `M08-PLAN.yaml`.  
Task mirrors (seven READY only): `orchestrator/tasks/SF-M06-001.yaml` … `003.yaml`, `SF-M08-001.yaml` … `004.yaml`.  
Activation: `orchestrator/dispatch/CG-02-ACTIVATION.md`. Dispatch plan: `orchestrator/dispatch/DISPATCH-PLAN-CG02-WAVE-A.md`.

## Normative topology (wording)

PLANNING (#112) → LOCK-1 planning merge → SF-M06-CG-001 ∥ SF-M08-CG-001 freeze (#113 MERGED) → **Wave A READY (this PR; builders pending activation merge)** → STITCH-A → Wave B → STITCH-B → HOST serial across CG-02 → INT ∥ SEC → EVD recommend G3 → human G3 later.

## Wave A READY now (seven; builders not spawned)

**M06:** SF-M06-001, SF-M06-002, SF-M06-003 — `state: READY`, `planning_only: false`, `implementation_authorized: true`, `wave_eligible_now: true`, `dispatched: false`.  
**M08:** SF-M08-001, SF-M08-002, SF-M08-003, SF-M08-004 — same READY flags.

## Held / not promoted

- **SF-M08-005** (CMP-049 retention) — remains **PLANNING** (`STATUTORY_RETENTION_POLICY_INPUT_REQUIRED=true`; do not invent periods).
- SF-M06-004 Payment, SF-M08-006 Discovery, STITCH-A/B, host 005/007, INT/SEC/EVD — **OFF**.

## Sequencing (not Wave A)

- SF-M06-004 (CMP-021 Payment) after SF-M06-STITCH-A (Fee on main).
- SF-M08-006 (CMP-006 Discovery) after SF-M08-STITCH-A (Search on main).
- **Hard serial:** SF-M06-005 never concurrent with SF-M08-007 (`apps/api/src/app.ts` single-writer; `must_not_run_concurrent_with`).

## M06 path uniqueness (Wave A READY; spawn pending)

| Envelope | `allowed_write_paths` (product, later) | Concurrent with | State |
|---|---|---|---|
| SF-M06-001 | `services/cmp-020-fee-calculation/**`, `db/migrations/*_cmp-020-*.sql` | 002, 003 + M08 Wave A | READY |
| SF-M06-002 | `services/cmp-025-notification/**`, `db/migrations/*_cmp-025-*.sql` | 001, 003 + M08 Wave A | READY |
| SF-M06-003 | `services/cmp-026-communication-messaging/**`, `db/migrations/*_cmp-026-*.sql` | 001, 002 + M08 Wave A | READY |
| SF-M06-004 | `services/cmp-021-payment/**`, `db/migrations/*_cmp-021-*.sql` | (solo Wave B) | PLANNING / OFF |
| SF-M06-005 | `apps/api/src/composition/m06.ts`, serialized `app.ts` | **never** SF-M08-007 | PLANNING / OFF |

## M08 path uniqueness (Wave A READY partial; spawn pending)

| Envelope | `allowed_write_paths` (product, later) | Concurrent with | State |
|---|---|---|---|
| SF-M08-001 | `services/cmp-035-search-indexing/**`, `db/migrations/*_cmp-035-*.sql` | 002–004 + M06 Wave A | READY |
| SF-M08-002 | `services/cmp-007-recommendation/**`, `db/migrations/*_cmp-007-*.sql` | 001, 003–004 + M06 Wave A | READY |
| SF-M08-003 | `services/cmp-045-analytics-mis/**`, `db/migrations/*_cmp-045-*.sql` | 001–002, 004 + M06 Wave A | READY |
| SF-M08-004 | `services/cmp-046-operational-dashboard/**`, `db/migrations/*_cmp-046-*.sql` | 001–003 + M06 Wave A | READY |
| SF-M08-005 | `services/cmp-049-data-retention/**`, `db/migrations/*_cmp-049-*.sql` | (held) | **PLANNING** |
| SF-M08-006 | `services/cmp-006-service-discovery/**`, `db/migrations/*_cmp-006-*.sql` | (solo Wave B) | PLANNING / OFF |
| SF-M08-007 | `apps/api/src/composition/m08.ts`, serialized `app.ts` | **never** SF-M06-005 | PLANNING / OFF |

`pnpm-lock.yaml`, frozen `contracts/**`, and `orchestrator/contracts-lock.yaml` are **not** in Wave A builder `allowed_write_paths`. Single-writers: host envelopes and stitch lockfile owners.

## Envelope index

| ID | CMP / purpose | Wave / lock | This package |
|---|---|---|---|
| SF-M06-CG-001 | M06 contract freeze | LOCK-2 | **FROZEN_ON_MAIN** |
| SF-M06-001 | CMP-020 Fee | A / LOCK-3 | **READY** (not dispatched) |
| SF-M06-002 | CMP-025 Notification | A / LOCK-3 | **READY** (not dispatched) |
| SF-M06-003 | CMP-026 Messaging | A / LOCK-3 | **READY** (not dispatched) |
| SF-M06-STITCH-A | Wave A mechanical stitch | LOCK-4 | OFF |
| SF-M06-004 | CMP-021 Payment | B / LOCK-5 | OFF |
| SF-M06-STITCH-B | Wave B mechanical stitch | LOCK-6 | OFF |
| SF-M06-005 | API host M06 mounts | LOCK-7 serial vs M08 | OFF |
| SF-M06-INT | INT-007 + INT-011/013 | LOCK-8 | OFF |
| SF-M06-SEC | independent security | LOCK-8 | OFF |
| SF-M06-EVD | recommend G3 only | LOCK-9 | OFF |
| SF-M08-CG-001 | M08 contract freeze | LOCK-2 | **FROZEN_ON_MAIN** |
| SF-M08-001 | CMP-035 Search | A / LOCK-3 | **READY** (not dispatched) |
| SF-M08-002 | CMP-007 Recommendation | A / LOCK-3 | **READY** (not dispatched) |
| SF-M08-003 | CMP-045 Analytics | A / LOCK-3 | **READY** (not dispatched) |
| SF-M08-004 | CMP-046 Ops dashboard | A / LOCK-3 | **READY** (not dispatched) |
| SF-M08-005 | CMP-049 Retention | A / LOCK-3 | **PLANNING** (held) |
| SF-M08-STITCH-A | Wave A mechanical stitch | LOCK-4 | OFF |
| SF-M08-006 | CMP-006 Discovery | B / LOCK-5 | OFF |
| SF-M08-STITCH-B | Wave B mechanical stitch | LOCK-6 | OFF |
| SF-M08-007 | API host M08 mounts | LOCK-7 serial vs M06 | OFF |
| SF-M08-INT | INT-003/010 + INT-011/013 | LOCK-8 | OFF |
| SF-M08-SEC | independent security | LOCK-8 | OFF |
| SF-M08-EVD | recommend G3 only | LOCK-9 | OFF |

Seven READY envelopes have `builders_dispatched_this_envelope: false`, `self_certified: false`, `certified: false`, `release_certified: false`, `g6: false`. Status: `READY_PROMOTION_GRANTED` + `BUILDER_SPAWN_PENDING_ACTIVATION_RECORD_MERGE`.
