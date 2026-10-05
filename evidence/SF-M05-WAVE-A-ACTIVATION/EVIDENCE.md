# SF-M05 Wave A READY activation evidence

Not CERTIFIED. Not G4. Not G6. Builders not spawned. `contracts/**` and `orchestrator/contracts-lock.yaml` not modified.

| Check | Result |
|---|---|
| Activation base | prefix `ae6c21e1` + suffix `8b08dcdb6f721bc750e501905cd970e4` |
| CG-001 handover | `FROZEN_ON_MAIN` / `repository_freeze_effective: true` / original 13 MATCH / 19/19 FROZEN |
| SF-M05-001..004 | `READY` / `planning_only: false` / `implementation_authorized: true` / `wave_eligible_now: true` / `dispatched: false` |
| contract_locks | 19 each (original 13 IDs unchanged + six M05 IDs appended) |
| Pairwise overlaps | **0** |
| Forbidden writers | **0** |
| `cg01_path_uniqueness_gate.py` | **PASS** (unchanged vs `origin/main`) |
| contracts-lock gate | **PASS** 19/19 FROZEN; lock bytes equal `origin/main` |
| Six M05 hashes | unchanged vs freeze |
| CCR_REQUIRED | **false** |
| Architecture gates | **10/10 PASS** (`python3 scripts/gates/run_all.py`) |
| Spec validation | **PASS** |
| Control-plane consistency | **PASS** (tasks 001–004 match handovers; STITCH-A/005+/INT/SEC/EVD remain PLANNING) |
| STITCH-A / Wave B / M06 / M08 | **OFF** |

## Commands

```text
python3 evidence/SF-M05-WAVE-A-ACTIVATION/pairwise_write_path_uniqueness.py
python3 evidence/SF-M05-WAVE-A-ACTIVATION/control_plane_consistency.py
python3 scripts/gates/contracts_lock_gate.py
python3 scripts/gates/validate_specs.py
python3 scripts/gates/run_all.py
```

Artifacts: `uniqueness.json`, `control-plane-consistency.json`, `logs/`.
