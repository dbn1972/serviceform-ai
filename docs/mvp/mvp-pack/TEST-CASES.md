# TEST-CASES — ServiceForm AI MVP (IND-SOC-002 / SAMPLE_LAB)

**Document class:** Human-readable test-case catalogue (synthesized from executable suites)  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false · DigiLocker = **SIMULATED** · Payment REAL = **held**

Executable SoT: `tests/**` + `evidence/SF-M10-*`. This catalogue does not replace executed evidence.

---

## 1. Test strategy layers

| Layer | Purpose | Primary paths |
|---|---|---|
| Unit | CMP domain logic | `services/cmp-*/test/**` |
| Contract / CDC | Schema compatibility | `tests/cdc/**` |
| Integration | INT flows + tenant-neg | `tests/integration/m0*` / `m10/**` |
| Security | AuthZ/isolation negatives | `tests/security/**` |
| E2E / UX4G | Shells + golden journey | `tests/e2e/**`, `tests/ux4g/m10/**` |
| Perf / resilience | G5 + restore | `tests/performance/m10/**`, `tests/resilience/m10/**` (**holds**) |
| Evidence | Gate packs | `evidence/SF-M10-*`, module `*-GATE-RECORD.md` |

Required by `TESTING.md` and Architecture Constitution. Agents cannot self-certify.

---

## 2. Golden E2E catalogue (Playwright)

**Spec:** `tests/e2e/golden/ind-soc-002-golden.spec.ts` (16 tests on tip)  
**Config:** `tests/e2e/playwright.config.ts` (shells 3000–3003)  

**Evidence split (do not conflate):**

| Pack | Result | Meaning |
|---|---|---|
| `evidence/SF-M10-G6-TODAY/` | golden **12 passed · 7 skipped** | Pre-journey tip: health/tenant/ARIA only |
| `evidence/SF-M10-JOURNEY-MOCK/` | golden **16 passed** | Tip `0ceb890` (#186): includes SAMPLE_LAB apply→approve→DigiLocker SIMULATED |

`M10-G6-PREREQUISITES.md` still records the older “journey E2E=false / 7 skipped” inventory — superseded for **SAMPLE_LAB** by JOURNEY-MOCK; **not** superseded for platform-path G6.

| TC-ID | Spec block / title (actual) | Expected | Tip evidence |
|---|---|---|---|
| TC-E2E-01 | Owner-input gate: fails closed when `SF_M10_OWNER_INPUTS_READY` unset; Odisha sample when set | Fail-closed / sample bind | golden.spec + Odisha sample |
| TC-E2E-02 | Harness health: citizen/officer/studio health **200** | 200 | JOURNEY-MOCK / G6-TODAY |
| TC-E2E-03 | Harness health: citizen/officer/studio page titles | Correct titles | same |
| TC-E2E-04 | Tenant isolation: no cross-tenant data in citizen page source | Absent | INT-011 probe |
| TC-E2E-05 | Tenant isolation: API health body has no tenant identifiers | Absent | same |
| TC-E2E-06 | Tenant isolation: forged `x-tenant-id` → 403 or ignored | Fail closed / ignored | SF-TEN-002 |
| TC-E2E-07 | UX4G scaffold: citizen + officer ARIA landmarks | Landmarks present | golden + shells |
| TC-E2E-08 | SAMPLE_LAB: Studio `/services/new` shows IND-SOC-002 + “G6 not issued” | Visible | JOURNEY-MOCK |
| TC-E2E-09 | SAMPLE_LAB: Citizen `/services/IND-SOC-002` apply page | Submit control visible | JOURNEY-MOCK |
| TC-E2E-10 | SAMPLE_LAB: Officer `/applications` queue | Queue heading | JOURNEY-MOCK |
| TC-E2E-11 | SAMPLE_LAB E2E: apply → approve → DigiLocker SIMULATED (`sim:` marker) | Lab store path; **not** REAL/G6 | JOURNEY-MOCK **16 passed** |
| TC-E2E-12 | Platform-path full CMP/Temporal/RLS journey | **HOLD** — not on tip as G6 evidence | `M10-G6-PREREQUISITES.md` |

**Shell a11y suite:** `tests/e2e/shells.spec.ts` — axe WCAG 2.1 A/AA, skip-link, 320px reflow, security headers → **20/20** in `evidence/SF-M10-G6-TODAY/`.

---

## 3. M10 integration catalogue

**Root:** `tests/integration/m10/**`

| TC-ID | Title | INT / topic | Expected on tip |
|---|---|---|---|
| TC-INT-M10-01 | Owner inputs fixture bind | Finding M-04 | Odisha fills placeholders when READY=1 |
| TC-INT-M10-02 | Tenant isolation negatives | INT-011 | Cross-tenant denied |
| TC-INT-M10-03 | Connector mode matrix | INT-013 | SIMULATED allowed non-prod |
| TC-INT-M10-04 | G6 connector hold | DigiLocker REAL | SAMPLE_LAB refused in PRODUCTION critical; TSB seal false |
| TC-INT-M10-05 | Harness aggregate | — | **24 passed · 6 todo** (`evidence/SF-M10-G6-PREREQ/`) |

---

## 4. Hold / negative release suites

| TC-ID | Suite | Pass criterion today |
|---|---|---|
| TC-HOLD-G5 | `tests/performance/m10/g5-hold.test.ts` | Refuses G5 PASS while `SF_M10_G5_PERF_READY` unset; no invented p95/rps |
| TC-HOLD-RES | `tests/resilience/m10/resilience-hold.test.ts` | Refuses while `SF_M10_RESILIENCE_READY` unset |
| TC-HOLD-UX4G | `tests/ux4g/m10/ux4g-hold.test.ts` | Refuses journey UX4G PASS while `SF_M10_UX4G_READY` unset |
| TC-HOLD-CONN | `tests/integration/m10/g6-connector-hold.test.ts` | REAL DigiLocker / seal claims fail closed |

These **passing as holds** ≠ G6 readiness.

---

## 5. Module exit regression (pointer)

| Module | Gate record | Evidence pack pattern |
|---|---|---|
| M01 G4 | `docs/verification/M01-G4-EXIT.md` | `evidence/SF-M01-G4-*` |
| M02–M04 G3 | verification `M0*-*` | `evidence/SF-M02-EVD` … |
| M05 G4 | `M05-G4-GATE-RECORD.md` | `evidence/SF-M05-EVD` |
| M06–M08 G3 | `M0*-G3-GATE-RECORD.md` | `evidence/SF-M06-EVD` … |
| M09 G4 | `M09-G4-GATE-RECORD.md` | `evidence/SF-M09-EVD` |
| M10 G6 | **not issued** | `SF-M10-*` with HOLD disposition |

Payment/SMS/EMAIL/DigiLocker **REAL** deferred residuals remain on M06/M07 records.

---

## 6. CMP-012 DigiLocker lab

| TC-ID | Title | Result class |
|---|---|---|
| TC-DL-SIM-01 | Simulated publish happy path | Unit/lab **66 passed** (G6-TODAY) — **non-G6** |
| TC-DL-SIM-02 | Simulation marker required | Fail without marker |
| TC-DL-REAL-01 | REAL production publish | **BLOCKED** — no adapter/credentials |

---

## 7. Traceability (pack-local)

| REQ (SRS/FRS) | Tests |
|---|---|
| SRS-F-024 / FRS DigiLocker | TC-E2E-11, TC-HOLD-CONN, TC-DL-* |
| SRS-F-031 SAMPLE_LAB journey | TC-E2E-08…11 |
| SRS-F-032 platform-path | TC-E2E-12 (HOLD) |
| SRS-N-002 / INT-011 | TC-E2E-04…06, TC-INT-M10-02 |
| SRS-N-004 G5 | TC-HOLD-G5 |
| SRS-N-005 Resilience | TC-HOLD-RES |
| SRS-N-006 UX4G | shells 20/20 + TC-E2E-07 + TC-HOLD-UX4G |
| FRS-RC-05 ₹0 fee | fee policy + INT-007 skip path |

**Gap:** `specs/requirements/` and `tests/traceability/requirements-tests.yaml` still missing per root `TRACEABILITY.md` (file exists; declared artifacts do not).

---

## 8. How to re-run (lab)

```text
pnpm -r --filter "./apps/web-*" run build
pnpm e2e                          # shells + golden
# optional:
SF_M10_OWNER_INPUTS_READY=1 pnpm exec vitest run --config tests/integration/m10/vitest.config.ts
```

Do not set `SF_M10_*_READY=1` for G5/UX4G/resilience without human authorization and cells.

---

## 9. Explicit non-claims for all TCs

CERTIFIED=false · G6=false · REAL DigiLocker=false · Payment REAL=false · self_certified=false · SAMPLE_LAB ≠ production

**Independent-review note:** Catalogue remapped 1:1 to tip `ind-soc-002-golden.spec.ts` blocks; author self-score 7.5 superseded by review scores in [`../mvp-docs-independent-review.md`](../mvp-docs-independent-review.md).
