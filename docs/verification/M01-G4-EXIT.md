# M01 G4 exit record (SF-M01-G4-005)

**Status: `PENDING_SIBLINGS`** — G4-004 bound; waiting on **001–003**. **No FINAL PASS.**  
**Exit record token:** **not issued**. Evidence agent recommends only; human/CI issues.  
**Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.**

| Field | Value |
|---|---|
| Task | SF-M01-G4-005 |
| Role | `serviceform-evidence-verifier` |
| Baseline (`origin/main`) | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` (PR #35 promote merge) |
| Envelope planning baseline | `c42c7c89aa75653d099883e7f28ece73cf2c7515` |
| Branch | `cursor/m01-g4-exit-record-d5b7` |
| Store mirror | store `docs/m01-g4-exit-record.md` |
| Gate handover | `orchestrator/handovers/M01-G4-EXIT-GATE.yaml` |
| Target token (split; join with `_`) | `M01` + `COMPLETE` + `G4_SECURITY` + `VERIFIED` |
| Self-certified | **false** |
| `certified` / `release_certified` | **false** |
| M02 / M03 / CG-01 | **blocked** until human/CI issues token |

## Sibling dependency poll (2026-10-04T05:05Z)

| Envelope | Required artifact | Status |
|---|---|---|
| SF-M01-G4-001 | `evidence/SF-M01-G4-001/**` (R-ENV-INT closed; W1+W2 envelope-int) | **PENDING** |
| SF-M01-G4-002 | `evidence/SF-M01-G4-002/**` (full M01 regression executed) | **PENDING** — draft [#38](https://github.com/dbn1972/serviceform-ai/pull/38) harness only; evidence not READY |
| SF-M01-G4-003 | `evidence/SF-M01-G4-003/**` (security exit; `CROSS_TENANT_LEAKAGE=0`) | **PENDING** |
| SF-M01-G4-004 | `docs/verification/M01-G4-RESIDUALS.md` + `evidence/SF-M01-G4-004/**` | **`SF-M01-G4-004_READY`** — [#37](https://github.com/dbn1972/serviceform-ai/pull/37) @ `88d8b28`; store `docs/m01-g4-residuals.md` |

Handover remains **open**. FINAL PASS deferred until **001–003 READY**.

## Exit preconditions

| Precondition | State | Binding |
|---|---|---|
| Wave 1 closed | **YES** | `M01_WAVE1_MERGED_AND_CLOSED` @ `37cbf203e18d8e072353139e368356a8dac00946` (PR #22) |
| Wave 2 closed | **YES** | `M01_WAVE2_GATE_COMBINE_MERGED` @ `8bc7a1a50ee8aa622fd5a6a2866f50b065a79d76` (PR #33) |
| All 11 M01 CMPs merged | **YES** | CMP-002, 003, 030, 031, 032, 036, 037, 038, 047, 048, 055 on main |
| V1–V5 style gates for G4 | **PENDING** | Module-exit re-verify via G4-002 / G4-003 READY |
| `CROSS_TENANT_LEAKAGE=0` | **PENDING** | Must be re-bound by G4-003 on exit tip |
| Frozen contracts 13/13 MATCH | **PENDING** tip reconfirm | G4-004 records 13/13 unchanged; reconfirm with 002/003 tip |
| Residuals register explicit | **YES** | G4-004_READY; ADR-0006 #9 **ACCEPTED_RESIDUAL** |
| R-ENV-INT closed | **PENDING** | **OPEN_DEPENDS** on G4-001 (per residuals register) |
| Not CERTIFIED / not RELEASE CERTIFIED | **YES** | Explicit; this record does not self-issue the token |

## Wave1 + Wave2 closed (ancestry)

| Wave | Status token | Merge SHA | PR |
|---|---|---|---|
| Wave 1 | `M01_WAVE1_MERGED_AND_CLOSED` | `37cbf203e18d8e072353139e368356a8dac00946` | #22 |
| Wave 2 | `M01_WAVE2_GATE_COMBINE_MERGED` | `8bc7a1a50ee8aa622fd5a6a2866f50b065a79d76` | #33 |
| G4 plan | planning merge | `c42c7c89aa75653d099883e7f28ece73cf2c7515` | #34 |
| G4 promote | envelopes READY | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` | #35 |

Prior W2 independent V1–V5 PASS on stitch candidate `347fe74` is **ancestry**, not G4 exit tip proof.

## V1–V5 style gates (G4 exit)

| Gate | Owner | Exit tip result |
|---|---|---|
| V1 Integration / regression | G4-002 (+ G4-001 envelope-int) | **PENDING** |
| V2 Security | G4-003 | **PENDING** |
| V3 Architecture / frozen 13/13 | G4-003 + this record | **PENDING** |
| V4 Quality / CI+security SUCCESS | G4-002 | **PENDING** |
| V5 Evidence bind | G4-005 (this) | **PENDING** (001–003 incomplete) |

## Residuals (bound from G4-004)

Authoritative table: sibling PR [#37](https://github.com/dbn1972/serviceform-ai/pull/37) → `docs/verification/M01-G4-RESIDUALS.md` (tip `88d8b28`). Store mirror: `docs/m01-g4-residuals.md`.

| ID | Status | Notes |
|---|---|---|
| R-ENV-INT | **OPEN_DEPENDS** | Owned by SF-M01-G4-001 — **blocks exit token** until closed |
| R-OUTBOX-SF-APP (ADR-0006 #9) | **ACCEPTED_RESIDUAL** | No CCR; no silent contract edit |
| R-PROVENANCE | **CLOSED** | headSha / ARTIFACT-INDEX authoritative |
| R-BRANCH-PROT | **OPS_CONFIRM** | Human before CG-01 / M02 / M03 |
| R-COV / R-INFRA / R-DPDP / R-CMP055-PKG / R-RUNTIME / R-BUILDER-JUNIT / R-HYGIENE-RATELIMIT | **CARRIED** | Explicit |
| R-MIG-TS / R-LOCKFILE-W2 / R-W2-VERIFY-DISPATCH | **CLOSED** | |
| R-NOT-CERTIFIED | **ACCEPTED_RESIDUAL** | Standing |

**ADR-0006 #9 normative language:** M01 G4 exit **accepts** ADR-0006 condition 9 residual: SF-CON-OUTBOX remains frozen with `sf_app` INSERT (and inbox SELECT/INSERT) grants as copied from `contracts/shared/sql/outbox.template.sql`. No CCR opened by SF-M01-G4-004. Any future tightening requires an explicit CCR; silent mutation of frozen contracts is prohibited.

## Recommendation (this pass)

| Item | Value |
|---|---|
| Aggregate recommendation | **`PENDING_SIBLINGS` / `BLOCKED`** (await 001–003 READY) |
| Token readiness | **false** — do not issue |
| Human/CI action | Wait for G4-001…003; do **not** treat G4-004 alone as exit |
| M02 / M03 / CG-01 | **blocked** |
| CERTIFIED claimed | **no** |

## Evidence index

| Path | Role |
|---|---|
| `evidence/SF-M01-G4-005/` | This task scaffold / later FINAL bind |
| Store `docs/m01-g4-exit-record.md` | Store mirror |
| `orchestrator/handovers/M01-G4-EXIT-GATE.yaml` | Machine-readable gate state |
| Sibling [#37](https://github.com/dbn1972/serviceform-ai/pull/37) | G4-004 residuals (READY) |

## Explicit non-claims

- Not CERTIFIED
- Not RELEASE CERTIFIED
- Not G6
- Exit token not self-issued
- Handover not closed
