# Dispatch plan: CG-02 Wave A READY (builders OFF)

| Field | Value |
|---|---|
| Prompt | `prompts/07_MULTI_AGENT_ORCHESTRATOR.md` |
| Slice | Wave A READY envelopes only (seven lanes) |
| Activation base | `origin/main` prefix `5acb291e` + suffix `a828894c40110396f0eafd62462e4572` |
| Freeze | SF-M06-CG-001 ∥ SF-M08-CG-001 `FROZEN_ON_MAIN`; `repository_freeze_effective: true` |
| Contracts-lock | **29/29 FROZEN** MATCH; existing **19 MATCH** unchanged; ten CG-02 hashes unchanged |
| Exact parallel set | `SF-M06-001 \|\| SF-M06-002 \|\| SF-M06-003 \|\| SF-M08-001 \|\| SF-M08-002 \|\| SF-M08-003 \|\| SF-M08-004` |
| Held | `SF-M08-005` **PLANNING** (`STATUTORY_RETENTION_POLICY_INPUT_REQUIRED`) |
| `planning_only` | **false** on the seven |
| `implementation_authorized` | **true** on the seven |
| `wave_eligible_now` | **true** on the seven |
| `dispatched` | **false** |
| Builders spawned | **None** (`builders=0`) |
| Status tokens | `READY_PROMOTION_GRANTED` + `BUILDER_SPAWN_PENDING_ACTIVATION_RECORD_MERGE` |
| Wave B / STITCH / host / INT / SEC / EVD | **OFF** |
| M07+ | **OFF** |
| CERTIFIED / G6 | **false** |

Locks: planning/freeze already on main (#112 / #113). Envelopes: `orchestrator/tasks/SF-M06-001.yaml` … `003.yaml` and `SF-M08-001.yaml` … `004.yaml` (mirrored under `orchestrator/handovers/`). Narrative: `docs/planning/CG-02-M06-M08-ENVELOPES.md`. Activation: `orchestrator/dispatch/CG-02-ACTIVATION.md`.

## Freeze facts (do not mutate this slice)

- Authoritative freeze merge: prefix `5acb291e` (#113).
- Existing 19 shared+M05 contract IDs and hashes: unchanged vs freeze base.
- Ten CG-02 IDs remain FROZEN with freeze-time hashes (five M06 + five M08).
- Envelope `contract_locks` keep the existing 19 IDs and **append** that module’s five NEW IDs (24 locks each). Hashes/artifacts are not rewritten here.
- `orchestrator/contracts-lock.yaml` and `contracts/**` are **not** written by this activation PR.

## Parallel set (LOCK-3)

Wave A may run only as the exact concurrent set **001∥002∥003 (M06) ∥ 001∥002∥003∥004 (M08)** after this activation record merges. Write-path uniqueness must remain 0 overlaps / 0 forbidden writers. `CG_02_WAVE_A_WRITE_PATH_UNIQUENESS=PASS`. No Wave A builder owns `apps/api/**`, `pnpm-lock.yaml`, `contracts/**`, or `orchestrator/contracts-lock.yaml`. `scripts/gates/cg01_path_uniqueness_gate.py` is not weakened.

## Explicitly OFF

- Spawn the seven Wave A builders (PENDING ACTIVATION RECORD MERGE).
- SF-M08-005 READY or spawn.
- SF-M06-004 Payment, SF-M08-006 Discovery, STITCH-A/B, host, INT, SEC, EVD.
- M07 / M09–M12.
- CERTIFIED / G6 claims.

Do not merge this plan as product implementation. Do not treat READY as CLAIMED or dispatched.
