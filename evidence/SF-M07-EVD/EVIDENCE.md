# SF-M07-EVD — M07 independent evidence bind

| Field | Value |
|---|---|
| Task | SF-M07-EVD (independent evidence verifier) |
| Authorization | `HUMAN_M07_THROUGH_EVD_AUTHORIZATION` |
| Branch | `cursor/m07-evd-91f2` |
| Execution base / SoT | `e82126b5edbfe963892bc850631e9e685c733f05` (`origin/main`) |
| Disposition | `SF_M07_EVD_PASS_G3_RECOMMENDED` |
| Recommended result | `G3_INTEGRATION_VERIFIED` (**not issued**) |
| certified / g3 / g6 / self_certified | false / false / false / false |
| gate_issued | **false** |

## Merge chain (post-host critical path)

| PR | Task | Head | Merge |
|---|---|---|---|
| [#154](https://github.com/dbn1972/serviceform-ai/pull/154) | gitleaks allowlist | `ab8e9aaf…` | `df0bea4f…` |
| [#153](https://github.com/dbn1972/serviceform-ai/pull/153) | QR REM (SEC-F05) | `2b5b27a9…` | `d3cd30ad…` |
| [#152](https://github.com/dbn1972/serviceform-ai/pull/152) | DigiLocker REM (INT/SEC HIGH) | `5b3b9a5e…` | `e8f847af…` |
| [#151](https://github.com/dbn1972/serviceform-ai/pull/151) | SF-M07-SEC re-verify | `7213818a…` | `739443ce…` |
| [#150](https://github.com/dbn1972/serviceform-ai/pull/150) | SF-M07-INT re-verify | `a7fa68cd…` | **`e82126b…` (SoT)** |

## Independent re-execution at SoT

| Check | Result |
|---|---|
| INT `tests/integration/m07` | 65 PASS / 2 expected-fail MEDIUM |
| SEC `tests/security/m07` | 37 PASS / 7 skipped (DB) |
| API host vitest | 81/81 PASS |
| `scripts/gates/run_all.py` | 10/10 PASS; contracts-lock 34/34 FROZEN |

Primary narrative: `docs/verification/M07-G3-RECOMMENDATION.md`.
