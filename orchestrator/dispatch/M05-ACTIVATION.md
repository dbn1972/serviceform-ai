# M05 activation (Wave A COMPLETE; STITCH-A READY; execution NOT DISPATCHED)

CG-001 is **SATISFIED** on `origin/main` (prefix `ae6c21e1`). Wave A builders SF-M05-001..004 are **COMPLETE** as immutable inputs and **accepted** at exact heads (below). SF-M05-STITCH-A is promoted **PLANNING → READY** (`implementation_authorized: true`, `dispatched: false`). STITCH-A execution is **NOT DISPATCHED**. Not CERTIFIED. G4 NOT ISSUED. Not G6.

| Switch | Planning PR | After SF-M05-CG-001 freeze on main | Wave A READY (#86) | This STITCH-A READY package | After this record merges |
|---|---|---|---|---|---|
| `planning_only` | true | true | false on 001–004 | **false** on STITCH-A | false on STITCH-A |
| `implementation_authorized` | false | false | true on 001–004 | **true** on STITCH-A | true on STITCH-A |
| `wave_eligible_now` | false | false | true on 001–004 | **false** on STITCH-A (serial, LOCK-4) | false |
| `dispatched` | false | false | false | **false** | still false until a later orchestrator dispatch record |
| Wave A builders 001–004 | PLANNING | PLANNING | READY | **COMPLETE** (immutable inputs accepted) | COMPLETE |
| Contract freeze | not planning | **SATISFIED** 19/19 FROZEN | frozen | 19/19 MATCH; CCR false | frozen |
| STITCH-A | OFF | OFF | OFF | **READY** (not dispatched) | READY until dispatch |
| Wave B / 009 / INT / SEC / EVD | OFF | OFF | OFF | **OFF** | OFF until later auth |
| M06 / M08 | OFF | OFF | OFF | **OFF** | OFF until CG-02 |
| G4 / G6 / CERTIFIED | — | — | — | **NOT ISSUED / false / false** | unchanged |

## Accepted Wave A immutable inputs (`frozen_inputs`)

| Envelope | CMP | PR (draft, NOT merged) | Exact head |
|---|---|---|---|
| SF-M05-001 | CMP-015 Case | #90 | `2d68e37c3e01d78129f1604b02fe98bae4048489` |
| SF-M05-002 | CMP-016 Workflow | #89 | `9249ecb7ec2c3e33c0aff139c1496cf7b80c7ce9` |
| SF-M05-003 | CMP-017 Human Task | #88 | `8641c756b539492e3f90d2b04c8a9eb1f2192175` |
| SF-M05-004 | CMP-029 SLA | #87 | `5c4d8ac700364b8b01fa10a44f8a1b049b3da825` |

Executable stitch base (`actual_stitch_base`): `20a2ce68c71d66daaec128a0ee866c1ab0ef2a0f` (merge of scope-gate PR #92). The PLANNING-era base `b286ed95` is retained only as `historical_planning_base` and is not executable.

Root `pnpm-lock.yaml` is authorized for STITCH-A by the merged #92 scope gate: `agent_role: integration_agent` + exact `pnpm-lock.yaml` entry in `allowed_write_paths` + not read-only. No branch-name privilege; `check_scope.py` unchanged.

Stale PR #91 (head `2135940`, base `6e9f0481`, predates #92) is **not reusable**. A future STITCH-A run starts fresh from `actual_stitch_base`.

## Do not

- Execute STITCH-A or create a replacement stitch from this PR.
- Reuse, amend, rebase, or merge #91.
- Merge builder PRs #87 / #88 / #89 / #90.
- Spawn Wave B, 009, INT, SEC, or EVD.
- Mutate `contracts/**` or `orchestrator/contracts-lock.yaml`.
- Treat EVD as G4 issuer.
- Pull M06/M07/M08 product work.
- Claim CERTIFIED / G4 / G6.

## Required order after this draft PR

1. Human/CI merge this **draft** READY PR (this agent does not merge).
2. Confirm contracts 19/19 MATCH / architecture gates / exact-head ci+security+developer-platform SUCCESS on the merge.
3. Only then a later orchestrator dispatch record may dispatch STITCH-A (single integration agent; LOCK-4; not concurrent with 001–004 or STITCH-B).
4. Wave B (005–008) remains OFF until STITCH-A is on `origin/main`.
