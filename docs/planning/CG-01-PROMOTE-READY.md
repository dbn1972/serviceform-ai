# CG-01 M02 ∥ M03 promote → READY (pre-dispatch)

**Decision token (split against CKV_SECRET_6):** family `CG01_M02_M03_IMPL` + status `READY` (do not join).  
**SHA (split):** prefix `8613d0ec` + suffix `844e189191a782753c30c65871756048`.

Human Debabrata Nayak authorized implementation including this promote (same class as M01 G4 promote PR #35). First slice only: promote/rebind. **Builders not dispatched. No CMP code.**

| Field | Value |
|---|---|
| Baseline verified | `origin/main` prefix `8613d0ec` (post-merge CI / security / developer-platform green on #44) |
| Planning SHA (historical) | prefix `cc49843e` |
| Frozen contracts | 13/13 MATCH (unchanged; lock immutable) |
| Envelope state | `READY` / `planning_only: false` / `implementation_authorized: true` / `dispatched: false` |
| CERTIFIED / RELEASE CERTIFIED / G6 | **false** |
| M01 token | remains issued |
| R-BRANCH-PROT | ACCEPTED_RESIDUAL (OPS) |
| M04 | blocked until both M02 and M03 independently reach G3_INTEGRATION_VERIFIED |

## Uniqueness gate

Command: `python scripts/gates/cg01_path_uniqueness_gate.py` (also in `scripts/gates/run_all.py`).

- Fail PR on write-path overlap except documented serial pair **SF-M02-003 ↔ SF-M03-008** sharing `apps/api/**`.
- That pair MUST keep bidirectional `must_not_run_concurrent_with`.
- `pnpm-lock.yaml` orchestrator/stitch owned.
- `contracts/**` and `orchestrator/contracts-lock.yaml` immutable.

## Wave A eligible now

`SF-M02-001`, `SF-M02-002`, `SF-M03-001`, `SF-M03-002`, `SF-M03-003`, `SF-M03-005`, `SF-M03-006`.

## Sequencing

- SF-M03-004 after SF-M03-002.
- SF-M03-007 after SF-M03-002 / 004 / 006.
- Hard serial: SF-M02-003 never concurrent with SF-M03-008 (`apps/api/src/app.ts` single-writer).

## READY envelope IDs

SF-M02-001, SF-M02-002, SF-M02-003, SF-M02-INT, SF-M02-SEC, SF-M02-EVD,  
SF-M03-001, SF-M03-002, SF-M03-003, SF-M03-004, SF-M03-005, SF-M03-006, SF-M03-007, SF-M03-008, SF-M03-INT, SF-M03-SEC, SF-M03-EVD.

## Explicitly not done

- Builder dispatch / CLAIMED
- CMP implementation
- Frozen contract edits
- CERTIFIED claims
