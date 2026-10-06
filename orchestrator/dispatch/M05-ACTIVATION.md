# M05 activation (Wave A COMPLETE; STITCH-A MERGED_AND_VERIFIED; Wave B READY; builders NOT DISPATCHED)

CG-001 is **SATISFIED** on `origin/main`. Wave A builders SF-M05-001..004 are **COMPLETE** on `main` via STITCH-A. SF-M05-STITCH-A is **MERGED_AND_VERIFIED_ON_MAIN** at `905afad22b2112182ff17095272c7c34de4726a9`. Wave B envelopes SF-M05-005..008 are promoted **PLANNING → READY** (`planning_only: false`, `implementation_authorized: true`, `wave_eligible_now: true`, `dispatched: false`). Builders are **NOT DISPATCHED** by this record (`dispatch_authorized: false`, `dispatch_base: null`). STITCH-B / 009 / INT / SEC / EVD / M06 / M08 remain **OFF**. G4 **NOT ISSUED**. CERTIFIED **false**. G6 **false**.

| Switch | Planning PR | Wave A READY (#86) | STITCH-A READY (#93/#94) | STITCH-A merge (#95) | This Wave B READY package |
|---|---|---|---|---|---|
| `planning_only` | true | false on 001–004 | false on STITCH-A | n/a | **false** on 005–008 |
| `implementation_authorized` | false | true on 001–004 | true on STITCH-A | n/a | **true** on 005–008 |
| `wave_eligible_now` | false | true on 001–004 | false on STITCH-A | n/a | **true** on 005–008 |
| `dispatched` | false | false | false | n/a | **false** |
| `dispatch_authorized` | — | — | execution_authorized false | n/a | **false** |
| `dispatch_base` | — | — | execution_base null | n/a | **null** |
| Wave A 001–004 | PLANNING | READY | COMPLETE (immutable inputs) | **on main** | COMPLETE |
| STITCH-A | OFF | OFF | READY (not dispatched) | **MERGED_AND_VERIFIED** `905afad2…` | historical; do not re-execute |
| Wave B 005–008 | OFF | OFF | OFF | OFF | **READY** (not dispatched) |
| STITCH-B / 009 / INT / SEC / EVD | OFF | OFF | OFF | OFF | **OFF** |
| M06 / M08 | OFF | OFF | OFF | OFF | **OFF** |
| G4 / G6 / CERTIFIED | — | — | NOT ISSUED / false / false | unchanged | **NOT ISSUED / false / false** |
| Contract freeze | later | 19/19 FROZEN | 19/19 MATCH | 19/19 MATCH | 19/19 MATCH; CCR false |

## STITCH-A status (reconciled)

Stale wording that STITCH-A is still READY-and-waiting-for-dispatch is **superseded**. PR #95 merged STITCH-A at exact main SHA `905afad22b2112182ff17095272c7c34de4726a9` (post-merge ci / security / developer-platform SUCCESS). Historical STITCH-A READY record #91 (`2135940`) remains **permanently stale** and is **not reusable**. This Wave B READY package does **not** recreate `actual_stitch_base` recursion.

`ready_record_parent.sha` on 005–008 = `905afad22b2112182ff17095272c7c34de4726a9`. Envelope `base_commit` prefix `905afad2` + suffix `2b2112182ff17095272c7c34de4726a9` is **activation provenance ONLY**, not builder dispatch authorization.

## Do not

- Spawn SF-M05-005..008 builders from this PR.
- Start STITCH-B, SF-M05-009, INT, SEC, or EVD.
- Reuse, amend, rebase, or merge #91.
- Mutate `contracts/**` or `orchestrator/contracts-lock.yaml`.
- Treat EVD as G4 issuer.
- Pull M06/M07/M08 product work.
- Claim CERTIFIED / G4 / G6.
- Set `dispatch_authorized: true` or invent a `dispatch_base`.

## Required order after this draft PR

1. Human/CI merge this **draft** READY PR (this agent does not merge).
2. Confirm contracts 19/19 MATCH / architecture gates / exact-head ci+security+developer-platform SUCCESS on the merge.
3. Only then a **separate HUMAN WAVE B DISPATCH AUTHORIZATION** may set `dispatch_authorized` and an exact `dispatch_base` (must include this Wave B READY record).
4. STITCH-B remains OFF until 005–008 immutable heads exist. Host 009 / INT / SEC / EVD / M06 / M08 remain OFF.
