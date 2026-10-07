# SF-M05-SEC independent security evidence

**Not CERTIFIED. Not G4. Not G6. Not RELEASE CERTIFIED.**  
Independent verifier recommendation only: **`SF_M05_SEC` + `_` + `PASS`**.  
**EVD OFF. M06 OFF. M08 OFF.** Do not merge this draft PR.

## Identity

| Field | Value |
| --- | --- |
| Task | SF-M05-SEC |
| Role | independent security verifier (tenant / OPA / AI / host) |
| Execution base (LOCK-8) | `c0d25b32114779ddb4cc23e4e62a25f9d1365192` (`origin/main` post #102) |
| Planning `base_commit` provenance | `b286ed95` + `6755b936f73bc2856c9db2c68d8ca64c` (task envelope unchanged; not used as execution tip) |
| Verifier head | `8b6bb78af9deaeabbd4c94edeb378609d4e8c360` |
| Components | CMP-015, CMP-016, CMP-017, CMP-018, CMP-019, CMP-027, CMP-028, CMP-029 |
| INT | INT-004, INT-005, INT-006, INT-009, INT-011, INT-013 |
| Unmerged siblings | SF-M05-INT **not** consumed as production source of truth |
| `production_code_modified` | **false** |

## Fail-closed preflight

| Check | Result |
| --- | --- |
| `git fetch && git rev-parse origin/main` | `c0d25b32114779ddb4cc23e4e62a25f9d1365192` |
| Matches HUMAN execution base | **PASS** (not `SF_M05_LOCK8_EXECUTION_AUTHORIZATION_STALE`) |
| Contracts lock | **19/19 MATCH** |
| LOCK-7 | SATISFIED (009 merged) |
| LOCK-8 | EXECUTION_AUTHORIZED |

## Executed results

| Check | Result |
| --- | --- |
| Independent vitest (`tests/security/m05`) | 3 files, **24/24 pass** |
| LOGIN-role catalog | **455 pass / 0 fail** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| SUPERUSER findings | **0** |
| BYPASSRLS findings | **0** |
| Runtime ownership violations | **0** (owners=`sf_migrator`; runtime not owner) |
| `*_rw` NOLOGIN | **pass** (all eight M05 privilege roles + `sf_app`/`sf_migrator`/`sf_outbox_publisher`) |
| FORCE RLS probes | **57** ENABLE + **57** FORCE on tenant-authoritative tables |
| Cross-tenant probes | **13** TI.* (SELECT/INSERT/UPDATE/unset) |
| Cross-component SQL LOGIN SELECT | **8** XCOMP.* → `42501` |
| Forged / client-controlled tenant headers | HTTP 403 `SF-TEN-002`; canary absent |
| Body/query tenant forgery | not trusted as server context; canary absent |
| OPA deny / PDP unavailable | fail-closed (`SF-AUTH-002` / `SF-SYS-004`) on case/task/deficiency/appeal/SLA |
| CMP-015 authoritative vs Temporal | Temporal has no case-write port; commit-then-sequence; host omits CMP-016 HTTP |
| Statutory AI paths | **0** (case/inspection/grievance/appeal guards) |
| CMP-019 vs CMP-015 / INT-009 | CaseCommandPort + SlaClockPort only; no `sf_application_case` / `sf_sla` SQL in CMP-019 src |
| CMP-028 `original_case_command` | CMP-015 port only; no `sf_application_case` SQL in CMP-028 src |
| Host CMP-016 HTTP | **0** (intentionally absent) |
| Host CMP-036 duplicate | **0** (registered once; not remounted by M05) |
| CodeQL 25/26/27 | remediated on 009 head `34f966be`; host query pass-through; no new equivalent property write |
| Frozen contracts | **19/19 MATCH** |
| Write scope vs envelope | PASS (allowed paths only) |
| Production / contracts / migrations / grants / RLS / apps / lockfiles | **untouched** |

## Coverage map (required surfaces)

1. FORCE RLS / tenant isolation / SUPERUSER=0 / BYPASSRLS=0 / not table owner / NOLOGIN / CROSS_TENANT_LEAKAGE=0
2. No cross-component SQL; unauthorized grants (`sf_app` authoritative DML=0; PUBLIC ACL=0)
3. OPA fail-closed on case/task/inspection/deficiency/grievance/appeal/SLA
4. CMP-015 authoritative vs Temporal
5. AI statutory boundary
6. CMP-019 security (cannot bypass OPA/tenant/version/CMP-015)
7. CMP-028 `original_case_command` boundary against CMP-015 enforcement
8. Host: no invented CMP-016 HTTP; no CMP-036 remount; forged tenant not authoritative; CodeQL 25/26/27 remediated

## Explicit residuals (carried, **not waived**)

| Residual | Disposition |
| --- | --- |
| CMP-019 `GOVERNING_UNRESOLVED_UNWAIVED` | Carried. SEC verified OPA/RLS/port boundaries. **Not waived.** Functional INT-009/EVD residual remains for later lanes. |
| CMP-028 `GOVERNING_UNRESOLVED_UNWAIVED` | Carried. SEC verified `original_case_command` → CMP-015 port only. **Not waived.** |
| INT-009 pause/resume durable recovery | Carried with CMP-019. SEC proves no SQL bypass / OPA skip. **Not waived.** |
| `M05_HOST_PACKAGE_ADMISSION` = `DEFERRED_UNRESOLVED` | File-URL workspace fallback; `apps/api/package.json` / lockfile unchanged. Classified **mechanical/stitch**, not a production CVE-class supply-chain defect requiring SEC production remediation. **Does not force `SF_M05_SEC_BLOCKED`.** SEC did not edit manifests. |
| SF-CON-OUTBOX publisher `USING true` | Frozen ADR-0006 #9 residual; **not** `CROSS_TENANT_LEAKAGE`. |

## Defects

None blocking on production from SEC probes. No silent waiver. No production patch from this verifier branch.

## Handover / envelope

- `orchestrator/tasks/SF-M05-SEC.yaml` **read-only** (remains PLANNING; planning `base_commit` provenance preserved).
- `orchestrator/handovers/SF-M05-SEC.yaml` records executed verification + exact execution base.
- Gate `cg01_path_uniqueness_gate.py` not weakened.

## Recommendation

**`SF_M05_SEC` + `_` + `PASS`** from executed evidence only.  
Do **not** start SF-M05-EVD until INT and SEC both immutable PASS. Human/CI gate remains required. `certified: false`.
