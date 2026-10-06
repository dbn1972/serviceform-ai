# SF-M05-STITCH-A evidence — Wave A mechanical stitch

**Not CERTIFIED. Not RELEASE CERTIFIED. Not G4. Not G6. self_certified false. Do not merge this PR as certification.**

PR #91 (`2135940f9d25b2ac3145a1ff74bb1992f4c7b91f`) was not reused. Builder PRs #87–#90 were not merged.

| Field | Value |
|---|---|
| Task | SF-M05-STITCH-A |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/95 |
| Branch | `cursor/m05-stitch-a-exec-df028c71-9a39` |
| AUTHORIZED EXECUTION BASE | `df028c71035d584601e1c6a860c75d7bb7d2bd22` |
| execution_authorized | true (HUMAN_EXECUTION_AUTHORIZATION) |
| Frozen contracts altered | none (19/19 MATCH; original 13 unchanged; six M05 hashes unchanged) |
| CCR_REQUIRED | false |

## Frozen inputs (copied, not merged)

| Task | CMP | PR | SHA |
|---|---|---:|---|
| SF-M05-001 | CMP-015 | 90 | `2d68e37c3e01d78129f1604b02fe98bae4048489` |
| SF-M05-002 | CMP-016 | 89 | `9249ecb7ec2c3e33c0aff139c1496cf7b80c7ce9` |
| SF-M05-003 | CMP-017 | 88 | `8641c756b539492e3f90d2b04c8a9eb1f2192175` |
| SF-M05-004 | CMP-029 | 87 | `5c4d8ac700364b8b01fa10a44f8a1b049b3da825` |

Trees MATCH BYTE_IDENTICAL. See `TREE-FIDELITY.md`.

## Local executed checks

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test:coverage` | PASS 1291 tests |
| `pnpm contracts:validate` | PASS |
| `contracts_lock_gate.py` | PASS 19/19 FROZEN |
| `pnpm test:cdc` | PASS 19 |
| `pnpm deps:graph` | PASS 1184 modules |
| `pnpm build` | PASS |
| `pytest scripts/gates/tests` | PASS 30 |
| `scripts/gates/run_all.py` | PASS 10/10 |
| `migration_lint.py` | PASS 53 files |
| `check_scope.py` SF-M05-STITCH-A | PASS 196 files |
| `pnpm audit --prod --audit-level high` | PASS |
| `pnpm db:test` | PASS 17 |
| CMP-015 unit/contract | 125/125 |
| CMP-015 PG | 27/27 |
| CMP-016 unit | 136/136 |
| CMP-016 PG | 21/21 |
| CMP-016 Temporal SDK | 12/12 |
| CMP-016 unhandled rejection | 0 |
| CMP-017 unit/contract | 74/74 |
| CMP-017 PG | 21/21 |
| CMP-029 unit/contract | 90/90 |
| CMP-029 PG | 16/16 |
| Combined catalogue Wave A pairs | present; combined UP succeeded |
| CROSS_TENANT_LEAKAGE | 0 |
| runtime SUPERUSER / BYPASSRLS / object-owner / cross-SQL | 0 / 0 / 0 / 0 (Wave A `_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS; owners `sf_migrator`; FORCE RLS on tenant-scoped tables; platform outbox/inbox exempt) |

Recommended next gate: wait for exact-candidate-head **ci**, **Security**, **Developer-platform** SUCCESS, then human/CI accept. Do not merge from this agent. Wave B OFF.
