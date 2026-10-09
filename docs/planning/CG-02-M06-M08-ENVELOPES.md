# CG-02 M06 / M08 envelope summary (PLANNING only — not READY, not dispatched)

`planning_only: true`. `implementation_authorized: false`. `state: PLANNING`.  
`base_commit` prefix `88690846` + suffix `021a2ce082b8a7c7f35c12603effd5d9`.  
Not CERTIFIED. Not RELEASE CERTIFIED. Not G6. Builders OFF. M07+ OFF.

Machine-readable copies: `orchestrator/handovers/SF-M06-*.yaml`, `orchestrator/handovers/SF-M08-*.yaml`, plus `CG-02-PLAN.yaml`, `M06-PLAN.yaml`, `M08-PLAN.yaml`.  
Plan: `docs/planning/CG-02-M06-M08-PLAN.md`. Contracts: `docs/planning/CG-02-M06-M08-CONTRACT-PREREQUISITES.md`.  
Do **not** create `orchestrator/tasks/**` in this planning slice.

## Normative topology (wording)

PLANNING (this PR) → LOCK-1 planning merge (later human) → SF-M06-CG-001 ∥ SF-M08-CG-001 freeze (**later separate human auth**) → Wave A per module → STITCH-A → Wave B → STITCH-B → HOST serial across CG-02 → INT ∥ SEC → EVD recommend G3 → human G3 later.

## Wave A eligible later (not now)

**M06:** SF-M06-001, SF-M06-002, SF-M06-003 (after CG-001 freeze + dispatch).  
**M08:** SF-M08-001, SF-M08-002, SF-M08-003, SF-M08-004, SF-M08-005 (after CG-001 freeze + dispatch).

## Sequencing (not Wave A)

- SF-M06-004 (CMP-021 Payment) after SF-M06-STITCH-A (Fee on main).
- SF-M08-006 (CMP-006 Discovery) after SF-M08-STITCH-A (Search on main).
- **Hard serial:** SF-M06-005 never concurrent with SF-M08-007 (`apps/api/src/app.ts` single-writer; `must_not_run_concurrent_with`).

## M06 path uniqueness (proved at planning; READY not granted)

| Envelope | `allowed_write_paths` (product, later) | Concurrent with | State |
|---|---|---|---|
| SF-M06-001 | `services/cmp-020-fee-calculation/**`, `db/migrations/*_cmp-020-*.sql` | 002, 003 | PLANNING |
| SF-M06-002 | `services/cmp-025-notification/**`, `db/migrations/*_cmp-025-*.sql` | 001, 003 | PLANNING |
| SF-M06-003 | `services/cmp-026-communication-messaging/**`, `db/migrations/*_cmp-026-*.sql` | 001, 002 | PLANNING |
| SF-M06-004 | `services/cmp-021-payment/**`, `db/migrations/*_cmp-021-*.sql` | (solo Wave B) | PLANNING |
| SF-M06-005 | `apps/api/src/composition/m06.ts`, serialized `app.ts` | **never** SF-M08-007 | PLANNING |

## M08 path uniqueness (proved at planning; READY not granted)

| Envelope | `allowed_write_paths` (product, later) | Concurrent with | State |
|---|---|---|---|
| SF-M08-001 | `services/cmp-035-search-indexing/**`, `db/migrations/*_cmp-035-*.sql` | 002–005 | PLANNING |
| SF-M08-002 | `services/cmp-007-recommendation/**`, `db/migrations/*_cmp-007-*.sql` | 001, 003–005 | PLANNING |
| SF-M08-003 | `services/cmp-045-analytics-mis/**`, `db/migrations/*_cmp-045-*.sql` | 001–002, 004–005 | PLANNING |
| SF-M08-004 | `services/cmp-046-operational-dashboard/**`, `db/migrations/*_cmp-046-*.sql` | 001–003, 005 | PLANNING |
| SF-M08-005 | `services/cmp-049-data-retention/**`, `db/migrations/*_cmp-049-*.sql` | 001–004 | PLANNING |
| SF-M08-006 | `services/cmp-006-service-discovery/**`, `db/migrations/*_cmp-006-*.sql` | (solo Wave B) | PLANNING |
| SF-M08-007 | `apps/api/src/composition/m08.ts`, serialized `app.ts` | **never** SF-M06-005 | PLANNING |

`pnpm-lock.yaml`, existing frozen `contracts/**`, and `orchestrator/contracts-lock.yaml` are **not** in builder `allowed_write_paths`. Single-writers: host envelopes and stitch lockfile owners.

## Envelope index

| ID | CMP / purpose | Wave / lock | This package |
|---|---|---|---|
| SF-M06-CG-001 | NEW M06 contract freeze (later) | LOCK-2 | PLANNING; freeze OFF |
| SF-M06-001 | CMP-020 Fee | A / LOCK-3 | PLANNING |
| SF-M06-002 | CMP-025 Notification | A / LOCK-3 | PLANNING |
| SF-M06-003 | CMP-026 Messaging | A / LOCK-3 | PLANNING |
| SF-M06-STITCH-A | Wave A mechanical stitch | LOCK-4 | PLANNING |
| SF-M06-004 | CMP-021 Payment | B / LOCK-5 | PLANNING |
| SF-M06-STITCH-B | Wave B mechanical stitch | LOCK-6 | PLANNING |
| SF-M06-005 | API host M06 mounts | LOCK-7 serial vs M08 | PLANNING |
| SF-M06-INT | INT-007 + INT-011/013 | LOCK-8 | PLANNING |
| SF-M06-SEC | independent security | LOCK-8 | PLANNING |
| SF-M06-EVD | recommend G3 only | LOCK-9 | PLANNING |
| SF-M08-CG-001 | NEW M08 contract freeze (later) | LOCK-2 | PLANNING; freeze OFF |
| SF-M08-001 | CMP-035 Search | A / LOCK-3 | PLANNING |
| SF-M08-002 | CMP-007 Recommendation | A / LOCK-3 | PLANNING |
| SF-M08-003 | CMP-045 Analytics | A / LOCK-3 | PLANNING |
| SF-M08-004 | CMP-046 Ops dashboard | A / LOCK-3 | PLANNING |
| SF-M08-005 | CMP-049 Retention | A / LOCK-3 | PLANNING |
| SF-M08-STITCH-A | Wave A mechanical stitch | LOCK-4 | PLANNING |
| SF-M08-006 | CMP-006 Discovery | B / LOCK-5 | PLANNING |
| SF-M08-STITCH-B | Wave B mechanical stitch | LOCK-6 | PLANNING |
| SF-M08-007 | API host M08 mounts | LOCK-7 serial vs M06 | PLANNING |
| SF-M08-INT | INT-003/010 + INT-011/013 | LOCK-8 | PLANNING |
| SF-M08-SEC | independent security | LOCK-8 | PLANNING |
| SF-M08-EVD | recommend G3 only | LOCK-9 | PLANNING |

Every implementation envelope above has `builders_dispatched_this_envelope: false`, `self_certified: false`, `certified: false`, `release_certified: false`, `g6: false`.
