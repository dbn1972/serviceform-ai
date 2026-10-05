# M05 activation (HOLD)

This document is a **hold**, not an activation.

| Switch | This planning PR | After planning merge | After SF-M05-CG-001 freeze on main | After later dispatch record |
|---|---|---|---|---|
| `planning_only` | true | true until READY promote (separate) | still no builders unless authorized | per later READY package |
| `implementation_authorized` | **false** | **false** | **false** until READY/dispatch | true only on explicit READY slice |
| `dispatched` | false | false | false | still requires orchestrator record |
| `m05_started` | false | false | false | false until Wave A spawn |
| `m05_dispatched` | false | false | false | true only when Wave A spawn recorded |
| Contract freeze | **not this PR** | SF-M05-CG-001 may start (later auth) | Wave A may become eligible later | builders |
| M06 / M08 | OFF | OFF | OFF | OFF until CG-02 |

## Do not

- Spawn builders from this PR or from planning merge alone.
- Freeze contracts in the planning PR.
- Treat EVD as G4 issuer.
- Pull M06/M07/M08 product work.
- Merge builder PRs individually in a later wave (stitch/host/orchestrator integration remains the merge path, same as M04).

## Required order after this PR is merged (still not implementation)

1. Human/CI merge this **draft** planning PR (separate authorization; planning agent does not merge).
2. Confirm uniqueness / contracts 13/13 / architecture gates / exact-head ci+security+developer-platform SUCCESS.
3. **SF-M05-CG-001** freeze of NEW M05 contracts (separate authorization).
4. Only then a later READY/dispatch record may set Wave A `wave_eligible_now`.
