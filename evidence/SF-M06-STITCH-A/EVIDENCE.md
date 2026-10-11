# SF-M06-STITCH-A evidence — Wave A mechanical stitch (re-run after #118 correction)

**Not CERTIFIED. Not RELEASE CERTIFIED. Not G3. Not G6. self_certified false. Do not treat this PR as certification.**

Re-execution after SF-M06-002 / #118 stitch-conflict correction head `b694416900d7e8107489c1d4d76bd502611056fb`. Prior attempt stopped at `M06_STITCH_A_SEMANTIC_CONFLICT` on tip-count `migrateDown(2)`.

| Field | Value |
|---|---|
| Task | SF-M06-STITCH-A |
| Branch | `cursor/m06-stitch-a-exec-c5f90d56` |
| AUTHORIZED EXECUTION BASE | `c5f90d56988c4f988133c99643ff2ab96b53997c` |
| execution_authorized | true (`HUMAN_M06_STITCH_A_EXECUTION_AUTHORIZATION` re-run) |
| Frozen contracts altered | none (29/29 MATCH) |
| CCR_REQUIRED | false |
| Handover state | `STITCHED_CANDIDATE` (candidate branch only; tasks yaml not edited) |

## Frozen inputs (copied, not merged)

| Task | CMP | PR | SHA |
|---|---|---:|---|
| SF-M06-001 | CMP-020 | 121 | `c962167f9f2cfee9bc758584de69d5792d627d92` |
| SF-M06-002 | CMP-025 | 118 | `b694416900d7e8107489c1d4d76bd502611056fb` (**corrected**) |
| SF-M06-003 | CMP-026 | 117 | `591559bd9e480956b315b960d56e8f4329b80ecd` |

Trees MATCH BYTE_IDENTICAL. See `TREE-FIDELITY.md`.

## Local executed checks

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm contracts:validate` | PASS |
| `contracts_lock_gate.py` | PASS 29/29 FROZEN |
| `pytest scripts/gates/tests` | PASS 30 |
| `scripts/gates/run_all.py` | PASS 10/10 |
| `migration_lint.py` | PASS 68 files |
| `check_scope.py` SF-M06-STITCH-A | PASS 142 product/lock files (+ evidence/handover in write set) |
| `pnpm audit --prod --audit-level high` | PASS |
| `pnpm db:test` | PASS 17/17 |
| CMP-020 unit+contract | 210/210 |
| CMP-020 PG | 13/13 (incl. tip `migrateDown(2)`) |
| CMP-025 unit+contract | 163/163 |
| CMP-025 PG | 13/13 (incl. named isolated reversibility) |
| CMP-026 unit | 85/85 |
| CMP-026 PG | 30/30 |
| Combined tip | `1759620200001` / `1759620200000` (CMP-020) |
| CROSS_TENANT_LEAKAGE | 0 observed on executed suites |

Recommended next gate: wait for exact-candidate-head **ci**, **Security**, **Developer-platform** SUCCESS, then merge STITCH-A only (builders remain DRAFT). CERTIFIED/G3/G6 false.
