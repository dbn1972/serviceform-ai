# P8-4 — UX4G journey accessibility evidence and SF-15 bind prep

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · `SF_M10_UX4G_READY` **unset** · SF-15 unbound
**Branch:** `cursor/path8-a11y-journey-bind-prep-13c4` · **Code under test:** `code-sha.txt`
**Base:** `main` `dd3ddbc4` (#281, after #279 and #280) · DigiLocker out of scope; OTP/DigiLocker SIMULATED; SAMPLE_LAB synthetic data
**Owner packet:** `docs/verification/SF-15-UX4G-READY-BIND-PREP.md` · human script
`docs/verification/UX4G-SCREEN-READER-SMOKE-CHECKLIST.md`
**Agent:** Cursor cloud agent, Claude Opus 5.5 (builder evidence; independent reviewer and CI decide).

## Environment

Ubuntu 24.04 · Node 22.23.4 · pnpm 10.28.0 · Playwright 1.63.0, bundled Chrome Headless Shell
153.0.8010.12 · PostgreSQL 16 (fresh database per run) · OPA 1.21.1 · Temporal dev server via
`scripts/dev/platform-lab.sh up` · `fonts-noto-core`. Same stack as the CI `ui-smoke` and
`ux4g-forms` jobs.

## What landed

| Area | Change |
|---|---|
| Journey suite | `tests/e2e/a11y-ux4g-forms-journey.spec.ts`, 11 tests in CI job `ui-smoke`. 19 live screens across citizen apply (IND-SOC-002), Studio designer/preview and officer queue/review |
| Probe battery per screen | axe WCAG 2.2 A/AA at 1280 and 320 px · heading outline · focus visible and not obscured on every tab stop · forced colours: boundaries and focus on every tab stop · 320 px reflow · 200% text · WCAG 1.4.12 text spacing · invalid-field wiring. Records screenshots, ARIA snapshot, live regions and reduced-motion offenders |
| Keyboard-only journeys | Citizen: OTP sign-in, every step, stepper back, error summary to field, file chooser opened with Space, declaration with Space, submit with Enter. Studio: open template, tab list by arrow keys, preview error summary to field. Officer: Approve reachable by Tab |
| Shared probes | `tests/ux4g/helpers/a11y.ts`: focus walk starts at the document top and stops on a revisited control; `headingOutline`, `liveRegions`, `motionUnderReducedMotion`; `applyTextSpacing` returns its tag so callers can undo it |
| Gallery harness | `tests/ux4g/forms`: forced-colours focus check on every scene (was the `controls` scene only) |
| Defect fix | `packages/ui-ux4g/src/styles.css`: stepper focus outline under forced colours (F-1) |
| Owner packet | SF-15 bind-prep packet and screen-reader checklist under `docs/verification/`; OB-09 links them |

## Defect found and fixed

| ID | Defect | WCAG | Found by | Fix |
|---|---|---|---|---|
| F-1 | `Ux4gFormStepper` buttons had no focus indicator under forced colours: the ring is a box-shadow and `outline: 0`. Every citizen step and the Studio preview | 2.4.7 | Journey forced-colours focus probe (7 screens), then the extended gallery check (7 of 8 scenes) | System `Highlight` outline in the forced-colours block. `stepper-forced-colors-focus-{before,after}.png` (before = the new rule overridden) |

Before-fix runs: `journey-before-fix.log` (7 failed, all F-1) and `forms-harness-before-fix.log`
(7 failed, all F-1). After: all pass.

## Executed checks (code SHA in `code-sha.txt`)

| Check | Result | Log |
|---|---|---|
| `pnpm e2e` on a fresh database (whole `ui-smoke` suite incl. the journey spec) | **128 passed, 0 failed** (3.0 min) | `e2e-full-ui-smoke.log`, `junit/e2e.xml` |
| — journey spec, 19 screens | 11/11 tests; 0 findings on every screen | `journey/*.json` |
| — axe WCAG 2.2 A/AA | 38 runs (19 × 2 widths), 0 violations | |
| — focus walks | 512 tab stops normal + 512 forced colours; 0 invisible, 0 obscured | |
| — reflow / 200% text / text spacing | 57 checks, no horizontal scroll, no clipped text | |
| Journey spec stability, `--repeat-each=3`, fresh database | 33/33, 0 flaky | `journey-repeat-3.log` |
| `pnpm ux4g:forms` (gallery) | **100 passed** (93 before; +8 forced-colours focus, −1 folded) | `forms-harness-after-fix.log`, `junit/ux4g-forms.xml` |
| Visual baselines (gallery) | unchanged by the fix | |
| `run_all.py` | 11/11; `ux4g-tokens` 0 errors, 0 warnings | `gates-run-all.log` |
| `pytest scripts/gates/tests` | 40 passed | `gate-selftests.log` |
| `vitest packages/ui-ux4g/test` | 82 passed | `vitest-ui-ux4g.log` |
| `pnpm lint` (whole repo), Prettier on touched files | PASS | |

Journey JSON per screen lists `tab_stops`, `focus_walk_truncated` (Studio forms list capped at 60
stops; it lists 214 uniform template links), findings, live regions and informational reduced-motion
offenders. `journey/*.aria.yml` is the accessibility tree a screen reader reads, for the human
checklist (the Studio designer snapshot is left out: its form-key field value trips the gitleaks
`generic-api-key` rule; CI's artifact has it). `screens/` holds 48 of the 57 captures (citizen, Studio preview, officer queue),
quantised to 128 colours to keep the pack small; CI uploads the full set as `e2e-results`
(`test-results/e2e/ux4g-journey/`) on every run.

## Harness stability

One full run flagged `color-contrast` on the Studio preview's primary button on the review step:
the button switches from outline to filled when the last step opens and UX4G transitions colour
for 150 ms, so axe sampled mid-transition (`e2e-transition-flake-before-settle.log`). The steady
hover colour (`primary-700`) has more contrast than the default. The journey now waits for every
finite CSS transition/animation before probing; stability was then checked with `--repeat-each=3`
(`journey-repeat-3.log`).

## Test-isolation finding (not UX4G)

`studio-forms-designer`, `studio-rules-designer` and `studio-workflow-designer` e2e specs publish
test bindings on the live `IND-SOC-002` offering with synthetic form pins
(`sample-lab-e2e.form.*`). After they run, every Residence draft or submit on that database fails
with SF-FORM-001 "Form/schema version unavailable". Reproduced twice here (journey spec run after
them: 3–4 failures, all SF-FORM-001). The journey spec file name sorts first so CI queues it before
those specs. Fix belongs in the Studio specs (publish on a lab-only offering).

## specs/design-system.yaml required_evidence

See the matrix in `docs/verification/SF-15-UX4G-READY-BIND-PREP.md` §3. New here: keyboard,
automated accessibility, reflow/200%/spacing and forced colours at journey level for citizen web,
Studio preview and officer queue/review. Still human: screen-reader smoke, Figma parity. Still
gaps or owner calls: Storybook, multilingual journey, Indic webfont, journey visual baselines in CI,
Flutter mobile.

## Recommendation

Journey-level automated evidence for the forms surfaces is complete and CI-gated. **Recommend the
owner take the SF-15 decision** once the screen-reader checklist and Figma parity are done. No
self-certification; the flag stays unset.
