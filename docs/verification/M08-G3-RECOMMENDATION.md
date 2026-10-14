# M08 G3 recommendation (independent evidence bind)

**Recommended gate: `G3_INTEGRATION_VERIFIED`**

> **Superseded for issuance status:** Human gate authority issued `G3_INTEGRATION_VERIFIED` via `docs/verification/M08-G3-GATE-RECORD.md` / `orchestrator/handovers/SF-M08-GATE.yaml` (`HUMAN_M08_G3_AUTHORIZATION`). This recommendation document remains the EVD bind narrative. CERTIFIED / G6 remain **false**.

Independent evidence verifier (SF-M08-EVD) bind of executed builder, stitch, host, INT and SEC records on exact production SoT `cb31a7d30fba1b912e42a633187efd786fbb3f2d`. **Human/CI decides G3.** This record does **not** certify, issue G3, issue G6, or mark CERTIFIED / RELEASE CERTIFIED.

| Field | Value |
|---|---|
| Module | M08 (Discovery, Recommendation, Search, Analytics, Ops dashboard, Retention; CMP-006/007/035/045/046/049; INT-003/010/011/013) |
| Task | SF-M08-EVD |
| Role | independent evidence verifier |
| Model | `opus` / `claude-opus-5-5` |
| Authorization | `HUMAN_M08_WAVE_B_THROUGH_EVD_AUTHORIZATION` |
| Production SoT | `origin/main` `cb31a7d30fba1b912e42a633187efd786fbb3f2d` (merge [#138](https://github.com/dbn1972/serviceform-ai/pull/138) after SEC [#137](https://github.com/dbn1972/serviceform-ai/pull/137)) |
| Disposition | **`SF_M08_EVD_PASS_G3_RECOMMENDED`** |
| Recommended result | **`G3_INTEGRATION_VERIFIED`** |
| Human/CI decision | **required** (this agent does **not** issue the gate) |
| `G3_ISSUED` / `gate_issued` / `human_gate_issued` | **true** (see `M08-G3-GATE-RECORD.md`; this EVD row was false at recommendation time) |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** |
| SIMULATED boundaries | CMP-035 `SimulatedProjectionRules` (refused in UAT/PREPROD/PRODUCTION); CMP-045/CMP-046 unbound ports fail closed |

## Bound verifier results

| Gate | Source | Final head | Recommended result | Merge |
|---|---|---|---|---|
| INT | [#138](https://github.com/dbn1972/serviceform-ai/pull/138) | `83f843d39b3f624bfa9e7c5dbc2837920ca85c8f` | `SF_M08_INT_PASS` (36/36) | `cb31a7d…` (SoT) |
| SEC | [#137](https://github.com/dbn1972/serviceform-ai/pull/137) | `40c77830f7c7730e188f5b889a74afdeafcf32cd` | `SF_M08_SEC_PASS` (20/20) | `e24c775…` |

## Critical-path merges on SoT

| Step | PR | Head | Merge commit | PR-head CI / Sec / DP | Merge push CI / Sec / DP |
|---|---|---|---|---|---|
| SF-M08-005 retention (CMP-049) | [#132](https://github.com/dbn1972/serviceform-ai/pull/132) | `f4a9697…` | `d5f01a1a63391d4bb39176537441e70cb12d275e` | `38379142062` / `38379142121` / `38379142148` SUCCESS | `38385142707` / `38385142676` / `38385142561` SUCCESS |
| STITCH-A (lock: cmp-049) | [#133](https://github.com/dbn1972/serviceform-ai/pull/133) | `2260be8…` | `6ef081cce49aad78f2af9138de443334588fa45f` | `38385477939` / `38385478063` / `38385477906` SUCCESS | `38389820299` / `38389820313` / `38389820297` SUCCESS |
| SF-M08-006 discovery (CMP-006) | [#134](https://github.com/dbn1972/serviceform-ai/pull/134) | `b39d5a8…` | `2df9353113b7541d0b9fab81096a4b079c1d2739` | `38396322673` / `38396322621` / `38396322873` SUCCESS | `38400275078` / `38400274909` / `38400275018` SUCCESS |
| STITCH-B (lock: cmp-006) | [#135](https://github.com/dbn1972/serviceform-ai/pull/135) | `b35ad0d…` | `6cc3eb473abc885e3f7eefc99deb90da37f6db00` | `38400701126` / `38400701149` / `38400701175` SUCCESS | ci `38413184763` **CANCELLED** (superseded; M01 envelope job only) / `38413184318` / `38413184360` SUCCESS |
| SF-M08-007 host mounts | [#136](https://github.com/dbn1972/serviceform-ai/pull/136) | `f1b74b0…` | `50a4ed3ad474a6a1395de98c9937a50f23045cfb` | `38414736478` / `38414736473` / `38414736820` SUCCESS | `38420424180` / `38420424233` / `38420424208` SUCCESS |
| SF-M08-SEC | [#137](https://github.com/dbn1972/serviceform-ai/pull/137) | `40c7783…` | `e24c775c38a3196af92c583d7918761d6ab9729b` | `38422448373` / `38422448438` / `38422448488` SUCCESS | ci `38427990174` / DP `38427990279` CANCELLED (superseded by SoT push) / sec `38427990819` SUCCESS |
| SF-M08-INT | [#138](https://github.com/dbn1972/serviceform-ai/pull/138) | `83f843d…` | **`cb31a7d…` (SoT)** | `38422451382` / `38422451310` / `38422451431` SUCCESS | see SoT CI below |

**SoT push CI (`cb31a7d…`)**: ci `38428002476` / security `38428002885` / developer-platform `38428002606` — **all SUCCESS**, including the M01 envelope integration job (supersedes the cancelled STITCH-B merge-push ci run) and the migrations/tenant-isolation harness.

## Independent re-execution on SoT (`cb31a7d…`)

| Check | Result |
|---|---|
| INT suites `tests/integration/m08` | **36/36 PASS** (INT-003 11, INT-010 11, INT-011 6, INT-013 8) |
| SEC suites `tests/security/m08` | **20/20 PASS** (4 files) |
| API host `apps/api` vitest | **71/71 PASS** |
| Repo gates `scripts/gates/run_all.py` | **10/10 PASS**; contracts-lock **29/29 FROZEN** |
| `CROSS_TENANT_LEAKAGE` | **0** (INT + SEC) |
| Forged tenant requests reaching component ports | **0** (25 routes × 4 header variants) |
| FORCE RLS on M08 tenant-scoped tables | 32 tables (static, SEC) |
| Statutory retention periods invented | **none** (`POLICY_INPUT_REQUIRED` fail-closed) |
| `production_code_modified` (EVD) | **false** |

## Documented limitations (do not block G3; block CERTIFIED/G6)

- M08 INT ran without PostgreSQL; RLS/privilege-role isolation evidence is owner Postgres 16 integration (SF-M08-005: 14/14, SF-M08-006: 14/14) plus SEC static FORCE RLS analysis.
- Not exercised: OpenSearch, CMP-038 bus delivery/replay history, owner summary adapters (CMP-017/029/037/038/047), CMP-007 beyond deny-by-default host seam, CMP-049 beyond host seam.
- No REAL/SANDBOX connector validation claimed; CMP-035 projection rules are SIMULATED and refused outside LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE.
- Statutory retention policy input remains required from the competent authority.
- SF-M08-INT process note: shared-checkout branch switch during the INT run; the INT commit was cherry-picked to its own branch and evidence re-run. The EVD re-run on SoT independently reproduces 36/36.

## Next external gate

**Issued:** see `docs/verification/M08-G3-GATE-RECORD.md` / `orchestrator/handovers/SF-M08-GATE.yaml`. Agents must not set CERTIFIED / G6.
