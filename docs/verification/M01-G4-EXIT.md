# M01 G4 exit record (SF-M01-G4-005)

**Status: `SF-M01-G4-005_READY` — exit token ISSUED (human)**  
**Gate recommendation: `READY` (historical); issuance recorded**  
**Token issued: `true` (human Debabrata Nayak / human_or_ci — not self-issued)**  
**Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.**

| Field | Value |
|---|---|
| Task | SF-M01-G4-005 |
| Role | record human exit-token issuance (no self-issue) |
| Baseline tip (issuance) | `436c3545cf31bc3a8ba9aaacfcb0b888a168bd90` (`origin/main`) |
| Prior assessment tip | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` |
| Gate combine | [#41](https://github.com/dbn1972/serviceform-ai/pull/41) → tip `436c354…` |
| Store mirror | store `docs/m01-g4-exit-record.md`, `docs/m01-g4-token-issued.md` |
| Gate handover | `orchestrator/handovers/M01-G4-EXIT-GATE.yaml` |
| Issued token (split; join with `_`) | `M01` + `COMPLETE` + `G4_SECURITY` + `VERIFIED` |
| Self-certified | **false** |
| `certified` / `release_certified` | **false** |
| M02 / M03 / CG-01 | **eligible** (`blocked: false`) pending **separate human authorization**; **not started** |

## Human issuance record

| Field | Value |
|---|---|
| Token (join `_`) | `M01` + `COMPLETE` + `G4_SECURITY` + `VERIFIED` |
| Issuer | Debabrata Nayak |
| Issuer class | `human_or_ci` (human) |
| Issued at (UTC) | `2026-10-04T05:58:00Z` |
| Main SHA | `436c3545cf31bc3a8ba9aaacfcb0b888a168bd90` |
| Recording agent self-issued | **false** |
| Post-merge CI `ci` | [37180571888](https://github.com/dbn1972/serviceform-ai/actions/runs/37180571888) **SUCCESS** |
| Post-merge CI `security` | [37180571882](https://github.com/dbn1972/serviceform-ai/actions/runs/37180571882) **SUCCESS** |
| Post-merge CI `developer-platform` | [37180571899](https://github.com/dbn1972/serviceform-ai/actions/runs/37180571899) **SUCCESS** |
| Frozen contracts | **13/13 MATCH** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| R-ENV-INT | **CLOSED** (CLOSED_IN_CODE via G4-001 / #39; on tip via gate-combine #41) |
| ADR-0006 #9 | **ACCEPTED_RESIDUAL** |
| R-BRANCH-PROT | **ACCEPTED_RESIDUAL** (OPS) — tip probe `protected:false`, rulesets `[]`; human authorized token; CLOSED_OPS not required for issuance |

## Sibling binds (all READY)

| Envelope | Status |
|---|---|
| SF-M01-G4-001 | **READY** — [#39](https://github.com/dbn1972/serviceform-ai/pull/39) @ `6d3e495`; R-ENV-INT **CLOSED_IN_CODE** |
| SF-M01-G4-002 | **READY** — [#38](https://github.com/dbn1972/serviceform-ai/pull/38); `M01_G4_REGRESSION_PASS`; 22/22; leakage=0; frozen 13/13 |
| SF-M01-G4-003 | **READY** — [#40](https://github.com/dbn1972/serviceform-ai/pull/40) @ `34aba10`; LOGIN **546/0**; `CROSS_TENANT_LEAKAGE=0`; store `docs/m01-g4-v-security.md` |
| SF-M01-G4-004 | **READY** — [#37](https://github.com/dbn1972/serviceform-ai/pull/37); ADR-0006 #9 **ACCEPTED_RESIDUAL** |

## Exit preconditions (FINAL)

| Precondition | State | Binding |
|---|---|---|
| Wave 1 closed | **YES** | `M01_WAVE1_MERGED_AND_CLOSED` @ `37cbf203e18d8e072353139e368356a8dac00946` (PR #22) |
| Wave 2 closed | **YES** | `M01_WAVE2_GATE_COMBINE_MERGED` @ `8bc7a1a50ee8aa622fd5a6a2866f50b065a79d76` (PR #33) |
| All 11 M01 CMPs merged | **YES** | CMP-002, 003, 030, 031, 032, 036, 037, 038, 047, 048, 055 |
| V1–V5 style gates for G4 | **PASS** | see matrix below |
| `CROSS_TENANT_LEAKAGE=0` | **YES** | Independent G4-003 (authoritative) + G4-002 corroboration |
| Frozen contracts 13/13 MATCH | **YES** | G4-002 + G4-003 + G4-004 |
| Residuals explicit | **YES** | G4-004; ADR-0006 #9 ACCEPTED_RESIDUAL |
| R-ENV-INT closed | **YES** | G4-001 CLOSED_IN_CODE; tip includes gate-combine #41 |
| Exit token issued | **YES** | human Debabrata Nayak @ `2026-10-04T05:58:00Z` |
| Not CERTIFIED / not RELEASE CERTIFIED | **YES** | Explicit; recording agent does not certify |

## Wave1 + Wave2 closed

| Wave | Status token | Merge SHA | PR |
|---|---|---|---|
| Wave 1 | `M01_WAVE1_MERGED_AND_CLOSED` | `37cbf203e18d8e072353139e368356a8dac00946` | #22 |
| Wave 2 | `M01_WAVE2_GATE_COMBINE_MERGED` | `8bc7a1a50ee8aa622fd5a6a2866f50b065a79d76` | #33 |
| G4 plan | planning merge | `c42c7c89aa75653d099883e7f28ece73cf2c7515` | #34 |
| G4 promote | envelopes READY | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` | #35 |
| G4 gate combine | exit READY on main | `436c3545cf31bc3a8ba9aaacfcb0b888a168bd90` | #41 |

## V1–V5 style gates (G4 exit)

| Gate | Owner | Result |
|---|---|---|
| V1 Integration / regression | G4-002 (+ G4-001) | **PASS** — `M01_G4_REGRESSION_PASS`; 22/22; ci [37178714591](https://github.com/dbn1972/serviceform-ai/actions/runs/37178714591) SUCCESS |
| V2 Security | G4-003 | **PASS** — leakage=0; LOGIN 546/0; security [37178714612](https://github.com/dbn1972/serviceform-ai/actions/runs/37178714612) SUCCESS |
| V3 Architecture / frozen 13/13 | G4-002/003/004 | **PASS** |
| V4 Quality / CI+security SUCCESS | G4-002/003 + tip | **PASS** — tip `436c354` post-merge ci/security SUCCESS |
| V5 Evidence bind | G4-005 | **PASS** — siblings traced; human token issuance recorded |

## Hard security / contract statements

- `CROSS_TENANT_LEAKAGE=0` (G4-003 independent catalog + G4-002)
- Frozen contracts **13/13 MATCH**
- No SUPERUSER/BYPASSRLS; FORCE RLS; no raw X-Tenant-ID trust; no cross-component SQL; no PII/secrets in observability samples (G4-003)
- Residuals explicit (closed or formally carried)
- ADR-0006 #9 **ACCEPTED_RESIDUAL**

## Residuals (explicit)

| ID | Status |
|---|---|
| R-ENV-INT | **CLOSED** (CLOSED_IN_CODE via PR #39; present on tip via #41) |
| R-OUTBOX-SF-APP (ADR-0006 #9) | **ACCEPTED_RESIDUAL** (no CCR) |
| R-PROVENANCE | **CLOSED** |
| R-BRANCH-PROT | **ACCEPTED_RESIDUAL** (OPS) — `GET branches/main` → `protected:false`; rulesets `[]`; protection GET 403. Human Debabrata Nayak authorized token with this OPS residual; CLOSED_OPS not required for token. |
| Carried | R-COV, R-INFRA, R-DPDP, R-CMP055-PKG, R-RUNTIME, R-BUILDER-JUNIT, R-HYGIENE-RATELIMIT |
| R-NOT-CERTIFIED | **ACCEPTED_RESIDUAL** |

**ADR-0006 #9:** M01 G4 exit **accepts** ADR-0006 condition 9 residual: SF-CON-OUTBOX remains frozen with `sf_app` INSERT (and inbox SELECT/INSERT) grants as copied from `contracts/shared/sql/outbox.template.sql`. No CCR; future tightening requires explicit CCR.

## Issuance outcome

| Item | Value |
|---|---|
| Aggregate | **`SF-M01-G4-005_READY`** + human token issued |
| Gate recommendation | **`READY`** (issuance complete) |
| Token readiness | **true** |
| Token issued | **true** — human Debabrata Nayak; not agent self-issue |
| CERTIFIED / RELEASE CERTIFIED / G6 | **false** |
| `m02_m03_blocked` / `cg01_blocked` | **false** — eligible only |
| CG-01 / M02 / M03 started | **false** — requires **separate human authorization** |

## Evidence index

| Path | Role |
|---|---|
| `evidence/SF-M01-G4-005/` | Exit assembly bind + issuance update |
| `evidence/SF-M01-G4-005/token/` | Human issuance evidence |
| `docs/verification/M01-G4-EXIT.md` | This record |
| `orchestrator/handovers/M01-G4-EXIT-GATE.yaml` | Machine-readable gate |
| Sibling evidence | `evidence/SF-M01-G4-001/` … `004/` via PRs #39/#38/#40/#37 |
| Store | `docs/m01-g4-exit-record.md`, `docs/m01-g4-token-issued.md` |

## Explicit non-claims

- Not CERTIFIED
- Not RELEASE CERTIFIED
- Not G6
- Exit token not self-issued (human only)
- CG-01 / M02 / M03 **not started** (eligible pending separate auth)
- R-BRANCH-PROT **ACCEPTED_RESIDUAL** (OPS; not CLOSED_OPS; main still unprotected at probe)
