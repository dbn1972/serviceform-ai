# M05 activation (Wave A READY GRANTED)

CG-001 is **SATISFIED** on `origin/main` (prefix `ae6c21e1`). This record **grants Wave A READY**. Builder spawn is **PENDING ACTIVATION RECORD MERGE**. Not CERTIFIED. Not G4. Not G6.

| Switch | Planning PR | After planning merge | After SF-M05-CG-001 freeze on main | This Wave A READY package | After this record merges |
|---|---|---|---|---|---|
| `planning_only` | true | true until READY promote | true until this package | **false** on 001–004 only | false on 001–004 |
| `implementation_authorized` | false | false | false until this package | **true** on 001–004 only | true on 001–004 |
| `wave_eligible_now` | false | false | false until this package | **true** on 001–004 only | true on 001–004 |
| `dispatched` | false | false | false | **false** | still false until spawn |
| `m05_started` | false | false | false | **false** | false until Wave A spawn |
| `m05_dispatched` | false | false | false | **false** | true only when Wave A spawn recorded |
| Contract freeze | not planning | CG-001 later | **SATISFIED** 19/19 FROZEN | do not mutate lock/contracts | frozen |
| STITCH-A / Wave B / 009 / INT / SEC / EVD | OFF | OFF | OFF | **OFF** | OFF until later auth |
| M06 / M08 | OFF | OFF | OFF | **OFF** | OFF until CG-02 |

## Do not

- Spawn SF-M05-001..004 builders from this PR before it merges (spawn remains a later orchestrator action).
- Spawn STITCH-A, Wave B, host, INT, SEC, or EVD.
- Mutate `contracts/**` or `orchestrator/contracts-lock.yaml`.
- Treat EVD as G4 issuer.
- Pull M06/M07/M08 product work.
- Claim CERTIFIED / G4 / G6.

## Required order after this draft PR

1. Human/CI merge this **draft** activation PR (this agent does not merge).
2. Confirm uniqueness 0 overlaps / 0 forbidden writers / contracts 19/19 / original 13 MATCH / architecture gates / exact-head ci+security+developer-platform SUCCESS.
3. Only then a later orchestrator spawn may dispatch **001 \|\| 002 \|\| 003 \|\| 004**.
4. STITCH-A remains OFF until 001–004 immutable heads exist.
