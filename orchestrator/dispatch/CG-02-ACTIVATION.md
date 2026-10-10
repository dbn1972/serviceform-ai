# CG-02 activation (Wave A READY; builders NOT DISPATCHED)

SF-M06-CG-001 and SF-M08-CG-001 are **FROZEN_ON_MAIN** on `origin/main` at prefix `5acb291e` (`repository_freeze_effective: true`). Wave A envelopes promoted **PLANNING → READY** for exactly seven lanes: SF-M06-001, SF-M06-002, SF-M06-003, SF-M08-001, SF-M08-002, SF-M08-003, SF-M08-004 (`planning_only: false`, `implementation_authorized: true`, `wave_eligible_now: true`, `dispatched: false`).

**`READY_PROMOTION_GRANTED`.** **`BUILDER_SPAWN_PENDING_ACTIVATION_RECORD_MERGE`.** Builders **0** (`dispatched: false`). SF-M08-005 remains **PLANNING** (`STATUTORY_RETENTION_POLICY_INPUT_REQUIRED=true`). Wave B / STITCH-A/B / host / INT / SEC / EVD / M07+ remain **OFF**. CERTIFIED **false**. G6 **false**.

| Switch | Planning (#112) | Freeze (#113) | This Wave A READY package |
|---|---|---|---|
| CG freeze | OFF / proposed | MERGED on main `5acb291e…` | **FROZEN_ON_MAIN** / `repository_freeze_effective: true` |
| Contracts-lock | 19/19 | **29/29 FROZEN MATCH**; existing 19 unchanged | **29/29 MATCH**; lock bytes unchanged by this PR |
| SF-M06-001..003 | PLANNING | PLANNING | **READY** (not dispatched) |
| SF-M08-001..004 | PLANNING | PLANNING | **READY** (not dispatched) |
| SF-M08-005 | PLANNING | PLANNING | **PLANNING** (held; retention policy input) |
| Payment 004 / Discovery 006 / STITCH / host / INT / SEC / EVD | OFF | OFF | **OFF** |
| Builders spawned | 0 | 0 | **0** |
| M07+ | OFF | OFF | **OFF** |
| CERTIFIED / G6 | false | false | **false** |

Envelope `base_commit` prefix `5acb291e` + suffix `a828894c40110396f0eafd62462e4572` is **activation provenance ONLY**, not builder dispatch authorization.

## Do not

- Spawn SF-M06-001..003 or SF-M08-001..004 builders from this PR.
- Promote or spawn SF-M08-005 (statutory retention policy input required).
- Start Wave B, STITCH-A/B, host 005/007, INT, SEC, or EVD.
- Mutate `contracts/**` or `orchestrator/contracts-lock.yaml`.
- Touch M05 evidence PRs #107 / #108 / #109.
- Start M07 / M09–M12.
- Claim CERTIFIED / G6.
- Set `dispatched: true` or invent a `dispatch_base`.

## Required order after this draft PR

1. Independent READY-promotion review, then human/CI merge this **draft** READY PR (this agent does not merge).
2. Confirm contracts 29/29 MATCH / architecture gates / exact-head ci+security+developer-platform SUCCESS on the merge.
3. Only then a **separate HUMAN CG-02 WAVE A DISPATCH AUTHORIZATION** may spawn the seven builders (`builders=0` until then).
4. SF-M08-005 stays PLANNING until statutory retention policy input is supplied and separately authorized.
