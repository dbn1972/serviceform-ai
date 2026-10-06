# SF-M05-STITCH-A READY — control-plane evidence

State: **READY_CONTROL_PLANE**. STITCH-A execution **not started** (`stitch_execution_started: false`). Not CERTIFIED. G4 NOT ISSUED. G6 false.

## Base

- Authoritative `origin/main` at start: `20a2ce68c71d66daaec128a0ee866c1ab0ef2a0f` (merge of scope-gate PR #92). Verified before branching.
- `actual_stitch_base` = `20a2ce68c71d66daaec128a0ee866c1ab0ef2a0f`. `historical_planning_base` = `b286ed95…` (labelled, not executable).
- Main CI at base: ci / security / developer-platform = success.

## Frozen inputs (exact PR heads verified via GitHub)

| Envelope | CMP | PR | Head |
|---|---|---|---|
| SF-M05-001 | CMP-015 | #90 | `2d68e37c3e01d78129f1604b02fe98bae4048489` |
| SF-M05-002 | CMP-016 | #89 | `9249ecb7ec2c3e33c0aff139c1496cf7b80c7ce9` |
| SF-M05-003 | CMP-017 | #88 | `8641c756b539492e3f90d2b04c8a9eb1f2192175` |
| SF-M05-004 | CMP-029 | #87 | `5c4d8ac700364b8b01fa10a44f8a1b049b3da825` |

Each head touches only its own `services/cmp-NNN-*/**`, `db/migrations/*_cmp-NNN-*.sql`, `evidence/SF-M05-00N/**` and own handover. None touches `pnpm-lock.yaml`, `contracts/**` or `apps/**`. Builder PRs are not merged.

## Contracts

19/19 FROZEN, 19/19 hash MATCH (`logs/contract-hash-match.log`). Envelope `contract_locks` lists exactly the 19 lock IDs. `orchestrator/contracts-lock.yaml` and `contracts/**` unchanged. CCR not required.

## Stale #91

PR #91 head `2135940`, base `6e9f0481` (predates #92). `reusable: false`. Not touched.

## Lockfile governance

Root `pnpm-lock.yaml` authorized for STITCH-A by merged #92: `agent_role: integration_agent`, exact `pnpm-lock.yaml` entry in `allowed_write_paths`, not read-only. `check_scope.py` unchanged. No branch-name privilege. `.npmrc` and `pnpm-workspace.yaml` added to the envelope's `read_only_paths` (workspace already globs `services/*`).

## Validation (this branch)

| Check | Result | Log |
|---|---|---|
| `contracts_lock_gate.py` | PASS (19 FROZEN, 0 errors) | `logs/contracts-lock-gate.log` |
| `run_all.py` | 10/10 gates passed | `logs/run-all.log` |
| `pytest scripts/gates/tests` | 30 passed | `logs/pytest-gates.log` |
| `check_scope.py` five cases vs STITCH-A envelope | 5/5 as expected (lockfile ALLOW; Wave A trees ALLOW; contracts/lock REFUSE; apps/Wave B REFUSE; nested lockfile/gates/supply-chain REFUSE) | `logs/check-scope-five-cases.log` |
| Task/handover assertions (READY, authorized true, dispatched false, 19 locks, 4 inputs, exact base, mirror) | PASS | `logs/envelope-assertions.log` |

Changed paths: `orchestrator/tasks/SF-M05-STITCH-A.yaml`, `orchestrator/handovers/SF-M05-STITCH-A.yaml`, `orchestrator/dispatch/M05-ACTIVATION.md`, `docs/planning/M05-ENVELOPES.md`, `evidence/SF-M05-STITCH-A-READY/**`. No `contracts/**`, product, `apps/**` or `pnpm-lock.yaml` changes.

## Carry-forward for the later STITCH-A run (not resolved here)

- CMP-016 declares six `@temporalio/*` 1.24.0 pins that are absent from `pnpm-lock.yaml` at base, so admission needs new resolutions for exactly those builder-declared pins.
- SF-M05-002 handover: existing locked `pg-cloudflare@1.4.1` and `@next/swc-*` fail `minimumReleaseAge` on non-frozen resolution. Resolve without weakening policy, or STOP.
- SF-M05-002 handover: coordinate CMP-016 migration repoint with the CMP-015 pin graph (SF-CON-VERSION-PINNING).

Recommended gate: none. Agent cannot self-certify.
