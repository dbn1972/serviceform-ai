# CG-01 M02 / M03 envelope summary (PLANNING ONLY)

Not READY. `planning_only: true`. `implementation_authorized: false`. `base_commit` = `cc49843eb70246842f5ea3c1c16257a5450432a2`. Not CERTIFIED.

Machine-readable copies: `orchestrator/handovers/SF-M02-*.yaml`, `orchestrator/handovers/SF-M03-*.yaml`. Plan: `docs/planning/CG-01-M02-M03-PLAN.md`.

## M02

| ID | CMP / purpose | Writes | Agent | Route |
|---|---|---|---|---|
| SF-M02-001 | CMP-004 Identity & Access | `services/cmp-004-identity-access/**`, `db/migrations/*_cmp-004-*.sql` | foundation | opus high |
| SF-M02-002 | CMP-005 Citizen Profile | `services/cmp-005-citizen-profile/**`, `db/migrations/*_cmp-005-*.sql` | foundation | opus high |
| SF-M02-003 | API host M02 mounts | `apps/api` composition `m02` + serialized `app.ts` | foundation | opus high |
| SF-M02-INT | INT-001 stitch | `tests/integration/m02/**` | stitcher | opus high |
| SF-M02-SEC | isolation/PII | `tests/security/m02/**` | security | opus xhigh |
| SF-M02-EVD | evidence | `docs/verification/M02-*`, `evidence/**` bind | evidence | opus high |

INT: INT-001 (own), INT-011/013 (re-verify). Exit later: G3.

## M03

| ID | CMP / purpose | Writes | Agent | Route |
|---|---|---|---|---|
| SF-M03-001 | CMP-001 Catalogue | `services/cmp-001-catalogue/**` | studio | sonnet high |
| SF-M03-002 | CMP-033 Metadata | `services/cmp-033-metadata/**` | studio | sonnet high |
| SF-M03-003 | CMP-034 Master data | `services/cmp-034-master-data/**` | studio | sonnet high |
| SF-M03-004 | CMP-051 + CMP-052 publish/version | `services/cmp-051-maker-checker/**`, `services/cmp-052-versioning/**` | studio | opus high |
| SF-M03-005 | CMP-053 Localization | `services/cmp-053-localization/**` | studio | sonnet medium |
| SF-M03-006 | CMP-054 UX4G | `packages/ui-ux4g/**`, `apps/mobile/lib/ux4g/**` | ux4g | sonnet high |
| SF-M03-007 | CMP-050 Studio/admin | `apps/web-studio/**`, `apps/web-admin/**`, `services/cmp-050-studio-portal/**` | studio | sonnet high |
| SF-M03-008 | API host M03 mounts | `apps/api` composition `m03` + serialized `app.ts` | foundation | opus high |
| SF-M03-INT | INT-002 stitch | `tests/integration/m03/**` | stitcher | opus high |
| SF-M03-SEC | publish/admin isolation | `tests/security/m03/**` | security | opus xhigh |
| SF-M03-EVD | evidence | `docs/verification/M03-*` | evidence | opus high |

INT: INT-002 (own), INT-011/013 (re-verify). Exit later: G3.

## CG-01 serialization

- SF-M02-003 ∥ SF-M03-008 is **forbidden** (shared `apps/api/src/app.ts`).
- SF-M03-007 after 002, 004, 006.
- SF-M03-004 after 002 preferred.
- `pnpm-lock.yaml` orchestrator-only.
- Frozen 13 contracts unchanged.
