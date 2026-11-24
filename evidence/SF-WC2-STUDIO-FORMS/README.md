# SF-WC2 Evidence — Studio forms designer depth (world-class forms, Workstream 2)

**Branch:** `cursor/world-class-studio-form-designer-619d` (started on `ca244c69`; rebased onto
`main` at `44031f5f` after WS1 #277 changed the shared UX4G form runtime — parity suite re-run green)
**Model:** Claude Opus 5.5 (builder self-assessment is not evidence)
**CERTIFIED:** false | **G6:** false | **self_certified:** false | **TSB seal:** false

## Scope

Deepen the Phase C-1 Studio forms designer (#230) so officers can author fields, conditionals and
validation visually, and prove that the preview behaves like the citizen runtime (CMP-009). Studio
and the pure designer package only; the citizen app, CMP-009 and CMP-033 are unchanged.

| Item | Ids |
|---|---|
| Components | CMP-050 Studio surface, CMP-009 (consumed, unchanged), CMP-054 UX4G wrapper (designer CSS only) |
| Integration | Consumer-driven contract: Studio preview (UX4G runtime mirror) ↔ CMP-009 form runtime |
| Constitution | §1, §8, §20, §27, §28; UX4G Experience Constitution; DESIGN-SYSTEM.md rules 3, 5, 6 |

## What changed

1. **Conditions** (`packages/studio-designers/src/forms`): visibility and "required when" share one
   `Condition` shape and can compare with one value or *any of* several (CMP-009 `enum`).
   Compile/import round-trip; every catalogue version still recompiles to its recorded hash.
2. **Logic view** (`logic.ts`, Studio `Logic` tab): every rule as a sentence, logic checks, and a
   matrix of every combination of the answers rules read (bounded at 64; partial fallback),
   evaluated by the same `@serviceform/ui-ux4g` runtime mirror as the citizen wizard. "Try" opens
   the preview with that combination.
3. **New refusals found by the parity suite** (lint mirrors what would break on submit):
   - `RULE_UNREACHABLE` (error): SHOW rules that wait for each other, or a section that waits for a
     field inside itself — those fields can never be shown. `RULE_CYCLE` (advice) for HIDE loops.
   - `RULE_HIDDEN_SOURCE_BLOCKS` (error) / `RULE_HIDDEN_SOURCE` (advice): a rule reading an answer
     that can itself be hidden. The wizard evaluates rules on every answer but submits only the
     shown ones, so CMP-009 re-evaluates without that answer; a HIDE rule then makes a required
     field reappear and blocks the submission.
   - `OBJECT_SECTION_HIDDEN` (error) / `OBJECT_FIELDS_HIDDEN` (advice): hideable grouped data with
     required answers. CMP-009 reports the absent object as `REQUIRED` even when every control in
     it is hidden, so applicants who never saw it could not submit.
4. **Preview = citizen wizard chrome** (aligned with WS1's #277 citizen apply): the shared
   `Ux4gFormStepper` with "furthest reached" steps, the `sf-step-panel` header ("Step n of m"),
   review step (summary then declaration), checks when a field is left and clearing as soon as the
   answer is valid (`fieldError`), pluralised error summary whose links show the question then
   focus the field, provenance line and split action rows; plus "Check whole form", an author-only
   "Jump to step" control and a *Runtime details* table (UX4G renderer id, shown, required, current
   check per control). Preview answers survive tab switches. The phone frame mirrors the citizen's
   phone/tablet rules (token-only designer CSS).
5. **Authoring**: palette drag-and-drop now actually drops (pre-existing #230 bug: palette drags
   were `copy` while every drop zone forced `move`, so browsers cancelled them); drop fields,
   sections or palette items onto a step tab; drag sections to reorder or move across steps;
   keyboard Alt+↑/↓, Ctrl+D, Delete with a live-region announcement; "Move to" step/section;
   paste options one per line (`VALUE | Label` keeps a value); "Try a value" bench for every
   text/number/date/email field showing the exact citizen message; default error copy shown
   beside each custom message; pattern example values.
6. **WS3 UX4G gate fixes** (commit `72b73943`): `ux4g-btn-ghost` → `ux4g-btn-text-neutral`
   (Fee/SLA/Evidence), undefined `sf-designer-panel` dropped from 7 designers, ChecksPanel uses
   UX4G tonal tags instead of undefined `sf-designer-check-*`.

## Executed evidence (local, tip of this branch before push)

| Check | Result |
|---|---|
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | pass / pass (0 warnings) / pass |
| `pnpm test:coverage` | 400 files, **4784 tests pass**; lines 85.1 %, statements 81.57 %, branches 72.84 % |
| `packages/studio-designers` | 274/274 (new `forms-logic.test.ts` 23) |
| `apps/web-studio` | 40/40 (new `forms-designer-logic.test.tsx` 6) |
| `pnpm test:cdc` | 6 files, **257 tests pass**; new `studio-forms-preview-parity.cdc.test.ts` 219 |
| Parity suite detail | conditional form: 324 combinations × (drivers only, valid fill, invalid fill) = 972 datasets, interpretation **and** submission parity; every catalogue form version (215) in every logic scenario; two proofs that the new lint errors match real CMP-009 refusals |
| `python3 scripts/gates/run_all.py` | **10/10** gates |
| `pnpm deps:graph` | no violations (2370 modules) |
| `pnpm contracts:validate` | 12 contracts, 0 failures |
| Playwright (Studio only, local Chrome) | `studio-forms-designer.spec.ts`: authoring test + new WS2 test pass, axe WCAG 2.1 AA 0 violations on Logic view and preview. The publish/tamper tests need the platform host and run in CI |

Walkthrough script: `scripts/dev/capture-forms-designer-logic.mjs` (Studio on 3002 only).
Screenshots and video: Project store `media/world-class-studio-forms/`.

## Non-claims and residuals

- **SAMPLE_LAB only.** No statute invented; no AI; nothing here decides eligibility.
- Runtime fixes belong to CMP-009 / ui-ux4g owners (proposed, not done here):
  1. treat a grouped-data object whose controls are all hidden as hidden (removes
     `OBJECT_SECTION_HIDDEN`);
  2. evaluate visibility to a fixpoint (a hidden answer does not drive rules) in both CMP-009 and
     the UX4G mirror (removes `RULE_HIDDEN_SOURCE*`);
  3. the UX4G number renderer converts only whole numbers, so decimal answers are refused as
     "Enter a whole number" — the bench shows this honestly.
- Single root "required when" condition remains a CMP-009 limit (unchanged).
- Manual screen-reader smoke and visual-regression baselines are not claimed.
