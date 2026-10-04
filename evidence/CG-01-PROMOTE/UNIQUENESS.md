# CG-01 uniqueness + frozen-contract gate (pre-dispatch)

| Gate | Result |
|---|---|
| `python scripts/gates/cg01_path_uniqueness_gate.py` | **PASS** |
| `python scripts/gates/contracts_lock_gate.py` | **PASS** 13/13 FROZEN |
| Gate self-tests (`scripts/gates/tests`) | 25 passed |

Serial pair SF-M02-003 ↔ SF-M03-008 shares `apps/api/**` and retains `must_not_run_concurrent_with`. No other write-path overlaps. `pnpm-lock.yaml` / `contracts/**` / `orchestrator/contracts-lock.yaml` not in builder write paths.

Builders were **not** dispatched by this slice.

Rebind prefix `8613d0ec` (suffix in envelopes). Wave A eligible now: SF-M02-001, SF-M02-002, SF-M03-001, SF-M03-002, SF-M03-003, SF-M03-005, SF-M03-006.
