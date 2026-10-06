# SF-M05-STITCH-A READY — base-policy revision evidence

State: **READY_CONTROL_PLANE** (base-policy revision). STITCH-A execution **not started** (`stitch_execution_started: false`). Not CERTIFIED. G4 NOT ISSUED. G6 false.

## Why hard-coding pre-merge / post-merge main as `actual_stitch_base` is invalid

Hard-coding `actual_stitch_base` to a concrete main SHA (including post-READY main `f9f98658…`) is self-invalidating:

1. The READY/base-policy record itself is prepared **from** that main tip; once this record merges, `origin/main` advances and the hard-coded SHA is no longer tip.
2. An envelope SHA is **not** human execution authorization. Binding stitch start to a SHA baked into the control-plane PR conflates provenance with authorization.
3. Agents must not guess a moving `origin/main`. Execution may start only from the exact `execution_base` SHA in a **separate** human STITCH-A execution authorization issued when that SHA equals `origin/main` and includes the merged READY control-plane record.

Therefore this revision **removes** `actual_stitch_base` / `base_commit` / the stop `start from any base other than actual_stitch_base`.

## Provenance (not executable)

| Field | SHA | Role |
|---|---|---|
| `ready_record_parent` | `f9f986585db2662474d760fdbf4fb8cf8e32fc4c` | main SHA from which this READY/base-policy record was prepared |
| `ready_control_plane_base` | `20a2ce68c71d66daaec128a0ee866c1ab0ef2a0f` | base used to prepare PR #93 before READY record merged |
| `historical_planning_base` | `b286ed956755b936f73bc2856c9db2c68d8ca64c` | PLANNING-era only; `executable: false` |

## Execution base policy

- `source`: `HUMAN_EXECUTION_AUTHORIZATION`
- `requirement`: execution base MUST equal `origin/main` at the instant the human STITCH-A execution authorization is issued
- `must_include_ready_record`: true
- `require_exact_sha`: true
- `envelope_sha_is_not_execution_authorization`: true
- `execution_base`: **UNSET** / `null`
- `execution_base_source`: `SEPARATE_HUMAN_AUTHORIZATION`
- `execution_authorized`: **false**

Stitch rule: start from exact `execution_base` SHA from separate human auth; task MUST NOT guess; agent MUST NOT use moving main.

## Stop conditions (base/authorization)

- execution without separately issued exact human `execution_base` SHA → STOP
- `execution_base` differs from exact SHA in latest human STITCH-A execution authorization → STOP
- authorized `execution_base` is not `origin/main` at authorization time → STOP
- authorized `execution_base` does not contain merged STITCH-A READY control-plane record → STOP

## Frozen inputs (unchanged; exact four)

| Envelope | CMP | PR | Head |
|---|---|---|---|
| SF-M05-001 | CMP-015 | #90 | `2d68e37c3e01d78129f1604b02fe98bae4048489` |
| SF-M05-002 | CMP-016 | #89 | `9249ecb7ec2c3e33c0aff139c1496cf7b80c7ce9` |
| SF-M05-003 | CMP-017 | #88 | `8641c756b539492e3f90d2b04c8a9eb1f2192175` |
| SF-M05-004 | CMP-029 | #87 | `5c4d8ac700364b8b01fa10a44f8a1b049b3da825` |

Builder PRs remain OPEN/unmerged. Stale PR #91 (`reusable: false`) not reused; `replacement_stitch_created: false`.

## Envelope flags (unchanged)

`planning_only: false`, `implementation_authorized: true`, `dispatched: false`, `orchestration_task_state: READY`, `state: READY`. `self_certified` / `certified` / `release_certified` / `g4` / `g6` / `ccr_required` / `frozen_contracts_altered` all false; `not_certified: true`. `contract_locks`: 19.

## Contracts

19/19 FROZEN, 19/19 hash MATCH. `orchestrator/contracts-lock.yaml` and `contracts/**` unchanged. CCR false.

## Scope of this PR

Allowed writes only: `orchestrator/tasks/SF-M05-STITCH-A.yaml`, `orchestrator/handovers/SF-M05-STITCH-A.yaml`, `evidence/SF-M05-STITCH-A-READY/**`. No composition, lockfile, product, migrations, or builder changes. Wave B OFF. STITCH-A execution OFF (`stitch_execution_started: false`).

## Validation (this branch)

| Check | Result | Log |
|---|---|---|
| Task == handover (byte-for-byte) | PASS | `logs/envelope-assertions.log` |
| `actual_stitch_base` absent | PASS | `logs/envelope-assertions.log` |
| `execution_base` null / `execution_authorized` false | PASS | `logs/envelope-assertions.log` |
| Provenance SHAs | PASS | `logs/envelope-assertions.log` |
| `contracts_lock_gate.py` | PASS (19 FROZEN, 0 errors) | `logs/contracts-lock-gate.log` |
| `run_all.py` | 10/10 gates passed | `logs/run-all.log` |
| `pytest scripts/gates/tests` | 30 passed | `logs/pytest-gates.log` |
| Contract hash match | 19/19 MATCH | `logs/contract-hash-match.log` |

Recommended gate: none. Agent cannot self-certify.
