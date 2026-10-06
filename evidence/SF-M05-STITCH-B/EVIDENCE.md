# SF-M05-STITCH-B evidence — Wave B mechanical stitch

**Not CERTIFIED. Not RELEASE CERTIFIED. Not G4. Not G6. self_certified false. Do not merge this PR as certification.**

Builder PRs #99/#97/#98/#100 were not merged and their frozen heads were not mutated.

| Field | Value |
|---|---|
| Task | SF-M05-STITCH-B |
| Draft PR | (filled after open) |
| Branch | `cursor/m05-stitch-b-exec-ca57057a-9e07` |
| AUTHORIZED EXECUTION BASE | `ca57057a794739c03d0a46886577e25adf041815` |
| execution_authorized | true (HUMAN_STITCH_B_EXECUTION_AUTHORIZATION) |
| Frozen contracts altered | none (19/19 MATCH) |
| CCR_REQUIRED | false |
| CMP-019 residual | GOVERNING_UNRESOLVED_UNWAIVED |
| CMP-028 residual | GOVERNING_UNRESOLVED_UNWAIVED |
| NO_MERGE_AUTHORIZATION | true |
| 009/INT/SEC/EVD | OFF |

## Frozen inputs (copied, not merged)

| Task | CMP | PR | SHA |
|---|---|---:|---|
| SF-M05-005 | CMP-018 | 99 | `1ca2dbccb2702d40b28f46cab7717bf3fc36d4d7` |
| SF-M05-006 | CMP-019 | 97 | `b36715f83c1c2aaa47c6d9b54c568959c131db50` |
| SF-M05-007 | CMP-027 | 98 | `f4208a1d446ccd5e7b707a9f5942481d24630278` |
| SF-M05-008 | CMP-028 | 100 | `1a6a1ee2e128b1c0eda8fe411d798287063eed5b` |

Trees MATCH BYTE_IDENTICAL. See `TREE-FIDELITY.md`.

## Local executed checks

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test:coverage` | PASS 1404 tests |
| `pnpm contracts:validate` | PASS |
| `contracts_lock_gate.py` | PASS 19/19 FROZEN |
| `pnpm test:cdc` | PASS 19 |
| `pnpm deps:graph` | PASS 1324 modules |
| `pnpm build` | PASS |
| `pytest scripts/gates/tests` | PASS 30 |
| `scripts/gates/run_all.py` | PASS 10/10 |
| `migration_lint.py` | PASS 61 files |
| `check_scope.py` SF-M05-STITCH-B | (run on commit) |
| `pnpm audit --prod --audit-level high` | PASS |
| `pnpm db:test` | PASS 17 |
| CMP-018 unit | 32/32 |
| CMP-018 PG | 11/11 |
| CMP-019 unit/contract | 18/18 |
| CMP-019 PG | 5/5 |
| CMP-027 unit | 32/32 |
| CMP-027 PG | 12/12 |
| CMP-028 unit | 31/31 |
| CMP-028 PG | 10/10 |
| Combined catalogue Wave B schemas | present; combined UP succeeded |
| FORCE RLS tenant-scoped Wave B tables | PASS (platform outbox/inbox exempt) |
| Wave B `_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS | PASS |
| CROSS_SCHEMA_GRANT Wave B siblings | 0 |
| CROSS_TENANT_LEAKAGE | 0 (component privilege-rls PASS) |

Recommended next gate: wait for exact-candidate-head **ci**, **Security**, **Developer-platform** SUCCESS, then **separate independent STITCH-B candidate review / merge-authorization**. Do not merge from this agent. 009/INT/SEC/EVD OFF.
