# M07 G3 recommendation (independent evidence bind)

**Recommended gate: `G3_INTEGRATION_VERIFIED`**

> **Not issued.** Human/CI must decide. This EVD record does **not** write a G3 gate record, set `G3_ISSUED`, CERTIFIED, or G6. Authorization for recommendation: `HUMAN_M07_THROUGH_EVD_AUTHORIZATION`. Separate `HUMAN_M07_G3_AUTHORIZATION` is required before any human issues G3.

Independent evidence verifier (SF-M07-EVD) bind of executed planning, freeze, Wave A builders, stitch, host, remediations, INT and SEC records on production SoT `e82126b5edbfe963892bc850631e9e685c733f05`.

| Field | Value |
|---|---|
| Module | M07 (Credentials, QR, Revocation, DigiLocker; CMP-022/024/023/012; INT-008/011/013) |
| Task | SF-M07-EVD |
| Role | independent evidence verifier |
| Authorization | `HUMAN_M07_THROUGH_EVD_AUTHORIZATION` |
| Production SoT | `origin/main` `e82126b5edbfe963892bc850631e9e685c733f05` (merge [#150](https://github.com/dbn1972/serviceform-ai/pull/150) after SEC [#151](https://github.com/dbn1972/serviceform-ai/pull/151)) |
| Disposition | **`SF_M07_EVD_PASS_G3_RECOMMENDED`** |
| Recommended result | **`G3_INTEGRATION_VERIFIED`** |
| Human/CI decision | **required** (this agent does **not** issue the gate) |
| `G3_ISSUED` / `gate_issued` / `human_gate_issued` | **false** |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** |
| SIMULATED boundaries | ESIGN (CMP-022) · DigiLocker (CMP-012 SimulatedDigiLockerConnector; REAL deferred, never PROD) |

## Bound verifier results

| Gate | Source | Final head | Recommended result | Merge |
|---|---|---|---|---|
| INT | [#150](https://github.com/dbn1972/serviceform-ai/pull/150) | `a7fa68cd031141e9aacc882cdde56c8a7373564f` | `SF_M07_INT_PASS_HIGH_CLOSED_NON_BLOCKING_MEDIUM_REMAIN` (65 pass / 2 MEDIUM expected-fail) | `e82126b…` (SoT) |
| SEC | [#151](https://github.com/dbn1972/serviceform-ai/pull/151) | `7213818a5d24df81d5fc34d6b9bf894ddcf19034` | HIGH F05/F06(ISSUED) closed; recommend_g3 true (37 pass / 7 DB skipped locally) | `739443c…` |

## Critical-path merges on SoT (post-host)

| Step | PR | Head | Merge commit | PR-head CI / Sec / DP |
|---|---|---|---|---|
| Gitleaks allowlist | [#154](https://github.com/dbn1972/serviceform-ai/pull/154) | `ab8e9aaf…` | `df0bea4f…` | SUCCESS (exact-head) |
| QR log redaction REM | [#153](https://github.com/dbn1972/serviceform-ai/pull/153) | `2b5b27a9…` | `d3cd30ad…` | `38586211677` / `38586211514` / `38586211196` SUCCESS |
| DigiLocker HIGH REM | [#152](https://github.com/dbn1972/serviceform-ai/pull/152) | `5b3b9a5e…` | `e8f847af…` | `38586210994` / `38586210912` / `38586211117` SUCCESS |
| SF-M07-SEC re-verify | [#151](https://github.com/dbn1972/serviceform-ai/pull/151) | `7213818a…` | `739443ce…` | `38593593650` / `38593593519` / `38593593507` SUCCESS |
| SF-M07-INT re-verify | [#150](https://github.com/dbn1972/serviceform-ai/pull/150) | `a7fa68cd…` | **`e82126b…` (SoT)** | `38593163376` / `38593163394` / `38593163250` SUCCESS |

**Rem tip push CI (`e8f847af…`)**: ci `38592656781` / security `38592656842` / developer-platform `38592656800` — **all SUCCESS**.

**SoT push CI (`e82126b…`)**: bound when workflows complete SUCCESS (see `evidence/SF-M07-EVD/summary.json` `sot_ci`).

## Independent re-execution on SoT (`e82126b…`)

| Check | Result | Artifact |
|---|---|---|
| M07 INT | **65 PASS / 2 expected-fail MEDIUM** (67) | `logs/int-vitest.log`, `junit/int-rerun.xml` |
| M07 SEC | **37 PASS / 7 skipped** (DB) | `logs/sec-vitest.log`, `junit/sec-rerun.xml` |
| API host | **81/81 PASS** | `logs/api-host-vitest.log` |
| Repo gates | **10/10 PASS**; contracts-lock **34/34 FROZEN** | `logs/gates.log` |
| `CROSS_TENANT_LEAKAGE` | **0** | INT + SEC |
| `production_code_modified` (EVD) | **false** | — |

## Closed HIGH findings (bound)

- INT F01/F01b/F01c / F05 / F06 — closed by DigiLocker REM #152 (+ INT re-verify wiring)
- SEC F05 — closed by QR REM #153
- SEC F06 (ISSUED path) — closed by DigiLocker REM #152

## Documented non-blocking residuals (do not block G3 recommend; block CERTIFIED/G6)

- INT MEDIUM F03 (DigiLocker publish projection gaps) / F04 (audit envelope type)
- INT MEDIUM F02 (OFFICER vs SYSTEM registration actor seam — ADR)
- SEC MEDIUM F04 (CMP-012 truthy PDP allow) / F02 (malformed context shape)
- SEC residual: no CMP-030 consent verification port yet
- REAL DigiLocker / REAL eSign deferred; SIMULATED fail-closed verified at binding/adapter layer
- OPA catalogue still lacks M07 actions (fail-closed UNKNOWN_ACTION under live PDP)
- SEC DB privilege/RLS suite skipped in this EVD environment (owner/schema grants + prior SEC evidence; CI migrations/tenant-isolation harness on tip)

## Next external gate

Human/CI may issue `G3_INTEGRATION_VERIFIED` under a separate G3 authorization. Agents must not set CERTIFIED / G6 / self_certified.
