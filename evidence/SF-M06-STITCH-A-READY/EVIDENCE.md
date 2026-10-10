# SF-M06-STITCH-A READY — control-plane promotion evidence

State: **READY_CONTROL_PLANE**. STITCH-A execution **not started** (`stitch_execution_started: false`). Not CERTIFIED. G3 false. G6 false.

Authorization: `HUMAN_M06_STITCH_A_READY_PROMOTION_AUTHORIZATION = true`.

## Provenance (not executable)

| Field | SHA | Role |
|---|---|---|
| `ready_record_parent` | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` | main SHA from which this READY/base-policy record was prepared |
| `ready_control_plane_base` | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` | exact `origin/main` tip used as PR base |
| `historical_planning_base` | `88690846021a2ce082b8a7c7f35c12603effd5d9` | PLANNING-era only; `executable: false` |

## Execution base policy

- `source`: `HUMAN_EXECUTION_AUTHORIZATION`
- `requirement`: execution base MUST equal `origin/main` at the instant the human STITCH-A execution authorization is issued
- `must_include_ready_record`: true
- `require_exact_sha`: true
- `envelope_sha_is_not_execution_authorization`: true
- `execution_base`: **null**
- `execution_authorized`: **false**

## Frozen inputs (exact three; DRAFT/unmerged)

| Envelope | CMP | PR | Head |
|---|---|---|---|
| SF-M06-001 | CMP-020 | #121 | `c962167f9f2cfee9bc758584de69d5792d627d92` |
| SF-M06-002 | CMP-025 | #118 | `fb948840f15280b33c1bb981a28119b1d3d95de6` |
| SF-M06-003 | CMP-026 | #117 | `591559bd9e480956b315b960d56e8f4329b80ecd` |

Builder PRs remain OPEN/DRAFT/unmerged. Do not merge as part of READY promotion.

## Envelope flags

`planning_only: false`, `implementation_authorized: true`, `dispatched: false`, `orchestration_task_state: READY`, `state: READY`.  
`agent_role: integration_agent` (required for future root lockfile admission).  
`builder_agent: serviceform-integration-stitcher`.  
`component_ids: [CMP-020, CMP-025, CMP-026]`.  
`integration_ids: [INT-007, INT-011, INT-013]`.  
`root_lockfile_authorized: true` (future execution only).  
`self_certified` / `certified` / `release_certified` / `g3` / `g6` / `ccr_required` / `frozen_contracts_altered` all false; `not_certified: true`.  
`contract_locks`: 29. `m08_stitch_a: OFF`. `sf_m08_005: PLANNING`.

## Carried residuals (not resolved)

- `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` (CMP-020/025/026 importer rows)
- CMP-020 port adapters unbound / facts source open / migration ordering
- CMP-025 connector type gap / test-double REAL-SANDBOX / topic registration
- CMP-026 participant-tenant schema / adapters unbound
- Host mounts deferred

## Contracts

29/29 FROZEN, 29/29 hash MATCH. `orchestrator/contracts-lock.yaml` and `contracts/**` unchanged. CCR false.

## Scope of this PR

Allowed writes only: `orchestrator/tasks/SF-M06-STITCH-A.yaml`, `orchestrator/handovers/SF-M06-STITCH-A.yaml`, `orchestrator/dispatch/CG-02-ACTIVATION.md`, `docs/planning/CG-02-M06-M08-ENVELOPES.md`, `evidence/SF-M06-STITCH-A-READY/**`.  
No composition, lockfile, product, migrations, or builder changes. Wave B OFF. SF-M08-STITCH-A OFF. STITCH-A execution OFF.

## Validation (this branch)

| Check | Result | Log |
|---|---|---|
| Task == handover (byte-for-byte) | PASS | `logs/envelope-assertions.log` |
| `execution_base` null / `execution_authorized` false | PASS | `logs/envelope-assertions.log` |
| Root lockfile admission (`integration_agent` + `pnpm-lock.yaml`) | PASS | `logs/check-scope-lockfile-admission.log` |
| Role negative (`integration_stitcher` refuses lockfile) | PASS (refused) | `logs/check-scope-role-negative.log` |
| `contracts_lock_gate.py` | PASS (29 FROZEN) | `logs/contracts-lock-gate.log` |
| Contract hash match | 29/29 MATCH | `logs/contract-hash-match.log` |
| `run_all.py` | 10/10 gates passed | `logs/run-all.log` |
| `pytest scripts/gates/tests` | 30 passed | `logs/pytest-gates.log` |

Recommended next gate: `INDEPENDENT_M06_STITCH_A_READY_REVIEW` / `HUMAN_M06_STITCH_A_READY_MERGE_AUTHORIZATION`. Agent cannot self-certify. Do not execute STITCH-A. Do not merge from this agent.
