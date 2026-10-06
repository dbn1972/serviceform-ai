# Dispatch plan: M05 Wave B READY (builders OFF)

| Field | Value |
|---|---|
| Prompt | `prompts/07_MULTI_AGENT_ORCHESTRATOR.md` |
| Slice | Wave B READY envelopes only |
| Activation parent | `origin/main` `905afad22b2112182ff17095272c7c34de4726a9` (STITCH-A MERGED_AND_VERIFIED) |
| `base_commit` | prefix `905afad2` + suffix `2b2112182ff17095272c7c34de4726a9` (**activation provenance ONLY**) |
| Freeze | SF-M05-CG-001 `FROZEN_ON_MAIN`; `repository_freeze_effective: true` |
| Contracts-lock | **19/19 FROZEN** MATCH; original **13 MATCH** unchanged; six M05 hashes unchanged |
| Exact parallel set | `SF-M05-005 \|\| SF-M05-006 \|\| SF-M05-007 \|\| SF-M05-008` |
| `planning_only` | **false** on 005–008 |
| `implementation_authorized` | **true** on 005–008 |
| `wave_eligible_now` | **true** on 005–008 |
| `dispatched` | **false** |
| `dispatch_authorized` | **false** |
| `dispatch_base` | **null** |
| Builders spawned | **NONE** |
| Future dispatch source | **SEPARATE HUMAN WAVE B DISPATCH AUTHORIZATION** |
| STITCH-B | **OFF** |
| SF-M05-009 / INT / SEC / EVD | **OFF** |
| M06 / M08 | **OFF** |
| CERTIFIED / G4 / G6 | **false** |

Locks: `orchestrator/dispatch/M05-SERIAL-LOCKS.md`. Envelopes: `orchestrator/tasks/SF-M05-005.yaml` … `SF-M05-008.yaml` (byte-identical under `orchestrator/handovers/`). Narrative: `docs/planning/M05-ENVELOPES.md`. Activation: `orchestrator/dispatch/M05-ACTIVATION.md`.

## Freeze facts (do not mutate this slice)

- Authoritative freeze remains on `origin/main`. This PR does not rewrite `contracts/**` or `orchestrator/contracts-lock.yaml`.
- Original 13 shared contract IDs and hashes: unchanged vs STITCH-A merge parent.
- Six M05 IDs remain FROZEN with freeze-time hashes:
  - `SF-CON-APPLICATION-CASE-SM`
  - `SF-CON-WORKFLOW-MODEL`
  - `SF-CON-COMMAND-TRANSITION`
  - `SF-CON-HUMAN-TASK`
  - `SF-CON-SLA-CLOCK`
  - `SF-CON-VERSION-PINNING`
- Envelope `contract_locks` list **all 19** FROZEN IDs (count = 19 per envelope). Hashes/artifacts are not rewritten here.

## Parallel set (LOCK-5)

Wave B may run only as the exact concurrent set **005 \|\| 006 \|\| 007 \|\| 008** after this activation record merges **and** a later HUMAN WAVE B DISPATCH AUTHORIZATION supplies `dispatch_authorized: true` plus an exact `dispatch_base`. This package sets neither. Write-path uniqueness must remain 0 product/migration/evidence/handover overlaps. Shared writable lockfile/contracts/apps among the four lanes is false. `scripts/gates/cg01_path_uniqueness_gate.py` is not weakened.

Mandatory envelope rules (unchanged):

- CMP-018 verification is not statutory approval; DigiLocker remains SIMULATED; no CMP-012; no `apps/api` mount.
- CMP-019 INT-009 pause/resume via CMP-029 port; case transitions only through CMP-015 commands; no SMS/email; do not modify CMP-029 or CMP-015 source.
- CMP-027 generic metadata-driven; ports only; no named-service branching; no AI final disposition; do not alter CMP-016/017.
- CMP-028 appeal never rewrites original case state except via CMP-015 commands; OPA on protected actions; AI never decides; do not alter CMP-015/016.
- Host mount deferred to SF-M05-009. No `pnpm-lock.yaml` writes.

## Explicitly OFF

- Spawn SF-M05-005..008 builders (**NONE** this envelope).
- STITCH-B, host 009, INT, SEC, EVD.
- M06 / M08 / CG-02.
- CERTIFIED / G4 / G6 claims.

Do not merge this plan as product implementation. Do not treat READY as dispatched. Do not start Wave B implementation from this PR.
