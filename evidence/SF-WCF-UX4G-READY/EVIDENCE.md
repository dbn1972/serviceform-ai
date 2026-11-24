# World-class forms WS3 — UX4G READY evidence (forms surfaces + shared UX4G layer)

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · `SF_M10_UX4G_READY` not set  
**Branch:** `cursor/ux4g-ready-forms-harness-5639` · **Code under test:** `code-sha.txt`  
**Owner bind:** SF-15 (UX4G READY) stays with the owner; this pack recommends, it does not bind.  
**Base:** `main` `7e09e6c5` · **PR:** [#275](https://github.com/dbn1972/serviceform-ai/pull/275)  
**Agent:** Cursor cloud agent, Claude Opus 5.5 (builder evidence; independent reviewer/CI decide).

## Environment

Ubuntu 24.04 (noble) · Node 22.23.4 · pnpm 10.28.0 · Playwright 1.63.0 with bundled Chrome Headless
Shell 153.0.8010.12 · `fonts-noto-core` 20201225-2 · Python 3.12.3. CI job `ux4g-forms` runs the same
stack on `ubuntu-24.04`.

## What landed

| Area | Change |
|---|---|
| Token gate | `scripts/gates/ux4g_token_gate.py` (registered in `run_all.py`, 10 self-tests). Audits the ServiceForm-authored layer of `styles.css` (after `@serviceform-authored`) for raw spacing/type/radius/elevation/border/outline/z/opacity/motion values, dimension literals equal to a UX4G size token, colours, undefined `var()` tokens and ad-hoc custom properties; audits first-party `className` vocabulary, UX4G button size pairing and inline styles. Writes `ux4g-token-audit.json`. Owner-tagged known findings in `scripts/gates/baselines/ux4g-known-findings.yaml` (keyed by `rule`, `path`, `class_name`) warn; new findings fail. |
| Ad-hoc CSS removed | 96 raw design values in the authored layer replaced by UX4G tokens (68 exact-equivalent size/container tokens, 28 semantic fixes incl. 3 hard-coded `#fff`). 2 declarations exempt with reasons. 30 layout literals with no UX4G token recorded as INFO. |
| Invented UX4G classes | 113 class occurrences not defined anywhere (e.g. `ux4g-btn-fill-primary`, `ux4g-link`, `ux4g-label`, `ux4g-text-link-md`) plus 21 size-less buttons and 1 inline style. Fixed in shared UI, officer and admin; `sf-stack`/`sf-list` defined once in the shared layer. Studio fixed by WS2 ([#276](https://github.com/dbn1972/serviceform-ai/pull/276), fix `77824918`), citizen by WS1 ([#274](https://github.com/dbn1972/serviceform-ai/pull/274)). |
| Forms harness | `packages/ui-ux4g/gallery` (8 scenes of the shared `Ux4gFormLayout`/`Ux4gFormReview` renderer and UX4G form primitives in the citizen Card frame and the Studio preview frame) pre-rendered under Vitest; `tests/ux4g/forms` Playwright suite; `tests/ux4g/helpers/a11y.ts` reusable probes; `pnpm ux4g:forms`; CI job `ux4g-forms`. |
| Contrast + inventory | `packages/ui-ux4g/test/token-conformance.test.ts`: every Figma-inventory class exists; WCAG AA matrix for form text (4.5:1) and field/error/success/warning/focus boundaries (3:1). |

## Defects the harness found in the shared layer (fixed here)

| # | Defect | WCAG | Fix (authored layer of `styles.css`) |
|---|---|---|---|
| D1 | Radio-group and checkbox error/helper text was `display:none` (vendored helpers only show inside `.ux4g-input-{state}`) — sighted users never saw "Select a gender" or the declaration error, in citizen apply and Studio preview | 3.3.1 | helpers inside `fieldset.ux4g-radio` / `.sf-form-check` stay visible |
| D2 | Hints inside UX4G Cards took `.ux4g-card-body p` colour, so the citizen runtime and Studio preview differed | preview = runtime | hints keep `--ux4g-text-neutral-tertiary` at equal specificity; state colours still win |
| D3 | Checkbox/radio error text rendered black inside Cards | 1.4.1, 3.3.1 | `--ux4g-text-status-error`, scoped above the card rule |
| D4 | Fixed `.ux4g-input` heights clipped selects and the `+91` prefix at 200% text | 1.4.4, 1.4.12 | `height:auto` + per-size `min-height` tokens (100% layout unchanged) |
| D5 | Warning field boundary `--ux4g-border-color-warning-strong` = 2.38:1 | 1.4.11 | `--ux4g-color-orange-700` (3.56:1) |
| D6 | Filled danger button text 4.38:1 on `--ux4g-bg-error-strong` | 1.4.3 | `--ux4g-color-red-700` (6.29:1), hover red-800 |
| D7 | Switch boundary and checkbox/radio/switch focus vanished under forced colours (box-shadow only) | 1.4.11, 2.4.7 | `@media (forced-colors: active)` system-colour borders/outlines |
| D8 | `TextLink` and the Figma inventory used non-existent `ux4g-text-link-md` | — | `ux4g-text-link-m`; unit test locks it |

## Executed checks

| Check | Result | Log |
|---|---|---|
| `pnpm ux4g:forms` (Playwright, bundled Chromium) | **94 passed, 0 failed, 0 flaky**; plus 8 Vitest scene renders | `playwright-forms.log`, `playwright-forms-summary.json`, `junit/` |
| — axe WCAG 2.2 A/AA (`wcag2a/2aa/21a/21aa/22aa`), 8 scenes × 320/1280 | 16/16, 0 violations | |
| — reflow 320 px, 200% text resize, WCAG 1.4.12 text spacing (no h-scroll, no clipped text) | 24/24 | |
| — focus visible on every tab stop + not obscured (pixel diff focused vs blurred) | 8/8 + forced-colours 1/1 | |
| — forced colours: every control keeps a boundary | 8/8 | |
| — invalid fields named + described by visible error | 5/5 | |
| — keyboard: tab order = reading order, skip link, radio arrows, Space toggles, disabled skipped | 5/5 | |
| — accessible names, hint/error descriptions, optional/required | 3/3 | |
| — preview = runtime computed-style parity (Studio preview vs citizen Card) | 1/1 | |
| — token-lock snapshot + 20 visual baselines (18 scenes×viewports, 2 forced colours) | 21/21 | `tests/ux4g/forms/snapshots/` |
| — probe self-tests (each probe fails on a seeded violation) | 2/2 | |
| Determinism: two further runs without updating snapshots | 94/94 both (pre-rewrite commit; UI and test tree identical) | |
| Lock bites: one border token changed (neutral-500 → 300) | 14 visual/token tests failed (~1% px), reverted (pre-rewrite commit) | |
| `python3 -m pytest scripts/gates/tests` | 40 passed | `gate-selftests.log` |
| `run_all.py` on this branch alone | 10/11; `ux4g-tokens` 12 errors = Studio items fixed by #276, not yet on main | `gates-run-all.log`, `ux4g-token-audit-branch.json` |
| `run_all.py` on local merge branch + #276 `adc4ad88` + #274 `e1f16fec` | **11/11, `ux4g-tokens` 0 errors** | `gates-run-all-merged-ws1-ws2.log`, `ux4g-token-audit-merged-ws1-ws2.json`, `merged-state.txt` |
| `pnpm test` (all workspaces) | 400 files, 4798 tests passed | `vitest-unit-summary.log` |
| `vitest packages/ui-ux4g/test` | 75 passed | `vitest-ui-ux4g.log` |
| typecheck `ui-ux4g`, `web-officer`, `web-admin`; ESLint + Prettier on touched paths | PASS | |
| `next build` web-officer (CSS through the production pipeline) | compiled, 12/12 pages | `build-web-officer.log` |
| gitleaks v8.30.1 `git` mode, repo `.gitleaks.toml`, `origin/main..HEAD` | no leaks | |
| gitleaks v8.30.1 on a fresh clone of every remote branch (752 commits, as CI `fetch-depth: 0`) | no leaks; pre-rewrite commits absent | |

## specs/design-system.yaml required_evidence (forms surfaces)

| Required | Status |
|---|---|
| storybook_build | GAP — gallery is a static example set, not Storybook |
| component_tests | PASS (ui-ux4g 75 unit tests; gallery scenes) |
| keyboard_tests | PASS at component level; journey level stays with SF-M10-005 suite |
| automated_accessibility | PASS (axe WCAG 2.2 AA, 16 runs, 0 violations) |
| contrast_token_checks | PASS (`token-conformance.test.ts`) |
| responsive_reflow_200_percent | PASS (320 px reflow, 200% text, 1.4.12 spacing) |
| multilingual_truncation | PARTIAL — Devanagari + long content; other scripts not yet |
| visual_regression | PASS for gallery (CI-gated); SF-M10-005 journey baselines exist but are not CI-gated |
| figma_code_inventory | code side PASS; Figma parity needs the design kit (human) |
| manual_screen_reader_smoke_for_release_critical_journeys | NOT DONE — human NVDA/VoiceOver/TalkBack session required |

## Open items (not this workstream)

- Merge order: [#276](https://github.com/dbn1972/serviceform-ai/pull/276) and [#274](https://github.com/dbn1972/serviceform-ai/pull/274) before this PR; then drop the 18 citizen baseline entries and the duplicate `.sf-stack`, and re-point the gallery Studio-preview scene at #276's new frame (`sf-wizard` + Card in the device frame).
- WS2: `--ux4g-border-color-warning-strong` (2.38:1) is still used for the workflow rule-gate diamond stroke and the rules-table warn accent.
- D1–D4 change citizen apply visuals; SF-M10-005 journey baselines need a reviewed refresh on next run.
- `next build` reports a Next.js security advisory for the pinned 16.4.3 (exit 1 on the first run, clean on retry, both times). Upgrading is an owner release change; not done here.
- `packages/service-templates/test/catalogue.test.ts` rewrites a committed lab fixture (`IND-AGR-010.json`) on every `pnpm test`; restored, not committed.

## Secret-scan history rewrite

The first push used `token:` as the baseline/audit key with class names as values; gitleaks
`generic-api-key` flagged them (8 hits) and, because `security.yml` scans every fetched ref, failed
other open PRs. The key is now `class_name` in the baseline and `subject` in gate findings and audit
JSON; branch history was rewritten (soft reset to the merge base, three clean commits, rebase onto
`7e09e6c5`, `--force-with-lease`), so no reachable commit carries the old keys.

## Recommendation

**RECOMMEND READY** for the shared UX4G forms layer (citizen apply renderer, Studio preview renderer,
UX4G form primitives) once CI is green on this PR after WS2 and #274 merge (jobs `architecture gates`
and `ux4g-forms`). Conditions: owner SF-15 bind; manual screen-reader smoke and Figma parity remain
human; G6 still needs journey-level UX4G evidence across citizen web, mobile and officer workbench.
No self-certification.
