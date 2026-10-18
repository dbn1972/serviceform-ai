
# TEST-CASES — ServiceForm AI MVP (IND-SOC-002 / SAMPLE_LAB)

**Document class:** Human-readable test-case catalogue (synthesized from executable suites)  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false · DigiLocker = **SIMULATED** · Payment REAL = **held**

Executable SoT: `tests/**` + `evidence/SF-M10-*`. This catalogue does not replace executed evidence.


## 2. Golden E2E catalogue (Playwright)

**Spec:** `tests/e2e/golden/ind-soc-002-golden.spec.ts`  
**Config:** `tests/e2e/playwright.config.ts` (shells 3000–3003)

| TC-ID | Title | Preconditions | Steps (summary) | Expected | Tip evidence |
|---|---|---|---|---|---|
| TC-E2E-01 | Citizen shell health | shells up | Open citizen `/` | health + main landmark | G6-TODAY / journey |
| TC-E2E-02 | Officer shell health | shells up | Open officer | health + main | same |
| TC-E2E-03 | Studio shell health | shells up | Open studio | health + main | same |
| TC-E2E-04 | Tenant canary probe | harness | Valid tenant header | accepted | INT/E2E |
| TC-E2E-05 | Forged tenant rejected | harness | Bad `x-tenant-id` | fail closed | INT-011 |
| TC-E2E-06 | ARIA landmarks | shells | Check banner/main/contentinfo/h1 | present | shells + golden |
| TC-E2E-07 | SAMPLE_LAB apply | Odisha sample | Citizen completes IND-SOC-002 form → submit | application created (lab store) | JOURNEY-MOCK **16 passed** |
| TC-E2E-08 | Officer approve | pending app | Officer approves | approved state | JOURNEY-MOCK |
| TC-E2E-09 | DigiLocker SIMULATED publish | approved | Publish credential | SIMULATED marker; not REAL | JOURNEY-MOCK |
| TC-E2E-10 | Policy-gated platform journeys | `SF_M10_OWNER_INPUTS_READY` | Full platform path | **HOLD** — not G6; may skip/throw until wired | prereq docs |

**Shell a11y suite:** `tests/e2e/shells.spec.ts` — axe WCAG 2.1 A/AA, skip-link, 320px reflow, security headers → **20/20** in `evidence/SF-M10-G6-TODAY/`.


## 4. Hold / negative release suites

| TC-ID | Suite | Pass criterion today |
|---|---|---|
| TC-HOLD-G5 | `tests/performance/m10/g5-hold.test.ts` | Refuses G5 PASS while `SF_M10_G5_PERF_READY` unset; no invented p95/rps |
| TC-HOLD-RES | `tests/resilience/m10/resilience-hold.test.ts` | Refuses while `SF_M10_RESILIENCE_READY` unset |
| TC-HOLD-UX4G | `tests/ux4g/m10/ux4g-hold.test.ts` | Refuses journey UX4G PASS while `SF_M10_UX4G_READY` unset |
| TC-HOLD-CONN | `g6-connector-hold.test.ts` | REAL DigiLocker / seal claims fail closed |

These **passing as holds** ≠ G6 readiness.


## 6. CMP-012 DigiLocker lab

| TC-ID | Title | Result class |
|---|---|---|
| TC-DL-SIM-01 | Simulated publish happy path | Unit/lab **66 passed** (G6-TODAY) — **non-G6** |
| TC-DL-SIM-02 | Simulation marker required | Fail without marker |
| TC-DL-REAL-01 | REAL production publish | **BLOCKED** — no adapter/credentials |


## 8. How to re-run (lab)

```text
pnpm -r --filter "./apps/web-*" run build
pnpm e2e                          # shells + golden
# optional:
SF_M10_OWNER_INPUTS_READY=1 pnpm exec vitest run tests/integration/m10
```

Do not set `SF_M10_*_READY=1` for G5/UX4G/resilience without human authorization and cells.

