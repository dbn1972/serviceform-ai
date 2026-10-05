# SF-M05-CG-001 evidence — freeze preparation (candidate)

**Not merged. Repository freeze not effective. Not CERTIFIED. Not G6. Wave A OFF. SF-M05-001..004 not started.**

| Field | Value |
|---|---|
| Task | SF-M05-CG-001 |
| Slice | freeze preparation (six NEW lock rows) |
| Base | `main` `a563a6cb3e04d2d56ceb15fe45381d5a4ccab18c` |
| `freeze_authorized` | true |
| `freeze_prepared` | true |
| `repository_freeze_effective` | **false** |
| `implementation_authorized` | false |
| `dispatched` | false |
| `wave_a_eligible` | false |
| `contracts_status` | FROZEN_CANDIDATE |
| `freeze_status` | PENDING_MERGE |
| `state` | FREEZE_PREPARED |
| `ccr_required` | **false** |
| Existing frozen 13 | **MATCH**, hashes changed = 0, `contracts/shared` files changed = 0 |
| Lock | **19/19 FROZEN** |
| ADR-0003 / ADR-0005 | **ACCEPTED** by Debabrata Nayak, 5 October 2026 |

## Local executed checks (this tree)

| Check | Result |
|---|---|
| `python3 scripts/gates/contracts_lock_gate.py` | PASS, 19 FROZEN |
| `python3 scripts/gates/run_all.py` | 10/10 gates passed |
| `pnpm exec prettier --check` (allowed write set) | PASS |
| `node evidence/SF-M05-CG-001/validate-m05-schemas.mjs` | 6 compile; unique `$id`; no circular M05 `$ref`; negative WITHDRAWN/CANCELLED ALWAYS_LEGAL and uncommitted request examples FAIL as required |
| `python3 evidence/SF-M05-CG-001/contracts-lock-safety.py` | 19/19; original_13 hashes_changed=0; six NEW hashes recalculated (not reused) |
| `python3 evidence/SF-M05-CG-001/static-scan.py` | PASS; `alwaysLegalTransitionKey` contains no `>WITHDRAWN` / `>CANCELLED`; scanner-bait tokens split |

## Six post-freeze SHA-256 (do not reuse pre-freeze hashes)

| ID | sha256 |
|---|---|
| SF-CON-APPLICATION-CASE-SM | `9b9fb73750a258d3f8f0bccb3182961f54b41f0b6da0570ea954a53aaf4e9ed7` |
| SF-CON-WORKFLOW-MODEL | `71b20b1803525991a72c3983de0b0c7f7efa8cb76e37c31089f3978e994e2015` |
| SF-CON-COMMAND-TRANSITION | `07b05c9398cf38883d1c7eac20623633ab977d9d5c1b394d3f247fe842ecdd35` |
| SF-CON-HUMAN-TASK | `2413c7af61453379920bbacc9635388c836262d6df46873497258efbe049ead2` |
| SF-CON-SLA-CLOCK | `7a710d662ea77559cc52ec91d45e93f35d96fefc61a3b40903e4cd9cf1249d40` |
| SF-CON-VERSION-PINNING | `54e69aa1250b776eba8bb764f8d14e0e2d16cd5e088200ba31613eaa280720f8` |

## Classification (ADR-0003)

All CMP-015 transitions whose `to_state` is `WITHDRAWN` or `CANCELLED` are `POLICY_GATED_WITHDRAWAL` or `POLICY_GATED_CANCELLATION`. None remain in `alwaysLegalTransitionKey`. Policy-gated commits require `request_construct.kind` matching the class and `status=COMMITTED`. Service availability stays published policy/rules.

## CCR

**CCR_REQUIRED = false.** Original 13 shared hashes unchanged. SF-CON-AUTHZ-DECISION unchanged. `contracts/shared/**` file changes = 0.

## Explicit non-claims

Did not merge. Did not start Wave A. Did not start SF-M05-001..004. Did not claim CERTIFIED / G6. Repository freeze remains pending merge.
