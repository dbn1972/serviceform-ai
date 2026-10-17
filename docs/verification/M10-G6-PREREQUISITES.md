# M10 G6 prerequisites — blocker inventory (post-Odisha sample)

**G6 issued = false.** Policy sample from Odisha e-District is on SoT (`e1ffa81` / [#183](https://github.com/dbn1972/serviceform-ai/pull/183)).  
This inventory records what still blocks human `G6_RELEASE_CERTIFIED` issuance. No statute invented.

| # | Prerequisite | Status | Blocker (actionable) | Invent policy? |
|---|---|---|---|---|
| 1 | Owner policy inputs (Finding M-04) | **RESOLVED (sample)** | Odisha public portal facts applied; DigiLocker/DLT remain `SAMPLE_LAB_*` | No |
| 2 | Golden INT / tenant isolation | **PASS (harness)** | Local INT 24 passed · 6 todo with `SF_M10_OWNER_INPUTS_READY=1` (includes connector holds) | No |
| 3 | Golden E2E (Playwright) | **PARTIAL** | Citizen/officer/studio journeys need live shells + UX4G screens; policy-gated specs exist | No |
| 4 | G5 performance / soak | **BLOCKED** | `SF-M10-004` / `SF-M10-PERF` still PLANNING; no `tests/performance/m10/**` load profiles; needs PERF env + targets | No |
| 5 | Resilience / backup / restore / rollback | **BLOCKED** | No M10 resilience suite or evidence pack on tip; needs ops runbook + restore drill | No |
| 6 | REAL DigiLocker connector | **BLOCKED** | Portal does not publish DigiLocker doc-type registration; PRODUCTION forbids non-REAL critical binding | No — needs DigiLocker registrar credentials |
| 7 | REAL / SANDBOX payment | **N/A for ₹0 fee; REAL still blocked for general path** | Odisha govt service charge = 0 → zero-fee skip OK in lab; REAL payment binding still needs provider credentials for non-zero tenants | No |
| 8 | UX4G a11y / keyboard / responsive / visual | **BLOCKED** | `SF-M10-005` PLANNING; no `tests/ux4g/m10/**` or golden UX4G evidence | No — needs Design System evidence run |
| 9 | TSB immutability seal | **BLOCKED** | Maker/checker sample recorded; seal deferred until REAL DigiLocker/DLT bindings exist (publish gate) | No |

## Fail-closed hold suites (this PR)

| Suite | Config | Asserts |
|---|---|---|
| G5 perf hold | `tests/performance/m10/` | `SF_M10_G5_PERF_READY` unset → no G5 PASS claim |
| UX4G hold | `tests/ux4g/m10/` | `SF_M10_UX4G_READY` unset → no UX4G PASS claim |
| Resilience hold | `tests/resilience/m10/` | `SF_M10_RESILIENCE_READY` unset → no resilience PASS claim |
| REAL connector / TSB hold | `tests/integration/m10/g6-connector-hold.test.ts` | SAMPLE_LAB refused in PRODUCTION; TSB seal=false |

Planning envelopes `SF-M10-004` / `SF-M10-005` / `SF-M10-PERF` remain **PLANNING** (not READY, not dispatched). No load-profile numbers, DigiLocker doc types, or RTO/RPO invented.

## What this agent can do next without inventing policy

- Keep fail-closed guards: SAMPLE_LAB / SIMULATED refused in PRODUCTION/UAT/PREPROD  
- Hold tests that assert “not ready” until human-authorized env/credentials exist  
- Recommend G6 only after holds 4–6 and 8–9 clear; **never self-issue**

## Explicit non-claims

CERTIFIED=false · G6=false · g6_issued=false · self_certified=false · production DigiLocker=false · G5 evidence=false · UX4G evidence=false · resilience evidence=false
