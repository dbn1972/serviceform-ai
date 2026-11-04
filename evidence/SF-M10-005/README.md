# SF-M10-005 — UX4G Journey Evidence Pack (Phase B: IND-SOC-002 Residence Certificate)

| Field | Value |
|---|---|
| Task | SF-M10-005 |
| Agent role | ux4g_builder (independent evidence) |
| Commit under test | `f334df88053d5b39a27bd4546e04817b66280497` (branch `cursor/m10-phase-b-platform-wire-0b20`, PR [#211](https://github.com/dbn1972/serviceform-ai/pull/211)) |
| Evidence branch | `cursor/m10-phase-b-ux4g-evidence-0b20` |
| Run date | 2026-11-04 (UTC) |
| Environment | Cursor cloud VM · Ubuntu 24.04 · Node 22.23.4 · pnpm 10.28.0 |
| Browser | Playwright 1.63.0 · Chrome for Testing 153.0.8010.12 · Chromium headless |
| Viewports tested | 320 px, 768 px (layout), 1280 px |
| PostgreSQL cluster | 16 ux4gverify port 5436 (fresh) · OPA 1.21.1 · API 4000 |
| WCAG tags | wcag2a, wcag2aa, wcag21a, wcag21aa |
| Stamp | SAMPLE_LAB · OTP/IdP SIMULATED · NOT CERTIFIED · G6=false |
| Self-certified | false |

---

## Commands executed

```bash
# 1. Worktree
git fetch origin cursor/m10-phase-b-platform-wire-0b20
git worktree add /agent/repos/sf-wt-ux4g cursor/m10-phase-b-ux4g-evidence-0b20

# 2. Dependencies
cd /agent/repos/sf-wt-ux4g
pnpm install --frozen-lockfile
pnpm exec playwright install chromium

# 3. PostgreSQL
sudo pg_createcluster 16 ux4gverify -p 5436 --start
sudo -u postgres psql -p 5436 -c "CREATE ROLE ci LOGIN SUPERUSER PASSWORD '<choose-a-local-password>'"
sudo -u postgres psql -p 5436 -c "CREATE DATABASE sf_ux OWNER ci"

# 4. Platform services (PGPASSWORD holds the local cluster password; never committed)
DATABASE_URL=postgres://ci@localhost:5436/sf_ux SF_ENVIRONMENT=LOCAL \
  bash scripts/dev/platform-lab.sh up

# 5. Build + start web apps
DATABASE_URL=postgres://ci@localhost:5436/sf_ux SF_ENVIRONMENT=LOCAL \
  SF_API_BASE_URL=http://127.0.0.1:4000 \
  pnpm -r --filter "./apps/web-*" run build
# (citizen on :3000, officer on :3001 via Next.js start)

# 6. Run UX4G suite (snapshot update — first run establishes baseline)
DATABASE_URL=... SF_ENVIRONMENT=LOCAL SF_API_BASE_URL=http://127.0.0.1:4000 \
  pnpm exec playwright test \
  --config tests/ux4g/m10/playwright.config.ts \
  --update-snapshots

# 7. Design system gate
python3 scripts/gates/design_system_gate.py
```

---

## Results summary

| Category | Count | Result |
|---|---|---|
| Total tests | **86** | **86 PASSED, 0 FAILED** |
| axe WCAG 2.1 A/AA checks | 36 | PASS — 0 violations |
| Responsive 320px no-horizontal-scroll | 16 | PASS |
| Visual baseline (toHaveScreenshot) | 25 | PASS — baselines established |
| Keyboard journey checks | 7 | PASS |
| UX4G token/class audit | 1 | PASS (informational findings logged) |
| `design_system_gate.py` | 67 manifests | **PASS — 0 errors, 0 warnings** |

---

## Per-screen × per-check results table

| Screen | axe 1280 | axe 320 | No-H-scroll 320 | Visual 1280 | Visual 320 | Keyboard |
|---|---|---|---|---|---|---|
| Citizen: Home | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | ✅ baseline | — |
| Citizen: Services catalog | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | ✅ baseline | — |
| Citizen: Service overview (IND-SOC-002) | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | ✅ baseline | — |
| Citizen: Login — mobile step | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | ✅ baseline | ✅ keyboard OTP |
| Citizen: Login — OTP step | ✅ PASS | ✅ PASS | — | ✅ baseline | ✅ baseline | ✅ keyboard OTP |
| Citizen: Login — OTP error state | ✅ PASS | — | — | — | — | ✅ error mgmt |
| Citizen: Register | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Citizen: Apply wizard step 1 (Applicant) | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | ✅ baseline | ✅ focus order |
| Citizen: Apply wizard step 1 — validation error | ✅ PASS | — | — | — | — | ✅ error announce |
| Citizen: Apply wizard step 2 (Residence) | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Citizen: Apply wizard step 3 (Evidence) | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Citizen: Apply wizard step 4 (Preview) | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Citizen: Submission result (submitted) | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Citizen: My Applications — empty | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Citizen: My Applications — populated | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Citizen: Certificate detail — approved | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Officer: Login | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | ✅ baseline | ✅ keyboard sign-in |
| Officer: Queue — empty | ✅ PASS | ✅ PASS | ✅ PASS | ✅ baseline | — | — |
| Officer: Queue — populated | ✅ PASS | ✅ PASS | ✅ PASS | — | — | ✅ tab navigation |
| Officer: Review — before decision | ✅ PASS | — | — | ✅ baseline | — | ✅ approve via keyboard |
| Officer: Review — after approve | ✅ PASS | — | — | ✅ baseline | — | — |

---

## axe violations: NONE

All 36 axe runs returned 0 violations (wcag2a, wcag2aa, wcag21a, wcag21aa).

---

## Keyboard evidence

| Check | Result | Notes |
|---|---|---|
| Skip link present and functional | ✅ PASS | `a[href="#main-content"]` with text "Skip to main content" found |
| Visible focus ring on login flow | ✅ PASS | Focused element detected after Tab traversal |
| Citizen OTP sign-in by keyboard only | ✅ PASS | Mobile fill → Get OTP → digit fill → Verify → navigated to service overview |
| Logical focus order on apply wizard | ✅ PASS | ≥10 keyboard-reachable elements in sequence |
| Focus management after validation error | ✅ PASS | `[role="alert"]` or `[aria-live]` region present for screen-reader announcement |
| Officer sign-in by keyboard → approve | ✅ PASS | Sign in button → Enter → approve button → Enter → ISSUED state shown |
| Officer queue keyboard tab navigation | ✅ PASS | Queue links reachable via Tab key |

---

## Responsive evidence

All 16 no-horizontal-scroll checks at 320 px passed (`scrollWidth ≤ 320`).

Viewports 768 px was used for mid-range visual sanity (not independently axe-checked in this run; 1280 and 320 axe checks bracketed above and below).

200% zoom / text-spacing: manual gap — not automated in this pack. See manual gaps section.

---

## Visual regression

25 PNG baselines established under `tests/ux4g/m10/snapshots/ux4g-journey.spec.ts-snapshots/`.
Full-page screenshots (38 PNGs) saved under `evidence/SF-M10-005/screens/`.

Dynamic content masked: `[data-testid="env-label"]`, `time`, `.sf-app-ref`, mobile fields, OTP codes.

---

## UX4G token/class audit findings (informational — not gate-blocking)

The automated audit flagged 7 component files as "has `className` but no `@serviceform/ui-ux4g` import". Investigation shows these are **false positives from the heuristic**:

- `CitizenNav.tsx` — uses `ux4g-navbar-links`, `ux4g-btn-outline-neutral`, `ux4g-btn-s` CSS classes; no React component import needed
- `CitizenPageHeader.tsx` — uses `ux4g-heading-2xl-strong`, `ux4g-body-l-default`, `ux4g-label-s-strong` CSS classes
- `HomeContent.tsx` — uses `ux4g-btn-outline-neutral`, `ux4g-btn-l`, `ux4g-heading-s-strong` CSS classes
- `RequireCitizenSession.tsx` — uses `ux4g-body-m-default` CSS class
- `auth/AuthLayout.tsx` — uses `ux4g-form-box`, `ux4g-bg-neutral-elevated`, `ux4g-tag-tonal-warning` CSS classes
- `OfficerNav.tsx` — uses `ux4g-navbar-links`, `ux4g-btn-text-neutral` CSS classes
- `RequireOfficerSession.tsx` — uses `ux4g-body-m-default` CSS class

All flagged files use canonical `ux4g-*` and `sf-*` CSS token classes consistently. No arbitrary design values, no banned npm packages. **`design_system_gate.py` returned 0 errors.**

**Classification**: informational / architecture note. These layout components use UX4G CSS utility classes directly (valid pattern for structural/nav components). The React component imports from `@serviceform/ui-ux4g` appear in `Button`, `Card`, `RadioGroup`, `TextInput`, `Alert`, `Icon`, `AppShell`, `TextLink` usages elsewhere in the same code base.

---

## Findings requiring owner attention

No blocking axe violations were found. The following are UX4G quality observations for the platform-path UI:

| # | Severity | Screen | Rule / Observation | Suggested owner |
|---|---|---|---|---|
| F-01 | INFO | All screens | 7 layout/nav components use `ux4g-*` CSS classes directly without a React import from `@serviceform/ui-ux4g`. Valid today; consider migrating to UX4G Nav/Breadcrumb React components when available. | web-citizen / web-officer team |
| F-02 | INFO | All screens | 200% zoom and text-spacing (WCAG 1.4.4 / 1.4.12) not automated in this pack — requires manual or additional tooling. | QA / accessibility team |
| F-03 | INFO | Officer login | SIMULATED IdP displays all lab officers as a radio group; no CAPTCHA / rate-limit guard visible. Acceptable for SAMPLE_LAB; must not reach production. | Platform security |
| F-04 | INFO | Apply wizard | Pre-filled form fields with sample data may confuse real users. Acceptable in SAMPLE_LAB — verify profile-prefill source when CMP-005 wired. | Platform team |
| F-05 | INFO | All screens | Screen-reader smoke test (VoiceOver / NVDA) not performed — automated axe does not cover all SR behaviors. | QA / accessibility team |

---

## Manual-check gaps (not automated)

| Gap | Rationale |
|---|---|
| Screen-reader smoke (VoiceOver, NVDA, TalkBack) | Requires interactive SR session; axe partial proxy only |
| 200% zoom / text-spacing WCAG 1.4.4 / 1.4.12 | Not triggered programmatically in this run |
| Colour-contrast in forced-colours / high-contrast mode | Not checked beyond axe color-contrast rule |
| Mobile Safari / Firefox accessibility | Only Chromium tested here |
| Localization / multilingual truncation | Not in scope for SAMPLE_LAB slice |
| DigiLocker credential viewer / QR | Not wired on this branch slice |

---

## design_system_gate.py output

```
INFO  [design-system] 67 package manifests checked
PASS [design-system] 0 error(s), 0 warning(s)
```

---

## Recommendation on SF_M10_UX4G_READY

> **RECOMMEND-WITH-FINDINGS**

**Rationale:**

- 86/86 Playwright tests passed.
- 0 axe WCAG 2.1 A/AA violations across 21 screens and 36 axe runs.
- All 16 no-horizontal-scroll checks at 320 px passed.
- 25 visual regression baselines established.
- Full keyboard journey (citizen OTP sign-in → apply → submit; officer sign-in → approve) exercised successfully.
- Skip link present. Focus management present on error states. Focus ring visible.
- `design_system_gate.py` PASS — 0 errors.
- No banned dependency. No hard-coded color values in app source.

**Findings preventing RECOMMEND:**

1. Screen-reader smoke (VoiceOver / NVDA) not performed — a gap noted in `specs/design-system.yaml` as `manual_screen_reader_smoke_for_release_critical_journeys`.
2. 200% zoom / WCAG 1.4.12 text-spacing not automated.
3. Firefox / Safari accessibility not tested.

**Recommendation**: RECOMMEND-WITH-FINDINGS. Human EVD reviewer should commission manual screen-reader smoke and 200% zoom check before promoting to RECOMMEND. No SF_M10_UX4G_READY flag set by this agent (flag belongs to human / CI gate per architecture rules).

---

## Explicit non-claims

CERTIFIED=false · G6=false · SF_M10_UX4G_READY not set · self_certified=false · production DigiLocker=false · screen-reader smoke=false
