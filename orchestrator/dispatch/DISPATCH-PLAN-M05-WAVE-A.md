# Dispatch plan: M05 Wave A READY (builders OFF)

| Field | Value |
|---|---|
| Prompt | `prompts/07_MULTI_AGENT_ORCHESTRATOR.md` |
| Slice | Wave A READY envelopes only |
| Activation base | `origin/main` prefix `ae6c21e1` + suffix `8b08dcdb6f721bc750e501905cd970e4` |
| Freeze | SF-M05-CG-001 `FROZEN_ON_MAIN`; `repository_freeze_effective: true` |
| Contracts-lock | **19/19 FROZEN** MATCH; original **13 MATCH** unchanged; six M05 hashes unchanged |
| Exact parallel set | `SF-M05-001 \|\| SF-M05-002 \|\| SF-M05-003 \|\| SF-M05-004` |
| `planning_only` | **false** on 001–004 |
| `implementation_authorized` | **true** on 001–004 |
| `wave_eligible_now` | **true** on 001–004 |
| `dispatched` | **false** |
| Builders spawned | **None** |
| STITCH-A | **OFF** |
| Wave B / 005+ / 009 / INT / SEC / EVD | **OFF** |
| M06 / M08 | **OFF** |
| CERTIFIED / G4 / G6 | **false** |

Locks: `orchestrator/dispatch/M05-SERIAL-LOCKS.md`. Envelopes: `orchestrator/tasks/SF-M05-001.yaml` … `SF-M05-004.yaml` (mirrored under `orchestrator/handovers/`). Narrative: `docs/planning/M05-ENVELOPES.md`. Activation: `orchestrator/dispatch/M05-ACTIVATION.md`.

## Freeze facts (do not mutate this slice)

- Authoritative freeze merge: prefix `ae6c21e1` (`#85`).
- Original 13 shared contract IDs and hashes: unchanged vs freeze base.
- Six M05 IDs remain FROZEN with freeze-time hashes:
  - `SF-CON-APPLICATION-CASE-SM`
  - `SF-CON-WORKFLOW-MODEL`
  - `SF-CON-COMMAND-TRANSITION`
  - `SF-CON-HUMAN-TASK`
  - `SF-CON-SLA-CLOCK`
  - `SF-CON-VERSION-PINNING`
- Envelope `contract_locks` keep the original 13 IDs and **append** those six (19 locks). Hashes/artifacts are not rewritten here.
- `orchestrator/contracts-lock.yaml` and `contracts/**` are **not** written by this activation PR.

## Parallel set (LOCK-3)

Wave A may run only as the exact concurrent set **001 \|\| 002 \|\| 003 \|\| 004** after this activation record merges. Write-path uniqueness must remain 0 overlaps / 0 forbidden writers. `scripts/gates/cg01_path_uniqueness_gate.py` is not weakened.

Mandatory envelope rules (unchanged):

- Temporal never authoritative case state (CMP-015 owns case; CMP-016 sequences only).
- ADR-0003 / ADR-0005 binding.
- No named officer in published workflow.
- BPMN import/export only (not a second runtime).
- SLA clock does not mutate case state; no M06 providers.

## Explicitly OFF

- Spawn SF-M05-001..004 builders (PENDING ACTIVATION RECORD MERGE).
- STITCH-A, Wave B, host 009, INT, SEC, EVD.
- M06 / M08 / CG-02.
- CERTIFIED / G4 / G6 claims.

Do not merge this plan as product implementation. Do not treat READY as CLAIMED or dispatched.
