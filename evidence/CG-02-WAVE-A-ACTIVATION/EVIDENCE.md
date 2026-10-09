# CG-02 Wave A READY activation evidence

Not CERTIFIED. Not G6. Builders not spawned. `contracts/**` and `orchestrator/contracts-lock.yaml` not modified. SF-M08-005 remains PLANNING.

| Check | Result |
|---|---|
| Activation base | prefix `5acb291e` + suffix `a828894c40110396f0eafd62462e4572` |
| SF-M06-CG-001 / SF-M08-CG-001 | `FROZEN_ON_MAIN` / `repository_freeze_effective: true` / existing 19 MATCH / 29/29 FROZEN |
| SF-M06-001..003 + SF-M08-001..004 | `READY` / `planning_only: false` / `implementation_authorized: true` / `wave_eligible_now: true` / `dispatched: false` |
| SF-M08-005 | **PLANNING** (`STATUTORY_RETENTION_POLICY_INPUT_REQUIRED`) |
| contract_locks | 24 each (existing 19 + module five) |
| Pairwise overlaps | **0** |
| Forbidden writers | **0** |
| `CG_02_WAVE_A_WRITE_PATH_UNIQUENESS` | **PASS** |
| `cg01_path_uniqueness_gate.py` | **PASS** (unchanged vs `origin/main`) |
| contracts-lock gate | **PASS** 29/29 FROZEN; lock bytes equal `origin/main` |
| Ten CG-02 hashes | unchanged vs freeze |
| CCR_REQUIRED | **false** |
| Architecture gates | **10/10 PASS** (`python3 scripts/gates/run_all.py`) |
| Spec validation | **PASS** |
| Control-plane consistency | **PASS** (seven task mirrors match handovers; held lanes remain PLANNING/OFF) |
| Wave B / STITCH / host / INT / SEC / EVD / M07+ | **OFF** |
| Status | `READY_PROMOTION_GRANTED` + `BUILDER_SPAWN_PENDING_ACTIVATION_RECORD_MERGE`; builders=0 |

## Commands

```text
python3 evidence/CG-02-WAVE-A-ACTIVATION/pairwise_write_path_uniqueness.py
python3 evidence/CG-02-WAVE-A-ACTIVATION/control_plane_consistency.py
python3 scripts/gates/contracts_lock_gate.py
python3 scripts/gates/validate_specs.py
python3 scripts/gates/run_all.py
```

Artifacts: `uniqueness.json`, `control-plane-consistency.json`, `logs/`.
