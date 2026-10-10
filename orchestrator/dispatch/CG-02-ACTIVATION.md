# CG-02 activation (Wave A builders DRAFT; M06 STITCH-A READY control plane)

SF-M06-CG-001 and SF-M08-CG-001 are **FROZEN_ON_MAIN** on `origin/main` at prefix `5acb291e` (`repository_freeze_effective: true`). Wave A builder envelopes remain **READY** for exactly seven lanes: SF-M06-001, SF-M06-002, SF-M06-003, SF-M08-001, SF-M08-002, SF-M08-003, SF-M08-004. Those seven builders exist as **OPEN DRAFT / unmerged** stitch inputs (not merged by this record).

**`M06_STITCH_A_READY_PROMOTION`.** SF-M06-STITCH-A is promoted **PLANNING → READY** (`planning_only: false`, `implementation_authorized: true`, `dispatched: false`, `execution_authorized: false`, `execution_base: null`). **STITCH-A execution remains OFF** until a separate human execution authorization supplies an exact `execution_base`. SF-M08-STITCH-A remains **OFF / PLANNING**. SF-M08-005 remains **PLANNING** (`STATUTORY_RETENTION_POLICY_INPUT_REQUIRED=true`). Wave B / STITCH-B / host / INT / SEC / EVD / M07+ remain **OFF**. CERTIFIED **false**. G3 **false**. G6 **false**.

| Switch | Wave A READY (#114) | This M06 STITCH-A READY package |
|---|---|---|
| CG freeze | **FROZEN_ON_MAIN** / `repository_freeze_effective: true` | unchanged |
| Contracts-lock | **29/29 MATCH** | **29/29 MATCH**; lock bytes unchanged by this PR |
| SF-M06-001..003 | READY (builders DRAFT) | READY (builders DRAFT / unmerged; frozen inputs pinned) |
| SF-M08-001..004 | READY (builders DRAFT) | READY (builders DRAFT; not M06 STITCH inputs) |
| SF-M08-005 | PLANNING (held) | **PLANNING** (held; retention policy input) |
| SF-M06-STITCH-A | OFF | **READY** (control plane only; execution OFF) |
| SF-M08-STITCH-A | OFF | **OFF** |
| Payment 004 / Discovery 006 / STITCH-B / host / INT / SEC / EVD | OFF | **OFF** |
| Builders spawned / stitch executed | n/a | **execution_authorized: false** |
| M07+ | OFF | **OFF** |
| CERTIFIED / G3 / G6 | false | **false** |

Envelope provenance: `ready_record_parent` / `ready_control_plane_base` = `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` (**not** execution authorization).

## Frozen M06 STITCH-A inputs (exact; DRAFT/unmerged)

| Lane | PR | Head |
|---|---|---|
| SF-M06-001 / CMP-020 | #121 | `c962167f9f2cfee9bc758584de69d5792d627d92` |
| SF-M06-002 / CMP-025 | #118 | `fb948840f15280b33c1bb981a28119b1d3d95de6` |
| SF-M06-003 / CMP-026 | #117 | `591559bd9e480956b315b960d56e8f4329b80ecd` |

## Do not

- Execute SF-M06-STITCH-A (no product materialization, no `pnpm-lock.yaml` regeneration from this PR).
- Merge builder PRs #121 / #118 / #117 (or any Wave A builder).
- Start SF-M08-STITCH-A / SF-M06-STITCH-B / Wave B / host 005/007 / INT / SEC / EVD.
- Promote or spawn SF-M08-005 (statutory retention policy input required).
- Mutate `contracts/**` or `orchestrator/contracts-lock.yaml`.
- Touch M05 evidence PRs #107 / #108 / #109.
- Start M07 / M09–M12.
- Claim CERTIFIED / G3 / G6.
- Set `dispatched: true`, `execution_authorized: true`, or invent an `execution_base`.

## Required order after this draft PR

1. Independent M06 STITCH-A READY review, then human/CI merge this **draft** READY PR (this agent does not merge).
2. Confirm contracts 29/29 MATCH / architecture gates / exact-head ci+security+developer-platform SUCCESS on the merge.
3. Only then a **separate HUMAN M06 STITCH-A EXECUTION AUTHORIZATION** may supply an exact `execution_base` (= `origin/main` at authorization time, including this merged READY record) and authorize materialization + root lockfile admission.
4. SF-M08-STITCH-A stays OFF; SF-M08-005 stays PLANNING until separately authorized.
