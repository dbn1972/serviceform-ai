# CG-03 M09 / M10 envelope summary (PLANNING; freeze/builders OFF)

Machine-readable copies: `orchestrator/handovers/SF-M09-*.yaml`, `SF-M10-*.yaml`, `CG-03-PLAN.yaml`, `M09-PLAN.yaml`, `M10-PLAN.yaml`.  
Plan: `docs/planning/CG-03-M09-M10-PLAN.md`. Contracts: `docs/planning/CG-03-M09-M10-CONTRACT-PREREQUISITES.md`.

## Normative topology

PLANNING → SF-M09-CG-001 freeze (**FROZEN_ON_MAIN**) → Wave A builders → STITCH-A → Wave B/cross-cutting → STITCH-B → HOST (serial M09 vs M10) → INT∥SEC → EVD recommend → human G4/G6 later.

## M09 path uniqueness (Wave A — product paths later)

| Envelope | CMP | `allowed_write_paths` (product) | Schema / role |
|---|---|---|---|
| SF-M09-001 | CMP-056 Scheduler | `services/cmp-056-scheduler/**`, `db/migrations/*_cmp-056-*.sql` | `sf_scheduler` / `sf_cmp056_rw` |
| SF-M09-002 | CMP-057 Assisted / Omnichannel | `services/cmp-057-assisted-service/**`, `db/migrations/*_cmp-057-*.sql` | `sf_assisted` / `sf_cmp057_rw` |
| SF-M09-003 | CMP-058 Semantic Registry | `services/cmp-058-semantic-registry/**`, `db/migrations/*_cmp-058-*.sql` | `sf_semantics` / `sf_cmp058_rw` |
| SF-M09-004 | CMP-059 Migration Workbench | `services/cmp-059-migration-workbench/**`, `db/migrations/*_cmp-059-*.sql` | `sf_migration` / `sf_cmp059_rw` |
| SF-M09-005 | CMP-060 Risk / Integrity | `services/cmp-060-risk-integrity/**`, `db/migrations/*_cmp-060-*.sql` | `sf_risk` / `sf_cmp060_rw` |
| SF-M09-006 | CMP-061 Privacy Rights Centre | `services/cmp-061-privacy-centre/**`, `db/migrations/*_cmp-061-*.sql` | `sf_privacy` / `sf_cmp061_rw` |

Builders also write only their own `evidence/SF-M09-00N/**` and handover. No `pnpm-lock.yaml`, frozen `contracts/**`, or `apps/**` for Wave A builders.

## M10 path uniqueness

| Envelope | Purpose | `allowed_write_paths` (product) |
|---|---|---|
| SF-M10-001 | Canonical IND-SOC-002 residence template + Studio package | `templates/residence-certificate/**`, `packages/service-packages/ind-soc-002/**` (if created), evidence |
| SF-M10-002 | Pilot tenant overlay + TSB publish fixtures | `fixtures/golden/ind-soc-002/**`, evidence — **no invented statute** |
| SF-M10-003 | Golden E2E + tenant-negative harness | `tests/e2e/golden/**`, `tests/integration/m10/**`, evidence |
| SF-M10-004 | G5 performance / soak harness | `tests/performance/m10/**`, evidence |
| SF-M10-005 | UX4G journey / a11y evidence | `tests/ux4g/m10/**`, evidence |
| SF-M10-HOST | API host mounts if any M10-only composition | `apps/api/src/composition/m10.ts`, serialized `app.ts` — **never** concurrent with SF-M09-HOST |

## Envelope index

| ID | Purpose | Wave / lock | This package |
|---|---|---|---|
| SF-M09-CG-001 | NEW M09 contract freeze | LOCK-2 | PLANNING (`freeze_authorized: false`) |
| SF-M09-001..006 | CMP-056..061 | A / LOCK-3 | PLANNING |
| SF-M09-STITCH-A | Wave A mechanical stitch | LOCK-4 | PLANNING |
| SF-M09-007 | Cross-cutting BPMN / sfpackage / migration / AI-gov packaging | B / LOCK-5 | PLANNING |
| SF-M09-STITCH-B | Wave B stitch | LOCK-6 | PLANNING |
| SF-M09-HOST | API host M09 mounts | LOCK-7 serial vs M10 | PLANNING |
| SF-M09-INT | INT-014..019 + INT-011/013 | LOCK-8 | PLANNING |
| SF-M09-SEC | independent security | LOCK-8 | PLANNING |
| SF-M09-EVD | recommend G4 only | LOCK-9 | PLANNING |
| SF-M10-CG-001 | NEW M10 schemas if any | LOCK-2 | PLANNING (may be no-op) |
| SF-M10-001..005 | Template / overlay / E2E / G5 / UX4G | A–B | PLANNING |
| SF-M10-STITCH-A/B | mechanical stitch | LOCK-4/6 | PLANNING |
| SF-M10-HOST | host if needed | LOCK-7 serial vs M09 | PLANNING |
| SF-M10-INT | Golden E2E + INT-011 | LOCK-8 | PLANNING |
| SF-M10-SEC | independent security | LOCK-8 | PLANNING |
| SF-M10-PERF | G5 performance | LOCK-8 | PLANNING |
| SF-M10-EVD | recommend G6 only | LOCK-9 | PLANNING |

## Hard serial

`SF-M09-HOST` **must_not_run_concurrent_with** `SF-M10-HOST` (shared `apps/api/src/app.ts` single-writer).
