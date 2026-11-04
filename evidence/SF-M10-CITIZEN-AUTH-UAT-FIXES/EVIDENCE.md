# SF-M10-CITIZEN-AUTH-UAT-FIXES — Phase A lab UAT defects D-1, D-2 (SAMPLE_LAB)

**Not CERTIFIED. G6 not issued. OTP and DigiLocker are SIMULATED. Builder evidence only.**

| Field | Value |
|---|---|
| Source commit | `cbdbb44` (fix) on `cursor/citizen-auth-uat-fixes-06e3`, base `main` `d5b3e957a48a3a8e7ebdb1c0cf20326d24b93ba8` (merge of #197) |
| Requirements | SRS-F-010 (SIMULATED OTP in non-prod), INT-001 (citizen auth → journey, lab stand-in) |
| Components | SAMPLE_LAB citizen web (`apps/web-citizen`); no platform CMP, contract or migration changed |
| Environment | Cursor cloud VM · Node 22.23.4 · `next start` production builds · Playwright chromium-headless-shell 1243 |
| Connector modes | OTP adapter SIMULATED (fixed lab code) · DigiLocker SIMULATED |

## Defects found by Phase A lab UAT on `main` `d5b3e95`

| ID | Severity | Defect | Fix |
|---|---|---|---|
| D-1 | Medium (lab) | `/login?next=%2F%09%2Fevil.example` (tab/newline variants of `//host`) passed `safeNext`; the browser strips the control character and the post-sign-in `router.push` left the portal. | `safeNext` resolves the target with `new URL` and compares the origin; returns the normalised path. |
| D-2 | Low (UX) | Sign-out from a gated page (e.g. My applications) landed on `/login?next=…` without the signed-out confirmation: `signOut` broadcast a session change and the page gate's redirect overrode `/login?signed_out=1`. Session was cleared. | `signOut` no longer broadcasts; leaving the page refreshes every session consumer. |

## Executed

| Suite | Command | Result | Log |
|---|---|---|---|
| Phase A lab UAT on `main` `d5b3e95` (before fix) | UAT script, 15 cases | **12 passed, 3 failed** (D-1 ×2, D-2) | `logs/uat-main-d5b3e95.log`, `junit/uat-main-d5b3e95.xml` |
| Phase A lab UAT on fix | same script | **15 passed** | `logs/uat-fix.log`, `junit/uat-fix.xml` |
| Unit (citizen web + lab) | `vitest run apps/web-citizen packages/m10-sample-lab` | **30 passed** (3 new `safeNext` cases) | — |
| E2E (shells + golden + citizen auth + journey) | `pnpm e2e` | **62 passed** (3 new regression tests) | `logs/e2e-all.log` |
| Flake check | `pnpm e2e tests/e2e/citizen-auth.spec.ts tests/e2e/citizen-journey.spec.ts --repeat-each=3` | **78 passed** | `logs/e2e-flake.log`, `junit/e2e-flake.xml` |
| Architecture gates | `python3 scripts/gates/run_all.py` | **10/10 passed** | `logs/gates.log` |
| Lint / typecheck | `eslint --max-warnings=0` (touched paths), `pnpm --filter @serviceform/web-citizen typecheck` | clean | — |

UAT-16 (known limitation, not fixed here): the SAMPLE_LAB session cookie is unsigned base64 JSON
(inherited from `main` before #197), and the shared lab list `GET /api/lab/applications` exposes
`citizen_id`, so the per-citizen "mine" view is not a security boundary. Lab-only; production
identity is CMP-004. Recorded for Phase B.

G6=false · CERTIFIED=false · REAL DigiLocker=false · REAL OTP/SMS=false · PRODUCTION=false · self_certified=false
