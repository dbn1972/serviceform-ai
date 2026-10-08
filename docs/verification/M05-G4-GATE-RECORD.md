# M05 G4 gate record (human issuance)

**Issued gate: `G4_SECURITY` + `_` + `VERIFIED` (M05 module-exit / security verified)**

Human gate authority **Debabrata Nayak** issued this gate after INT-RERUN / SEC-RERUN / EVD review (`INDEPENDENT_SF_M05_EVD_REVIEW=ACCEPTED`). This pull request **records** issuance only. The recording agent does **not** self-certify (`recording_agent_self_issued=false`). **Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.** Do **not** merge verifier evidence PRs [#109](https://github.com/dbn1972/serviceform-ai/pull/109), [#108](https://github.com/dbn1972/serviceform-ai/pull/108), or [#107](https://github.com/dbn1972/serviceform-ai/pull/107). Do **not** merge historical [#103](https://github.com/dbn1972/serviceform-ai/pull/103) / [#104](https://github.com/dbn1972/serviceform-ai/pull/104). Do **not** start or dispatch M06 or M08. Do **not** merge this gate-record PR without separate authorization.

| Field | Value |
|---|---|
| Module | M05 (Case execution / deficiency / appeal / SLA / host; CMP-015/016/017/018/019/027/028/029; INT-004/005/006/009/011/013) |
| Human decision | **`G4_SECURITY` + `_` + `VERIFIED`** |
| Decision authority | Human gate authority / Debabrata Nayak |
| Independent EVD review | `INDEPENDENT_SF_M05_EVD_REVIEW=ACCEPTED` |
| Authorization | `HUMAN_M05_G4_AUTHORIZATION` |
| `gate_issued` / `gate_ready` / `gate_passed` / `human_gate_issued` | **true** |
| Lifecycle | `HUMAN_GATE_ISSUED` |
| Production base | `origin/main` `4d99c91e` + `4bcdc145585fe62449c83a004de1399d` (merge [#105](https://github.com/dbn1972/serviceform-ai/pull/105)) |
| EVD recommendation head | `8b270beb` + `61742eb42094b3133484013ab88b29b2` ([#109](https://github.com/dbn1972/serviceform-ai/pull/109); recommended G4; superseded by this issuance record) |
| Self-certified | **false** (`recording_agent_self_issued: false`) |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** (`not_certified: true`, `certified: false`, `release_certified: false`, `g6_claimed: false`) |
| Production code modified | **false** |
| Frozen contracts | **19/19 MATCH** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| LOCK-8 / LOCK-9 | **SATISFIED** / **SATISFIED** |
| INT-009 durable reconciliation | **PROVEN** |
| Host package admission | **ADMITTED** |
| M06 / M08 | **OFF** / **OFF** |

Unmerged drafts [#109](https://github.com/dbn1972/serviceform-ai/pull/109), [#108](https://github.com/dbn1972/serviceform-ai/pull/108), and [#107](https://github.com/dbn1972/serviceform-ai/pull/107) remain **immutable evidence references**, not production source of truth. Do not cherry-pick verifier tests into `main`.

## Bound verifier / evidence results

| Gate | Source | Head SHA | Result | Merged | Certified |
|---|---|---|---|---|---|
| INT-RERUN | [#108](https://github.com/dbn1972/serviceform-ai/pull/108) | `d1614d70` + `b743b39b20b6d7104d3bd34cb2248f5f` | `SF_M05_INT_RERUN_PASS` | **false** (evidence ref) | **false** |
| SEC-RERUN | [#107](https://github.com/dbn1972/serviceform-ai/pull/107) | `59ddddd4` + `3afeeacfb14a86432c14bbce3ed88073` | `SF_M05_SEC_RERUN_PASS` | **false** (evidence ref) | **false** |
| EVD recommendation | [#109](https://github.com/dbn1972/serviceform-ai/pull/109) | `8b270beb` + `61742eb42094b3133484013ab88b29b2` | recommended G4 (`gate_issued: false` on EVD) | **false** (superseded by this issuance record) | **false** |

M05 production components already on SoT via REM-001 [#106](https://github.com/dbn1972/serviceform-ai/pull/106) + REM-002 [#105](https://github.com/dbn1972/serviceform-ai/pull/105) (and prior stitch/host merges). Verifier branches are evidence references only. Historical [#103](https://github.com/dbn1972/serviceform-ai/pull/103) / [#104](https://github.com/dbn1972/serviceform-ai/pull/104) are **not** current PASS.

## Executed facts independently confirmed (bound)

| Fact | INT (#108) | SEC (#107) |
|---|---|---|
| Production base | `4d99c91e` + `4bcdc145…` | `4d99c91e` + `4bcdc145…` |
| Evidence PR head | `d1614d70` + `b743b39b…` | `59ddddd4` + `3afeeacf…` |
| Local / catalog stamp | `local-m05-int-rerun` @ `2026-10-07T15:01:32Z` | assessed_at `2026-10-07T14:59:35Z` |
| Suites / probes | **12/12** PASS; ~**185** tests; INT-004/005/006/009/011/013 **PASS** | vitest **30/30**; LOGIN catalog **463/0** |
| INT-009 durable recon | **PROVEN** (executable E2E) | STALE→`FAILED_STALE`; ports-only; `NETWORK_IN_TX=0` |
| Host admission | **ADMITTED** (seven `workspace:*`) | **ADMITTED**; CMP-016 none; CMP-036 single |
| `CROSS_TENANT_LEAKAGE` | **0** | **0** |
| Frozen contracts | **19/19 MATCH** | **19/19 MATCH** |
| Production paths | **untouched** | **untouched** |
| `certified` | **false** | **false** |

EVD [#109](https://github.com/dbn1972/serviceform-ai/pull/109) @ `8b270beb…` independently bound on production base `4d99c91e…`: `contracts_lock_gate.py` **PASS** (19 FROZEN); `cg01_path_uniqueness_gate.py` **PASS**. Disposition `SF_M05_EVD_PASS_G4_RECOMMENDED` superseded by this human issuance record. Gate scripts were not weakened.

### GitHub Actions (exact evidence heads; SUCCESS)

| PR | Head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #108 | `d1614d70…` | [37656918445](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918445) SUCCESS | [37656918451](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918451) SUCCESS | [37656918853](https://github.com/dbn1972/serviceform-ai/actions/runs/37656918853) SUCCESS |
| #107 | `59ddddd4…` | [37648591412](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591412) SUCCESS | [37648591586](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591586) SUCCESS | [37648591486](https://github.com/dbn1972/serviceform-ai/actions/runs/37648591486) SUCCESS |
| #109 | `8b270beb…` | [37712418567](https://github.com/dbn1972/serviceform-ai/actions/runs/37712418567) SUCCESS | [37712418517](https://github.com/dbn1972/serviceform-ai/actions/runs/37712418517) SUCCESS | [37712418521](https://github.com/dbn1972/serviceform-ai/actions/runs/37712418521) SUCCESS |

Corroborating SoT push on `4d99c91e…`: ci [37621953137](https://github.com/dbn1972/serviceform-ai/actions/runs/37621953137), security [37621953091](https://github.com/dbn1972/serviceform-ai/actions/runs/37621953091), developer-platform [37621953079](https://github.com/dbn1972/serviceform-ai/actions/runs/37621953079) SUCCESS. GitHub SUCCESS is corroboration of repo gates on the bound heads; it is not a substitute for the local INT/SEC catalogs.

**Stale embedded freeze note:** INT `summary.json` on #108 still lists intermediate run IDs and an older embedded freeze tip. These are **NON_BLOCKING_PROVENANCE_TAILS** / CLASS_E. Authoritative bind uses final head `d1614d70…` + runs in the table above. Do **not** rewrite #108. EVD handover PENDING fields on #109 are likewise CLASS_E non-blocking; bind uses actual final head/runs above.

## SHA stamp map (authoritative bind)

| Role | SHA | Notes |
|---|---|---|
| Production base | `4d99c91e` + `4bcdc145585fe62449c83a004de1399d` | Only production source of truth for this record |
| INT evidence PR head | `d1614d70` + `b743b39b20b6d7104d3bd34cb2248f5f` | Authoritative INT GitHub CI head; `SF_M05_INT_RERUN_PASS` |
| SEC evidence PR head | `59ddddd4` + `3afeeacfb14a86432c14bbce3ed88073` | Authoritative SEC GitHub CI freeze; `SF_M05_SEC_RERUN_PASS` |
| EVD recommendation PR head | `8b270beb` + `61742eb42094b3133484013ab88b29b2` | Recommended G4; superseded by this issuance record |

## Residual disposition (authorized; non-blocking for issued G4; not leakage)

| Residual | Class | Disposition | Leakage? |
|---|---|---|---|
| CMP-019 durable recon / INT-009 proof | **VERIFIED_RESIDUAL_CLOSURE** | **`CMP-019_RESIDUAL_CLOSURE=ACCEPTED`** (verified closure, **not** waiver) | **no** |
| CMP-028 `original_case_command` / appeal↔CMP-015 boundary | **GOVERNING_ARCHITECTURAL_RESERVATION** | Remains **`GOVERNING_UNRESOLVED_UNWAIVED`**. Explicitly assessed **`PERMISSIBLE_CARRIED_RESIDUAL_NON_BLOCKING_FOR_M05_G4`**. Not silently waived. | **no** |
| INT summary stale embedded freeze fields | **CLASS_E_EVIDENCE_HEAD_BINDING** | `NON_BLOCKING_PROVENANCE_TAIL` (bind final head/runs) | **no** |
| Historical #103 / #104 | **HISTORICAL_VERIFIER_ONLY** | `NOT_CURRENT_PASS` | **no** |

### CMP-019 — verified residual closure (ACCEPTED)

INT-009 executable E2E on #108 proved durable `reconciliation_intent` + `DeficiencyReconciliationConsumer` (OPEN/RESPOND, fail→reconcile, crash/partial/duplicate/replay, `STALE_EXPECTED_STATE`/`STALE_VERSION`→`FAILED_STALE` terminal, FORCE RLS, `CROSS_TENANT_LEAKAGE=0`, CaseCommandPort/SlaClockPort only, no network in auth txn). Independent LOCK-8 review **ACCEPTED**. Human G4 issuance therefore records **`CMP-019_RESIDUAL_CLOSURE=ACCEPTED`** as **verified closure**, not a waiver of an open defect.

### CMP-028 — governing residual assessed (permissible carried)

CMP-028 remains **`GOVERNING_UNRESOLVED_UNWAIVED`**. Material reservation: `original_case_command` — CMP-015 remains authoritative; no direct case mutation from appeal. INT revalidated CMP-028 envelope; SEC revalidated appeal boundary (CMP-015 port only; OPA fail-closed). This is a governed architectural reservation with boundaried PASS evidence, **not** an unproven security defect and **not** a silent waiver. Disposition for issued G4: **`PERMISSIBLE_CARRIED_RESIDUAL_NON_BLOCKING_FOR_M05_G4`**.

No unresolved **blocking** residual for issued G4.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- Recording agent does **not** self-certify (`self_certified: false`, `recording_agent_self_issued: false`)
- Did not merge #107 / #108 / #109 / #103 / #104 or rewrite production
- Did not cherry-pick verifier tests into `main`
- Did not start or dispatch M06 or M08
- Did not open CG-02
- Did not treat unmerged PRs as production SoT
- This gate-record PR must **not** be merged without separate authorization
- Did not waive CMP-028; did not treat CMP-019 closure as a waiver
- `cg01_path_uniqueness_gate.py` / `contracts_lock_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/SF-M05-GATE.yaml` (`gate` family `G4_SECURITY` / status `VERIFIED`, `gate_issued: true`, `human_gate_issued: true`, `certified: false`, `recording_agent_self_issued: false`).
