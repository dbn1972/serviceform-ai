# SF-P8-CITIZEN — Path-to-8 P8-2 citizen apply polish (D1)

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · SAMPLE_LAB · OTP / Payment / SMS **SIMULATED** · DigiLocker **out of scope (untouched)** · synthetic data only
**Branch:** `cursor/path-to-8-citizen-polish-f368` · **Code SHA:** see `code-sha.txt` · **Base:** `main` `4f7ff354` (#282, includes #279–#281)
**Scope:** SAMPLE_LAB citizen apply wizard and status page (`apps/web-citizen`) and the shared UX4G form renderer (`packages/ui-ux4g`: stepper, form model, gallery, stylesheet). No published form metadata, frozen contract, CMP service, policy, Studio canvas or officer desk changed.

## What landed

| Area | Change |
|---|---|
| Progress | `formProgress` (required, visible answers on answer steps that pass their checks) shown in the `form-wizard-stepper` extension as text plus a native `<progress>` (no inline style). Honest: a prefilled evidence reference counts only once CMP-013 technically accepted an upload |
| Error recovery | After a refused submit, every other step that still holds a problem is flagged "Needs attention" (alert icon, text, AT state) until fixed; failed autosave shows an alert and **Try saving again**; field-error and summary entrance motion |
| Faster path / hierarchy | Compact apply header (facts as tags, one h1); trust note moved under the step's questions; Back next to the primary action; continue arrow |
| Phone | Compact two-row sticky action bar in the thumb zone (48 px primary); first question on the first screen at 390×844; phone progress row; review answers stacked under their questions; `scroll-padding-bottom` + a focus handler keep a focused field fully clear of the bar |
| Motion | Step slide (forward/back), progress fill, stepper markers, save tick, upload zone, confirmation mark — UX4G `--ux4g-duration-*` and timing tokens, only under `prefers-reduced-motion: no-preference`, transform-only for text |
| Confirmation | One-off "Application submitted" / "Application received" (fee due) panel with reference and next steps, focused on arrival; in-memory hand-off only (no browser storage); never a decision |

## Executed checks (local SAMPLE_LAB host: PostgreSQL 16.15 + OPA 1.21.1 + Temporal CLI 1.5.0, fresh `serviceform_lab` per e2e run; Ubuntu 24.04 + fonts-noto-core + Playwright Chromium 1243)

| Check | Result | File |
|---|---|---|
| `pnpm format:check` | PASS | `logs/format.log` |
| `pnpm lint` | PASS (0 warnings) | `logs/lint.log` |
| `pnpm typecheck` | PASS | `logs/typecheck.log` |
| `pnpm test:coverage` | 411 files · **4930 PASS** | `logs/unit-summary.log` |
| P8-2 unit (renderer progress/attention, form model, confirmation, compact header, no browser storage) | 11 new, PASS | `junit/unit.xml` |
| `pnpm test:cdc` (incl. Studio preview = CMP-009 runtime) | 6 files · **480 PASS** | `logs/cdc.log` |
| `python3 scripts/gates/run_all.py` | 11/11 PASS (incl. `ux4g-tokens` 0/0) | `logs/gates.log` |
| `pnpm deps:graph` | 0 violations | `logs/deps.log` |
| `pnpm ux4g:forms` (axe 2.2 AA, reflow, 200 %, text spacing, focus, forced colours, token lock, preview = runtime, visual) | **93/93 PASS** | `junit/ux4g-forms.xml`, `logs/ux4g-forms.log` |
| `pnpm e2e` full suite (golden Residence, journey, Studio, catalogue, WS1, P8-2) | **125/125 PASS** | `junit/e2e-full.xml`, `logs/e2e-full.log` |
| `citizen-form-polish` + `citizen-form-ux` `--repeat-each=3 --workers=2` | **48/48 PASS** | `junit/e2e-repeat.xml` |

**Rebase onto `4f7ff354` (#282):** the rows above ran on code `4c78ec5a` (base `dd3ddbc4`). The rebased tree (`code-sha.txt`) is byte-identical to a merge of that tip with #282's head `c3e16d14`, which equals what `main` merged. On that exact tree, the UX4G harness with #282's new probes passed 100/100 (`logs/rebase-ux4g-forms-with-282.log`). #282's journey a11y spec plus both citizen specs passed 27/27 on a fresh lab (`logs/rebase-journey-and-citizen-e2e-with-282.log`). CI on the PR head runs the full suites.

Visual baselines: 16 scenes whose shared wizard chrome changed were regenerated (15 in the first commit, `form-review-320` after stacking review answers). Before regenerating, unmodified `main` reproduced all 21 baselines on this machine, so it matches the CI reference environment.

New e2e (`tests/e2e/citizen-form-polish.spec.ts`, 8): honest progress (evidence counts only after upload; clearing an answer lowers it); phone 390×844 first question above the sticky bar, bar pinned to the bottom, primary ≥ 44 px; keyboard focus never under the bar on a phone (WCAG 2.4.11); refused submit flags the other broken step until fixed; failed autosave → retry → saved, answers kept; confirmation focused with the reference, gone after reload; reduced motion removes step animation and transitions. axe WCAG 2.1 A/AA on each state.

## First-screen measurements (`measurements.json`)

| Viewport | Before (`main` `bdafbcde`) | After |
|---|---|---|
| 1280×800 | Name field half under the action bar; nothing else | 8 controls fully visible (name, date of birth, mobile, 5 gender options) |
| 390×844 | No form field and no step heading on the first screen | Step heading and the first question fully visible above the action bar |
| 360×740 | No form field | First question still below the bar: the shared app-shell header is 191 px (finding 1) |

## Findings for other owners (not fixed here)

1. **App shell on phones:** the shared header wraps to three rows (191 px at 390 px). A UX4G header menu disclosure would bring the first question onto smaller phones too. Shell, not form renderer.
2. **Lab state pollution (WS1 finding 1, reconfirmed):** after one full e2e run on a reused lab DB, new drafts are refused ("Form/schema version unavailable"). The Studio specs also rewrite `fixtures/lab/platform/tenant-overlays/…/IND-AGR-010.json` on local runs. CI is unaffected (fresh DB per run).
3. **Next.js 16.4.3:** `next build` still aborts once per app with the security notice; a retry succeeds (WS1 finding 2).
4. **Studio preview chrome (P8-3):** the citizen action bar now groups save state + "Save and come back later" at the start and Back + primary at the end. `DesignerPreview` keeps its own grouping; form-control token parity and CDC parity are unchanged, and the `studio-preview` baselines did not move.

## Not claimed

No REAL DigiLocker / SMS / Payment. Not UX4G READY (`SF_M10_UX4G_READY` unset; manual screen-reader, non-Chromium and Figma parity remain human/EVD work). Not G6, not production. Builder evidence only — the D1 score is for the independent reviewer; **do not** claim CERTIFIED.
