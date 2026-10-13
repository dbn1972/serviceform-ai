# SF-M08-EVD — M08 independent evidence bind

| Field | Value |
|---|---|
| Task | SF-M08-EVD (independent evidence verifier) |
| Authorization | `HUMAN_M08_WAVE_B_THROUGH_EVD_AUTHORIZATION` |
| Model | `opus` / `claude-opus-5-5` |
| Branch | `cursor/m08-evd-sf-m08-evd-91f2` |
| Execution base / SoT | `cb31a7d30fba1b912e42a633187efd786fbb3f2d` (`origin/main`, unchanged at bind completion) |
| Disposition | `SF_M08_EVD_PASS_G3_RECOMMENDED` |
| Recommended result | `G3_INTEGRATION_VERIFIED` (not issued) |
| certified / g3 / g6 / self_certified | false / false / false / false |

## Merge chain (verified via `gh pr list` + `git log origin/main`)

| PR | Task | Head | Merge commit | Merged (UTC) |
|---|---|---|---|---|
| [#132](https://github.com/dbn1972/serviceform-ai/pull/132) | SF-M08-005 retention CMP-049 | `f4a9697394bf9bdf0bb3d78ec89039e09fb62a5f` | `d5f01a1a63391d4bb39176537441e70cb12d275e` | 2026-10-13T10:41:54Z |
| [#133](https://github.com/dbn1972/serviceform-ai/pull/133) | SF-M08-STITCH-A | `2260be81c731c94752acb58adef1734a2c028626` | `6ef081cce49aad78f2af9138de443334588fa45f` | 2026-10-13T11:22:53Z |
| [#134](https://github.com/dbn1972/serviceform-ai/pull/134) | SF-M08-006 discovery CMP-006 | `b39d5a85bdaab68db9e752a18379dad44f2d90cc` | `2df9353113b7541d0b9fab81096a4b079c1d2739` | 2026-10-13T12:50:18Z |
| [#135](https://github.com/dbn1972/serviceform-ai/pull/135) | SF-M08-STITCH-B | `b35ad0def0f0933418e985b909f3c183c625d757` | `6cc3eb473abc885e3f7eefc99deb90da37f6db00` | 2026-10-13T14:25:11Z |
| [#136](https://github.com/dbn1972/serviceform-ai/pull/136) | SF-M08-007 host | `f1b74b01c76770d56b474719fad3b1868cceb0a1` | `50a4ed3ad474a6a1395de98c9937a50f23045cfb` | 2026-10-13T15:15:00Z |
| [#137](https://github.com/dbn1972/serviceform-ai/pull/137) | SF-M08-SEC | `40c77830f7c7730e188f5b889a74afdeafcf32cd` | `e24c775c38a3196af92c583d7918761d6ab9729b` | 2026-10-13T16:08:06Z |
| [#138](https://github.com/dbn1972/serviceform-ai/pull/138) | SF-M08-INT | `83f843d39b3f624bfa9e7c5dbc2837920ca85c8f` | `cb31a7d30fba1b912e42a633187efd786fbb3f2d` | 2026-10-13T16:08:12Z |

All seven provided/expected merge tips match `gh` and `git`.

## CI runs (GitHub Actions; ci / security / developer-platform)

| Commit | Event | ci | security | developer-platform |
|---|---|---|---|---|
| #132 head | pull_request | 38379142062 ✔ | 38379142121 ✔ | 38379142148 ✔ |
| `d5f01a1` | push | 38385142707 ✔ | 38385142676 ✔ | 38385142561 ✔ |
| #133 head | pull_request | 38385477939 ✔ | 38385478063 ✔ | 38385477906 ✔ |
| `6ef081c` | push | 38389820299 ✔ | 38389820313 ✔ | 38389820297 ✔ |
| #134 head | pull_request | 38396322673 ✔ | 38396322621 ✔ | 38396322873 ✔ |
| `2df9353` | push | 38400275078 ✔ | 38400274909 ✔ | 38400275018 ✔ |
| #135 head | pull_request | 38400701126 ✔ | 38400701149 ✔ | 38400701175 ✔ |
| `6cc3eb4` | push | 38413184763 CANCELLED (only M01 envelope job; others ✔) | 38413184318 ✔ | 38413184360 ✔ |
| #136 head | pull_request | 38414736478 ✔ | 38414736473 ✔ | 38414736820 ✔ |
| `50a4ed3` | push | 38420424180 ✔ | 38420424233 ✔ | 38420424208 ✔ |
| #137 head | pull_request | 38422448373 ✔ | 38422448438 ✔ | 38422448488 ✔ |
| `e24c775` | push | 38427990174 CANCELLED (superseded) | 38427990819 ✔ | 38427990279 CANCELLED (superseded) |
| #138 head | pull_request | 38422451382 ✔ | 38422451310 ✔ | 38422451431 ✔ |
| **`cb31a7d` (SoT)** | push | **38428002476 ✔** | **38428002885 ✔** | **38428002606 ✔** |

### SoT CI

All three SoT workflows concluded SUCCESS. `ci` jobs: format/lint/typecheck/unit/contracts/build, architecture gates, migrations and tenant-isolation harness, M01 envelope integration (W1+W2), web shells smoke+a11y, flutter, workflows/compose/terraform — all success. `security`: SAST semgrep + CodeQL, gitleaks, dependency audit, checkov — all success. The cancelled intermediate runs are superseded by the SoT run, which covers the same tree plus later merges.

## Independent re-execution at SoT (local, node v22, vitest 5.0.3)

| Check | Command | Result | Artifact |
|---|---|---|---|
| M08 INT | `npx vitest run --config tests/integration/m08/vitest.config.ts` | 36/36 PASS | `logs/int-vitest.log`, `junit/int-rerun.xml` |
| M08 SEC | `npx vitest run -c tests/security/m08/vitest.config.ts` | 20/20 PASS | `logs/sec-vitest.log`, `junit/sec-rerun.xml` |
| API host | `cd apps/api && npx vitest run` | 71/71 PASS | `logs/api-host-vitest.log` |
| Repo gates | `python3 scripts/gates/run_all.py` | 10/10 PASS; contracts-lock 29/29 FROZEN | `logs/gates.log` |
| Write scope | `scripts/gates/check_scope.py --envelope SF-M08-EVD` | see `logs/check_scope.log` | `logs/check_scope.log` |

## Bound upstream evidence (on SoT tree)

| Task | Evidence | Key results |
|---|---|---|
| SF-M08-005 | `evidence/SF-M08-005/` | unit/contract 68/68, Postgres 16 int 14/14, gates 10/10; retention fail-closed `POLICY_INPUT_REQUIRED`, no invented periods |
| SF-M08-STITCH-A | `evidence/SF-M08-STITCH-A/` | lock +2/-0 (cmp-049 importer), frozen install no mutation, gates 10/10 |
| SF-M08-006 | `evidence/SF-M08-006/` | unit/contract 51/51, Postgres 16 int 14/14, gates 10/10; results non-statutory, INT-003 non-mutating |
| SF-M08-STITCH-B | `evidence/SF-M08-STITCH-B/` | lock +2/-0 (cmp-006 importer), frozen install no mutation, gates 10/10 |
| SF-M08-007 | `evidence/SF-M08-007/` | six mounts (CMP-035/007/045/046/049/006), CMP-036 not re-mounted; host 71/71; contracts 29/29; leakage 0 |
| SF-M08-SEC | `evidence/SF-M08-SEC/` | 20/20; 25 forged-tenant routes × 4 header variants, 0 reaching ports; 32 FORCE RLS tables; 0 critical findings |
| SF-M08-INT | `evidence/SF-M08-INT/` | 36/36 across INT-003/010/011/013; leakage 0; findings none |

## Limitations (documented; block CERTIFIED/G6, not G3)

- M08 INT is node-only; RLS evidence = owner Postgres 16 suites + SEC static FORCE RLS + CI tenant-isolation harness.
- Not exercised: OpenSearch, CMP-038 delivery/replay history, owner summary adapters, CMP-007/CMP-049 beyond host seams.
- CMP-035 projection rules SIMULATED (refused in UAT/PREPROD/PRODUCTION); no REAL/SANDBOX connector claim.
- Statutory retention policy input still required.
- SF-M08-INT run had a shared-checkout branch-switch incident (documented in its EVIDENCE.md); EVD re-run on SoT reproduces 36/36.

## Stance

EVD does not issue G3. `certified=false`, `g3=false`, `g6=false`, `self_certified=false`, `production_code_modified=false`.
