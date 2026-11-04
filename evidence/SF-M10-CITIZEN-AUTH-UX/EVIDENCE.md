# SF-M10-CITIZEN-AUTH-UX — citizen sign in / create account (SAMPLE_LAB)

**Not CERTIFIED. G6 not issued. OTP and DigiLocker are SIMULATED. Builder evidence only.**

| Field | Value |
|---|---|
| Source commit | `4488ab3f145e9d817aa15c5a5f2f3edfe4f2ac71` |
| Branch | `cursor/citizen-auth-ux-9805` |
| Requirements | SRS-F-010 (SIMULATED OTP in non-prod), INT-001 (citizen auth → profile), DESIGN-SYSTEM.md rules 1–3, 6 |
| Components | CMP-054 UX4G wrapper (`@serviceform/ui-ux4g`); SAMPLE_LAB stand-in for CMP-004/CMP-005 (no service code changed) |
| Environment | Cursor cloud VM · Node 22.23.3 · `next start` production builds · Chrome via `PW_CHROMIUM_PATH` |
| Connector modes | OTP adapter SIMULATED (fixed lab code) · DigiLocker SIMULATED |
| Auth model | Passwordless mobile OTP (00_READ_FIRST: citizen auth initially mobile OTP) |

## Executed

| Suite | Command | Result | Log |
|---|---|---|---|
| Lab identity + UX4G primitives unit | `vitest run packages/m10-sample-lab packages/ui-ux4g` | **52 passed** | `logs/unit-lab-ui.log`, `junit/unit-lab-ui.xml` |
| Root unit suite | `vitest run` | **2976 passed** | `logs/unit-all.log` |
| Architecture gates | `python3 scripts/gates/run_all.py` | **10/10 passed** (design-system, no-hardcoded-jurisdictions incl.) | `logs/gates.log` |
| Web builds | `pnpm -r --filter "./apps/web-*" run build` | **4/4 compiled** | `logs/web-build.log` |
| E2E (shells + golden + citizen auth) | `pnpm e2e` | **54 passed** (17 new citizen-auth) | `logs/e2e-all.log`, `junit/e2e-all.xml` |
| Flake check | `pnpm e2e tests/e2e/citizen-auth.spec.ts tests/e2e/golden --repeat-each=3` | **102 passed** | (local run, not archived) |

### Follow-up: SAST fix `b0a4f5d`

PR CI `security / SAST (semgrep)` flagged 3 njsscan findings introduced by `4488ab3`
(`Math.random()` in two test helpers; single-character regex in `OtpInput`). Fixed without
suppressions; re-verified at `b0a4f5d68754184082af314abb129901f5f4d4c0`:

| Suite | Result | Log |
|---|---|---|
| semgrep 1.179.0, CI rulesets, touched paths | **0 findings** (reproduced 3 on the prior code) | `logs/semgrep-touched.log` |
| Lab identity + UX4G primitives unit | **52 passed** | — |
| `pnpm e2e` | **54 passed** | — |

### Follow-up: journey stitch `bd16548`

Sign-in session and design carried through the citizen journey (header account + sign-out,
gated routes with `next`, application filed under `citizen_id`, `GET ?mine=1`, wizard pre-filled
from the verified account, navy page header on home/services/overview/apply/my applications/
detail). Also fixes unstyled success/info in-form alerts. Re-verified at
`bd1654823fe93c0a79c3a5214afba6a8d8ab83f4`:

| Suite | Result | Log |
|---|---|---|
| Web builds | **4/4 compiled** | `logs/journey/web-build.log` |
| `pnpm e2e` | **59 passed** (5 new journey: gate redirect, header/sign-out, pre-fill + per-citizen list, anonymous API refusal, axe + 320 px on 6 signed-in pages) | `logs/journey/e2e-all.log`, `junit/e2e-journey.xml` |
| Root unit suite | **2985 passed** (+7 citizen helpers, +1 citizen isolation, +1 alert tones) | `logs/journey/unit-all.log` |
| Gates + semgrep (CI rulesets, touched paths) | **10/10 · 0 findings** | `logs/journey/gates-semgrep.log` |
| Flake check (journey + auth + golden × 3) | **117 passed** | (local run, not archived) |

Citizen-auth E2E covers: OTP sign-in to `next`, mobile validation, wrong OTP with attempts left,
keyboard auto-advance/backspace, verified-but-unregistered number, open-redirect guard, error
summary focus/links, registration → auto sign-in → later sign-in, duplicate account refusal,
API failure paths (non-synthetic mobile, malformed body, 5-attempt lock-out, purpose binding,
profile validation before OTP consumption), axe WCAG 2.1 A/AA on sign-in, register, OTP error,
error summary and success states, 320 px reflow.

## Screens

Agent store `media/citizen-auth-ux/index.html` (23 PNGs: 11 sign-in/sign-up states plus 12 stitched
journey screens from home to DigiLocker SIMULATED publish and sign-out).

## Known limitations

- Local builder run; CI `ui-smoke` job on the PR is the independent execution.
- No manual screen-reader smoke, visual-regression baseline or Figma parity for `OtpInput` yet
  (required before UX4G READY).
- Lab session cookie remains the pre-existing unsigned SAMPLE_LAB cookie; not production IAM.
- UI copy is English only; the Hindi option sets the update-language preference only.

## Non-claims

G6=false · CERTIFIED=false · REAL DigiLocker=false · REAL OTP/SMS=false · PRODUCTION=false · self_certified=false
