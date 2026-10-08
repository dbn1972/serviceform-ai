# SF-M05-EVD — M05 G4 recommendation bind (LOCK-9)

**Recommended: `G4_SECURITY_VERIFIED`. Not issued. Not CERTIFIED. Not G6.**

Independent evidence bind of executed INT-RERUN + SEC-RERUN on exact SoT `4d99c91e4bcdc145585fe62449c83a004de1399d`. Human/CI decides G4. Recording agent `self_certified: false`. Did **not** merge [#108](https://github.com/dbn1972/serviceform-ai/pull/108) or [#107](https://github.com/dbn1972/serviceform-ai/pull/107). Did **not** start M06/M08. Did **not** issue G4.

| Field | Value |
|---|---|
| Task | SF-M05-EVD (LOCK-9) |
| Authorization | `HUMAN_SF_M05_EVD_AUTHORIZATION` |
| Preflight guard | **GUARD_PASS** (main / #108 / #107 exact; six workflows SUCCESS) |
| LOCK-8 | **SATISFIED**; `INDEPENDENT_SF_M05_LOCK8_RERUN_REVIEW=ACCEPTED` |
| Production SoT | `4d99c91e4bcdc145585fe62449c83a004de1399d` |
| INT PR / head | [#108](https://github.com/dbn1972/serviceform-ai/pull/108) `d1614d70b743b39b20b6d7104d3bd34cb2248f5f` (OPEN draft unmerged) |
| INT local | `local-m05-int-rerun` @ `2026-10-07T15:01:32Z` — **12/12** suites; ~**185** tests |
| SEC PR / head | [#107](https://github.com/dbn1972/serviceform-ai/pull/107) `59ddddd43afeeacfb14a86432c14bbce3ed88073` (OPEN draft unmerged) |
| SEC local | vitest **30/30**; LOGIN catalog **463/0** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Frozen contracts | **19/19 MATCH** |
| `production_code_modified` | **false** (INT + SEC path audits clean) |
| Disposition | **`SF_M05_EVD_PASS_G4_RECOMMENDED`** |
| `G4_RECOMMENDATION` | **`G4_SECURITY_VERIFIED`** |
| `G4_ISSUED` / `gate_issued` / `human_gate_issued` | **false** |
| `certified` / `release_certified` / `g6_claimed` / `self_certified` | **false** |
| M06 / M08 | **OFF** / **OFF** |

## Bound final heads (not stale embedded freeze)

| Lane | Final immutable head | ci | security | developer-platform |
|---|---|---|---|---|
| INT #108 | `d1614d70…` | [37656918445](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918445) SUCCESS | [37656918451](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918451) SUCCESS | [37656918853](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918853) SUCCESS |
| SEC #107 | `59ddddd…` | [37648591412](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591412) SUCCESS | [37648591586](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591586) SUCCESS | [37648591486](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591486) SUCCESS |

INT `summary.json` still embeds intermediate freeze fields (`ci_run_id` `37651183699`, `verifier_freeze_head` `b6033b13…`). Classified **NON_BLOCKING_PROVENANCE_TAIL**. Authoritative bind uses final head `d1614d70…` + runs above. Do **not** rewrite #108.

## Governance

| Item | EVD disposition |
|---|---|
| CMP-019 | **`CMP-019_RESIDUAL_CLOSURE=ACCEPTED`** — verified closure (INT-009 PROVEN), **not** a waiver |
| CMP-028 | Remains **`GOVERNING_UNRESOLVED_UNWAIVED`**. Explicit assessment: **`PERMISSIBLE_CARRIED_RESIDUAL_NON_BLOCKING_FOR_M05_G4_RECOMMENDATION`**. Not silently waived. |
| #103 / #104 | Historical only — **not** current PASS |
| #107 / #108 | **DRAFT_UNMERGED_EVIDENCE** — do not merge |

## Required checks

All **15/15 PASS** — see `summary/required-checks.json`.

Primary narrative: `docs/verification/M05-G4-RECOMMENDATION.md`. Machine record: `orchestrator/handovers/SF-M05-EVD.yaml`.
