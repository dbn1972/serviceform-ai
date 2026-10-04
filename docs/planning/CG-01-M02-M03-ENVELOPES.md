# CG-01 M02 / M03 envelope summary (READY, not dispatched)

`planning_only: false`. `implementation_authorized: true`. `state: READY`.  
`base_commit` prefix `8613d0ec` + suffix `844e189191a782753c30c65871756048`. Not CERTIFIED. Builders OFF.

Machine-readable copies: `orchestrator/handovers/SF-M02-*.yaml`, `orchestrator/handovers/SF-M03-*.yaml`, and `orchestrator/tasks/` mirrors. Plan: `docs/planning/CG-01-M02-M03-PLAN.md`. Promote: `docs/planning/CG-01-PROMOTE-READY.md`.

## Wave A eligible now

SF-M02-001, SF-M02-002, SF-M03-001, SF-M03-002, SF-M03-003, SF-M03-005, SF-M03-006.

## Sequencing (not Wave A now)

- SF-M03-004 after SF-M03-002 (metadata).
- SF-M03-007 after SF-M03-002 / SF-M03-004 / SF-M03-006.
- **Hard serial:** SF-M02-003 never concurrent with SF-M03-008 (`apps/api/src/app.ts` single-writer; `must_not_run_concurrent_with`).

## M02

| ID | CMP / purpose | Writes | Wave |
|---|---|---|---|
| SF-M02-001 | CMP-004 Identity & Access | `services/cmp-004-identity-access/**`, `db/migrations/*_cmp-004-*.sql` | A now |
| SF-M02-002 | CMP-005 Citizen Profile | `services/cmp-005-citizen-profile/**`, `db/migrations/*_cmp-005-*.sql` | A now |
| SF-M02-003 | API host M02 mounts | composition `m02` + serialized `app.ts` | HOST serial vs SF-M03-008 |
| SF-M02-INT / SEC / EVD | verifiers | module-scoped tests/evidence | after host |

## M03

| ID | CMP / purpose | Writes | Wave |
|---|---|---|---|
| SF-M03-001 | CMP-001 Catalogue | `services/cmp-001-catalogue/**` | A now |
| SF-M03-002 | CMP-033 Metadata | `services/cmp-033-metadata/**` | A now |
| SF-M03-003 | CMP-034 Master data | `services/cmp-034-master-data/**` | A now |
| SF-M03-004 | CMP-051 + CMP-052 | maker-checker + versioning | after 002 |
| SF-M03-005 | CMP-053 Localization | `services/cmp-053-localization/**` | A now |
| SF-M03-006 | CMP-054 UX4G | `packages/ui-ux4g/**`, `apps/mobile/lib/ux4g/**` | A now |
| SF-M03-007 | CMP-050 Studio/admin | studio + admin apps | after 002/004/006 |
| SF-M03-008 | API host M03 mounts | composition `m03` + serialized `app.ts` | HOST serial vs SF-M02-003 |
| SF-M03-INT / SEC / EVD | verifiers | module-scoped tests/evidence | after host |

`pnpm-lock.yaml`, `contracts/**`, and `orchestrator/contracts-lock.yaml` are not in builder `allowed_write_paths`.
