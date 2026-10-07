# SF-M05-SEC-RERUN independent security evidence

**Not CERTIFIED. Not G4. Not G6. Not RELEASE CERTIFIED.**  
Independent verifier recommendation only: **`SF_M05_SEC_RERUN_PASS`** (pending exact-head CI freeze).  
**EVD OFF. M06 OFF. M08 OFF.** Do not merge this draft PR. Do not reuse #104.

## Identity

| Field | Value |
| --- | --- |
| Task | SF-M05-SEC-RERUN |
| Role | independent security verifier (post REM-001/REM-002 LOCK-8 rerun) |
| Authorization | `HUMAN_SF_M05_LOCK8_RERUN_AUTHORIZATION` |
| Execution base | `4d99c91e4bcdc145585fe62449c83a004de1399d` (`origin/main` post #105 REM-002) |
| Branch | `cursor/m05-sec-rerun-4d99c91e` |
| Historical #104 | DRAFT_UNMERGED_EVIDENCE only — not reused as PASS |
| Unmerged siblings | SF-M05-INT-RERUN **not** consumed as production SoT |
| `production_code_modified` | **false** |

## Fail-closed preflight

| Check | Result |
| --- | --- |
| `git fetch origin main` | `4d99c91e4bcdc145585fe62449c83a004de1399d` |
| Matches HUMAN rerun base | **PASS** (not `SF_M05_LOCK8_RERUN_AUTHORIZATION_STALE`) |
| Contracts lock | **19/19 MATCH** |

## Executed local results

| Check | Result |
| --- | --- |
| Independent vitest (`tests/security/m05`) | 4 files, **30/30 pass** |
| LOGIN-role catalog | **463 pass / 0 fail** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| SUPERUSER findings | **0** |
| BYPASSRLS findings | **0** |
| Runtime ownership violations | **0** |
| FORCE RLS probes | **58** ENABLE + **58** FORCE (incl. `reconciliation_intent`) |
| Cross-tenant probes | **16** TI.* (incl. recon intent select/insert/update) |
| Cross-component SQL LOGIN SELECT | **8** XCOMP.* → `42501` |
| Forged / client-controlled tenant headers | HTTP 403 `SF-TEN-002`; canary absent |
| OPA deny / PDP unavailable | fail-closed on case/task/deficiency/appeal/SLA |
| AI statutory paths | **0** |
| CMP-019 ports / stale terminal | CaseCommandPort + SlaClockPort; STALE→`FAILED_STALE`; `NETWORK_IN_TX` |
| CMP-028 `original_case_command` | CMP-015 port only |
| REM-002 seven admissions | `workspace:*` present; CMP-016 **NONE**; CMP-036 **single** |
| Supply-chain | `frozen-lockfile` / `blockExoticSubdeps` / `minimumReleaseAge=10080` / `trustPolicy=no-downgrade` intact |
| Frozen contracts | **19/19 MATCH** |

## Residuals (carried, **not waived**)

| Residual | Disposition |
| --- | --- |
| CMP-019 `GOVERNING_UNRESOLVED_UNWAIVED` | Boundaried SEC PASS; **not waived** |
| CMP-028 `GOVERNING_UNRESOLVED_UNWAIVED` | Boundaried SEC PASS; **not waived** |
| `M05_HOST_PACKAGE_ADMISSION` | **ADMITTED** on tip (REM-002 #105); revalidated |

## Recommendation

**`SF_M05_SEC_RERUN_PASS`** from executed local evidence (CI freeze pending). Human/CI gate remains required. `certified: false`.
