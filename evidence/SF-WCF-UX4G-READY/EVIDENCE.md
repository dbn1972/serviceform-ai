# World-class forms WS3 — UX4G READY evidence (forms surfaces + shared UX4G layer)

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · `SF_M10_UX4G_READY` not set  
**Branch:** `cursor/ux4g-ready-forms-harness-5639` · **Code under test:** `code-sha.txt`  
**Base:** `main` `0d7d62a2` (includes #274, #277, #276, #270, #278) · **PR:** [#275](https://github.com/dbn1972/serviceform-ai/pull/275)  
**Owner bind:** SF-15 (UX4G READY) stays with the owner; this pack recommends, it does not bind.  
**Agent:** Cursor cloud agent, Claude Opus 5.5 (builder evidence; independent reviewer/CI decide).

## Environment

Ubuntu 24.04 (noble) · Node 22.23.4 · pnpm 10.28.0 · Playwright 1.63.0 with bundled Chrome Headless
Shell 153.0.8010.12 · `fonts-noto-core` 20201225-2 plus the fonts `playwright install-deps chromium`
adds (FreeFont, IPA, TLWG, Unifont, WQY Zen Hei) · Python 3.12.3. CI job `ux4g-forms` runs the same
stack on `ubuntu-24.04`; baselines rendered here are byte-identical to the CI render.

## What landed

| Area | Change |
|---|---|
| Token gate | `scripts/gates/ux4g_token_gate.py` (registered in `run_all.py`, 10 self-tests). Audits the ServiceForm-authored layer of `styles.css` (after `@serviceform-authored`) for raw spacing/type/radius/elevation/border/outline/z/opacity/motion values, dimension literals equal to a UX4G size token, colours, undefined `var()` tokens and ad-hoc custom properties; audits first-party `className` vocabulary, UX4G button size pairing and inline styles. Writes `ux4g-token-audit.json`. Known-findings baseline (`rule`, `path`, `class_name`) is now empty. |
| Ad-hoc CSS removed | 96 raw design values in the authored layer replaced by UX4G tokens (68 exact-equivalent, 28 semantic incl. 3 hard-coded `#fff`), plus 16 values introduced by #277 tokenised on rebase. 4 declarations exempt with reasons; 39 layout literals with no UX4G token recorded as INFO. |
| Invented UX4G classes | 113 undefined class uses (e.g. `ux4g-btn-fill-primary`, `ux4g-link`, `ux4g-label`, `ux4g-text-link-md`), 21 size-less buttons and 1 inline style. Fixed here in shared UI, officer and admin; Studio by WS2 ([#276](https://github.com/dbn1972/serviceform-ai/pull/276)), citizen by WS1 ([#274](https://github.com/dbn1972/serviceform-ai/pull/274)). |
| Forms harness | `packages/ui-ux4g/gallery`: 8 scenes of the shared `Ux4gFormLayout`/`Ux4gFormReview` renderer, `Ux4gFormStepper` and UX4G form primitives, in the citizen wizard frame (#277) and the Studio preview frame (#278), pre-rendered under Vitest; `tests/ux4g/forms` Playwright suite; `tests/ux4g/helpers/a11y.ts` reusable probes; `pnpm ux4g:forms`; CI job `ux4g-forms`. |
| Contrast + inventory | `packages/ui-ux4g/test/token-conformance.test.ts`: every Figma-inventory class exists; WCAG AA matrix for form text (4.5:1) and field/error/success/warning/focus boundaries (3:1). |

## Defects found

| # | Defect | WCAG | Resolution |
|---|---|---|---|
| D1 | Radio-group and checkbox error/helper text was `display:none` (vendored helpers only show inside `.ux4g-input-{state}`) | 3.3.1 | Fixed here: helpers inside `fieldset.ux4g-radio` / `.sf-form-check` stay visible |
| D2 | Hints inside UX4G Cards took `.ux4g-card-body p` colour | preview = runtime | Fixed here: hints keep `--ux4g-text-neutral-tertiary`; state colours still win |
| D3 | Checkbox/radio error text rendered black inside Cards | 1.4.1, 3.3.1 | Fixed here: `--ux4g-text-status-error` above the card rule |
| D4 | Fixed `.ux4g-input` heights clipped selects and the `+91` prefix at 200% text | 1.4.4, 1.4.12 | Fixed here: `height:auto` + per-size `min-height` tokens |
| D5 | Warning field boundary `--ux4g-border-color-warning-strong` = 2.38:1 | 1.4.11 | Fixed here: `--ux4g-color-orange-700` (3.56:1) |
| D6 | Filled danger button text 4.38:1 | 1.4.3 | Fixed here: `--ux4g-color-red-700` (6.29:1), hover red-800 |
| D7 | Switch boundary and checkbox/radio/switch focus vanished under forced colours | 1.4.11, 2.4.7 | Fixed here: `@media (forced-colors: active)` system-colour borders/outlines |
| D8 | `TextLink` and the Figma inventory used non-existent `ux4g-text-link-md` | — | Fixed here: `ux4g-text-link-m` (`main` still has `-md` until this merges); test locks it |
| D9 | Studio preview inside a Card rendered form text one step smaller than the #277 citizen runtime (labels 12 vs 14 px, inputs 14 vs 16 px) | preview = runtime | Found by the parity check; fixed by WS2 in [#278](https://github.com/dbn1972/serviceform-ai/pull/278) |
| D10 | #277 and #278 added 22 raw design values to the authored layer | DESIGN-SYSTEM rule 3 | #277's 16 tokenised here; #278's 6 tokenised by WS2 after the gate flagged them |

## Executed checks (code SHA in `code-sha.txt`)

| Check | Result | Log |
|---|---|---|
| `pnpm ux4g:forms` (Playwright, bundled Chromium) | **93 passed, 0 failed, 0 flaky**; plus 8 Vitest scene renders | `playwright-forms.log`, `playwright-forms-summary.json`, `junit/` |
| — axe WCAG 2.2 A/AA (`wcag2a/2aa/21a/21aa/22aa`), 8 scenes × 320/1280 | 16/16, 0 violations | |
| — reflow 320 px, 200% text resize, WCAG 1.4.12 text spacing (no h-scroll, no clipped text) | 24/24 | |
| — focus visible on every tab stop + not obscured (pixel diff focused vs blurred) | 8/8 + forced-colours 1/1 | |
| — forced colours: every control keeps a boundary | 8/8 | |
| — invalid fields named + described by visible error | 4/4 | |
| — keyboard: tab order = reading order, skip link, radio arrows, Space toggles, disabled skipped | 5/5 | |
| — accessible names, hint/error descriptions, optional/required | 3/3 | |
| — preview = runtime computed-style parity (Studio preview step panel vs citizen step panel) | 1/1 | |
| — token-lock snapshot + 20 visual baselines (18 scenes×viewports, 2 forced colours) | 21/21 | `tests/ux4g/forms/snapshots/` |
| — probe self-tests (each probe fails on a seeded violation) | 2/2 | |
| Determinism: two further runs without updating snapshots | 93/93 both | |
| Earlier CI evidence: `ed4e97f1` 91/94 (Devanagari fell back to FreeSans on the runner) → baselines regenerated in the CI font set, byte-identical to the CI actuals; `e152d22c` `ux4g-forms` green on CI | | |
| Lock bites: one border token changed (neutral-500 → 300) | 14 visual/token tests failed (~1% px), reverted | |
| `python3 -m pytest scripts/gates/tests` | 40 passed | `gate-selftests.log` |
| `run_all.py` | **11/11**; `ux4g-tokens` 0 errors, 0 warnings | `gates-run-all.log`, `ux4g-token-audit-branch.json` |
| `pnpm test` (all workspaces) | 406 files, 4867 tests passed | `vitest-unit-summary.log` |
| `vitest packages/ui-ux4g/test` | 82 passed | `vitest-ui-ux4g.log` |
| typecheck `ui-ux4g`, `web-officer`, `web-admin`; ESLint + Prettier on touched paths | PASS | |
| `next build` web-officer (CSS through the production pipeline) | compiled, 12/12 pages | `build-web-officer.log` |
| gitleaks v8.30.1 `git` mode, repo `.gitleaks.toml`, `origin/main..HEAD` | no leaks | |

## specs/design-system.yaml required_evidence (forms surfaces)

| Required | Status |
|---|---|
| storybook_build | GAP — gallery is a static example set, not Storybook |
| component_tests | PASS (ui-ux4g 82 unit tests; gallery scenes) |
| keyboard_tests | PASS at component level; journey level stays with SF-M10-005 suite |
| automated_accessibility | PASS (axe WCAG 2.2 AA, 16 runs, 0 violations) |
| contrast_token_checks | PASS (`token-conformance.test.ts`) |
| responsive_reflow_200_percent | PASS (320 px reflow, 200% text, 1.4.12 spacing) |
| multilingual_truncation | PARTIAL — Devanagari + long content; other scripts not yet |
| visual_regression | PASS for gallery (CI-gated); SF-M10-005 journey baselines exist but are not CI-gated |
| figma_code_inventory | code side PASS; Figma parity needs the design kit (human) |
| manual_screen_reader_smoke_for_release_critical_journeys | NOT DONE — human NVDA/VoiceOver/TalkBack session required |

## Open items (not this workstream)

- WS2: `--ux4g-border-color-warning-strong` (2.38:1) is still used for the workflow rule-gate diamond stroke and the rules-table warn accent.
- SF-M10-005 journey baselines predate D1–D4, #277 and #278; they need a reviewed refresh on next run.
- Design-system owner (ADR): `--ux4g-font-family-base` names no Indic family and webfonts are not embedded, so Devanagari falls back to whatever the OS prefers (FreeSans on the reference runner).
- `next build` reports a Next.js security advisory for the pinned 16.4.3 (exit 1 on a first run, clean on retry). Upgrading is an owner release change; out of scope.
- `packages/service-templates/test/catalogue.test.ts` rewrites a committed lab fixture (`IND-AGR-010.json`) on every `pnpm test`; restored, not committed.

## Secret-scan history rewrite

The first push used `token:` as the baseline/audit key with class names as values; gitleaks
`generic-api-key` flagged them (8 hits) and, because `security.yml` scans every fetched ref, failed
other open PRs. The key is now `class_name` in the baseline and `subject` in gate findings and audit
JSON; branch history was rewritten and force-pushed with lease, so no reachable commit carries the
old keys (verified on a fresh clone of every remote branch).

## Recommendation

**RECOMMEND READY** for the shared UX4G forms layer (citizen apply renderer, Studio preview renderer,
`Ux4gFormStepper`, UX4G form primitives) once CI is green on this PR (jobs `architecture gates`,
`CMP-055 additive gates` and `ux4g-forms`). Conditions: owner SF-15 bind; manual screen-reader smoke
and Figma parity remain human; G6 still needs journey-level UX4G evidence across citizen web,
mobile and officer workbench. No self-certification.
