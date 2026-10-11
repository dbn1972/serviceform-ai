# M05 G4 recommendation (independent evidence bind)

**Recommended gate: `G4_SECURITY` + `_` + `VERIFIED`**

Independent evidence verifier (SF-M05-EVD / LOCK-9) bind of executed INT-RERUN + SEC-RERUN records on exact production SoT `4d99c91e4bcdc145585fe62449c83a004de1399d`. **Human/CI decides G4.** This record does **not** certify, merge, issue G4, issue G6, or mark CERTIFIED / RELEASE CERTIFIED. M06 and M08 remain **OFF**.

| Field | Value |
|---|---|
| Module | M05 (Case execution / deficiency / appeal / SLA / host; CMP-015/016/017/018/019/027/028/029; INT-004/005/006/009/011/013) |
| Task | SF-M05-EVD |
| Role | independent evidence verifier (LOCK-9) |
| Authorization | `HUMAN_SF_M05_EVD_AUTHORIZATION` |
| LOCK-8 | **SATISFIED**; `INDEPENDENT_SF_M05_LOCK8_RERUN_REVIEW=ACCEPTED` |
| Production SoT | `origin/main` `4d99c91e4bcdc145585fe62449c83a004de1399d` (merge [#105](https://github.com/dbn1972/serviceform-ai/pull/105)) |
| Disposition | **`SF_M05_EVD_PASS_G4_RECOMMENDED`** |
| Recommended result | **`G4_SECURITY` + `_` + `VERIFIED`** |
| Human/CI decision | **required** (this agent does **not** issue the gate) |
| `G4_ISSUED` / `gate_issued` / `gate_passed` / `gate_ready` / `human_gate_issued` | **false** |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** |
| Production rewritten | **false** |
| M06 / M08 | **OFF** / **OFF** |

Unmerged drafts bound as **executed evidence only**, not production source of truth. Do **not** merge this PR, [#108](https://github.com/dbn1972/serviceform-ai/pull/108), or [#107](https://github.com/dbn1972/serviceform-ai/pull/107) on this recommendation alone. Do not cherry-pick verifier tests into `main`. Historical [#103](https://github.com/dbn1972/serviceform-ai/pull/103) / [#104](https://github.com/dbn1972/serviceform-ai/pull/104) are **not** current PASS.

## Bound verifier results

| Gate | Source | Final immutable head | Recommended result | Merged | Certified |
|---|---|---|---|---|---|
| INT-RERUN | [#108](https://github.com/dbn1972/serviceform-ai/pull/108) | `d1614d70b743b39b20b6d7104d3bd34cb2248f5f` | `SF_M05_INT_RERUN_PASS` | **false** | **false** |
| SEC-RERUN | [#107](https://github.com/dbn1972/serviceform-ai/pull/107) | `59ddddd43afeeacfb14a86432c14bbce3ed88073` | `SF_M05_SEC_RERUN_PASS` | **false** | **false** |

M05 production components already on SoT via REM-001 [#106](https://github.com/dbn1972/serviceform-ai/pull/106) + REM-002 [#105](https://github.com/dbn1972/serviceform-ai/pull/105) (and prior stitch/host merges). Verifier branches are evidence references only.

## Independent inspection (exact final heads)

| Check | INT [#108](https://github.com/dbn1972/serviceform-ai/pull/108) | SEC [#107](https://github.com/dbn1972/serviceform-ai/pull/107) |
|---|---|---|
| PR state | **OPEN** draft; `mergedAt=null` | **OPEN** draft; `mergedAt=null` |
| Head OID | `d1614d70b743b39b20b6d7104d3bd34cb2248f5f` | `59ddddd43afeeacfb14a86432c14bbce3ed88073` |
| Base OID | `4d99c91e4bcdc145585fe62449c83a004de1399d` | `4d99c91e4bcdc145585fe62449c83a004de1399d` |
| Diff vs production base | `tests/integration/m05/**` + `evidence/SF-M05-INT-RERUN/**` + INT-RERUN handover only | `tests/security/m05/**` + `evidence/SF-M05-SEC-RERUN/**` + SEC-RERUN handover only |
| Production paths (`services/**`, `apps/**`, `contracts/**`, `db/migrations/**`, `packages/**`, `pnpm-lock.yaml`) | **NONE modified** | **NONE modified** |
| `production_code_modified` | **false** | **false** |
| Workflows on exact final head | ci / security / developer-platform **SUCCESS** | ci / security / developer-platform **SUCCESS** |

## Executed facts independently confirmed

| Fact | INT (#108) | SEC (#107) |
|---|---|---|
| Production base | `4d99c91e…` | `4d99c91e…` |
| Evidence PR head (final) | `d1614d70…` | `59ddddd…` |
| Local / catalog stamp | `local-m05-int-rerun` @ `2026-10-07T15:01:32Z` | assessed_at `2026-10-07T14:59:35Z` |
| Suites / probes | **12/12** PASS; ~**185** tests | vitest **30/30**; LOGIN catalog **463/0** |
| INT-004 / 005 / 006 | PASS / PASS / PASS | (security boundaries) |
| INT-009 durable recon | **PROVEN** (executable E2E) | STALE→`FAILED_STALE`; ports-only; `NETWORK_IN_TX=0` |
| STALE terminals | `STALE_EXPECTED_STATE` / `STALE_VERSION` → `FAILED_STALE` | durable recon stale terminates |
| INT-011 host admission | **ADMITTED** (seven `workspace:*`) | **ADMITTED**; CMP-016 none; CMP-036 single |
| INT-013 | PASS | fail-closed modes corroborated |
| `CROSS_TENANT_LEAKAGE` | **0** | **0** |
| SUPERUSER / BYPASSRLS / ownership | — | **0 / 0 / 0** |
| FORCE RLS | — | 58 ENABLE + 58 FORCE (incl. `reconciliation_intent`) |
| Frozen contracts | **19/19 MATCH** | **19/19 MATCH** |
| `certified` | **false** | **false** |

Independent EVD re-ran on production SoT `4d99c91e…`: `contracts_lock_gate.py` **PASS** (19 FROZEN); `cg01_path_uniqueness_gate.py` **PASS**. Gate scripts were not weakened.

### GitHub Actions (exact final evidence heads; SUCCESS)

| PR | Final head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #108 | `d1614d70…` | [37656918445](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918445) SUCCESS | [37656918451](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918451) SUCCESS | [37656918853](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918853) SUCCESS |
| #107 | `59ddddd…` | [37648591412](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591412) SUCCESS | [37648591586](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591586) SUCCESS | [37648591486](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591486) SUCCESS |

Check-run rollups on those heads: **15/15 SUCCESS** each. Corroborating SoT push on `4d99c91e…`: ci [37621953137](https://github.com/dbn1972/serviceform-ai/actions/runs/37621953137), security [37621953091](https://github.com/dbn1972/serviceform-ai/actions/runs/37621953091), developer-platform [37621953079](https://github.com/dbn1972/serviceform-ai/actions/runs/37621953079) SUCCESS. GitHub SUCCESS corroborates repo gates on the bound heads; it is not a substitute for the local INT/SEC catalogs.

**Stale embedded freeze note:** INT `summary.json` on #108 still lists intermediate run IDs (`37651183699` / `37651183583` / `37651183599`) and `verifier_freeze_head=b6033b13…`. These are **NON_BLOCKING_PROVENANCE_TAILS**. Authoritative bind uses final head `d1614d70…` + runs in the table above. Do **not** rewrite #108.

## SHA stamp map (authoritative bind)

| Role | SHA | Notes |
|---|---|---|
| Production SoT | `4d99c91e4bcdc145585fe62449c83a004de1399d` | Only production source of truth |
| INT evidence PR final head | `d1614d70b743b39b20b6d7104d3bd34cb2248f5f` | Authoritative INT GitHub CI freeze |
| INT local run | `local-m05-int-rerun` / `independent-m05-integration-rerun` | Catalog stamp on production base |
| SEC evidence PR final head | `59ddddd43afeeacfb14a86432c14bbce3ed88073` | Authoritative SEC GitHub CI freeze |
| SEC evidence package commit | `6098d5f300b105b5…` ancestor of freeze | Class E doc stamp acceptable; authoritative freeze is `59ddddd…` |

## Residual disposition

| Residual | Class | Disposition | Leakage? | Blocking for G4 recommendation? |
|---|---|---|---|---|
| CMP-019 durable recon / INT-009 proof | **VERIFIED_RESIDUAL_CLOSURE** | **`CMP-019_RESIDUAL_CLOSURE=ACCEPTED`** (verified closure, **not** waiver) | **no** | **no** |
| CMP-028 `original_case_command` / appeal↔CMP-015 boundary | **GOVERNING_ARCHITECTURAL_RESERVATION** | Remains **`GOVERNING_UNRESOLVED_UNWAIVED`**. Explicitly assessed **`PERMISSIBLE_CARRIED_RESIDUAL_NON_BLOCKING_FOR_M05_G4_RECOMMENDATION`**. Not silently waived. | **no** | **no** |
| INT summary stale embedded freeze fields | **CLASS_E_EVIDENCE_HEAD_BINDING** | `NON_BLOCKING_PROVENANCE_TAIL` (bind final head/runs) | **no** | **no** |
| Historical #103 / #104 | **HISTORICAL_VERIFIER_ONLY** | `NOT_CURRENT_PASS` | **no** | **no** |

### CMP-019 — verified residual closure (ACCEPTED)

INT-009 executable E2E on #108 proved durable `reconciliation_intent` + `DeficiencyReconciliationConsumer` (OPEN/RESPOND, fail→reconcile, crash/partial/duplicate/replay, `STALE_EXPECTED_STATE`/`STALE_VERSION`→`FAILED_STALE` terminal, FORCE RLS, `CROSS_TENANT_LEAKAGE=0`, CaseCommandPort/SlaClockPort only, no network in auth txn). Independent LOCK-8 review **ACCEPTED**. EVD therefore records **`CMP-019_RESIDUAL_CLOSURE=ACCEPTED`** as **verified closure**, not a waiver of an open defect. Do not carry the old unresolved defect as still open for proof.

### CMP-028 — governing residual assessed (permissible carried)

CMP-028 remains **`GOVERNING_UNRESOLVED_UNWAIVED`**. Material reservation: `original_case_command` — CMP-015 remains authoritative; no direct case mutation from appeal. INT revalidated CMP-028 envelope; SEC revalidated appeal boundary (CMP-015 port only; OPA fail-closed). This is a governed architectural reservation with boundaried PASS evidence, **not** an unproven security defect and **not** a silent waiver. Disposition for G4 recommendation: **permissible carried residual (non-blocking)**.

No unresolved **blocking** residual for this recommendation.

## Required checks (1–15)

All **15/15 PASS**. Machine record: `evidence/SF-M05-EVD/summary/required-checks.json`.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- This agent does **not** issue G4; recommendation only (`G4_ISSUED=false`, `gate_issued=false`, `human_gate_issued=false`)
- Did not merge #107 or #108 or rewrite production
- Did not cherry-pick verifier tests into `main`
- Did not start M06 or M08
- Did not treat unmerged PRs as production SoT
- Did not reuse #103 / #104 as current PASS
- Did not waive CMP-028; did not treat CMP-019 closure as a waiver
- `cg01_path_uniqueness_gate.py` / `contracts_lock_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/SF-M05-EVD.yaml`. Evidence index: `evidence/SF-M05-EVD/`.

**Next permitted action:** `INDEPENDENT_SF_M05_EVD_REVIEW` / `HUMAN_M05_G4_AUTHORIZATION`.
