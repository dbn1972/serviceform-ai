# SF-P8-STUDIO Evidence — Studio forms designer depth (path to 8, workstream P8-3, D2)

**Branch:** `cursor/path8-studio-depth-1774` on `main` `23973939` (#279) · code at `1c0759af`
**Model:** Claude Opus 5.5 (builder self-assessment is not evidence)
**CERTIFIED:** false | **G6:** false | **self_certified:** false | **TSB seal:** false |
**DigiLocker:** out of scope (not touched) | **SF_M10_UX4G_READY:** unset

## Scope

Deepen visual authoring in the Studio forms designer (D2): conditionals, validation UX, the field
library and preview = runtime. Studio (`apps/web-studio`) and the pure designer package
(`packages/studio-designers`) only. Every authored form still compiles to a CMP-009 FORM package;
CMP-009, CMP-033, `@serviceform/ui-ux4g` and the citizen app are unchanged. No Camunda, no second
runtime, no new CSS (existing UX4G and designer classes only), no frozen contract touched.

| Item | Ids |
|---|---|
| Components | CMP-050 Studio surface, CMP-009 (consumed, unchanged), CMP-054 UX4G (consumed) |
| Integration | Consumer-driven contract: Studio designer + preview (UX4G runtime mirror) ↔ CMP-009 runtime |
| Constitution | §1 metadata-driven, §8, §20, §27, §28, §38 semantic elements; DESIGN-SYSTEM.md rules 1–3, 6 |

## What changed

1. **Conditions** (`model.ts`, `compile.ts`, `import.ts`, `lint.ts`, `logic.ts`)
   - **"Has any answer"** visibility (SHOW/HIDE on a field or section): compiles to an empty
     CMP-009 rule schema, which both CMP-009 and the UX4G mirror read as "answered". Offered for
     visibility only: CMP-009 reads an empty root `if` differently when interpreting and when
     validating, so it is refused on requirements (`CONDITION_ANSWERED_REQUIREMENT`, error).
     Advice on tick boxes (`RULE_ANSWERED_BOOLEAN`).
   - **"Required unless"**: the root condition's `else` branch. "Required when" fields go to
     `then.required`, "required unless" fields to `else.required`; both share CMP-009's single
     root condition. Compile/import round-trip; catalogue hashes unchanged.
   - New refusal found while designing it: "required unless" on an answer that can be hidden
     blocks the application (the dropped answer flips CMP-009 to `else`) →
     `RULE_HIDDEN_SOURCE_BLOCKS` (error). The CDC suite reproduces the block.
2. **Logic tab rule builder** (`RuleBuilder.tsx`, `ops.ts`): add, replace or edit any rule from
   one place — target (field or named section), effect (show / hide / require when / require
   unless), answer and comparison (is / is any of / has any answer). Requirement rules start from
   the form's shared root condition. A preview sentence and any new blocking check appear before
   saving. Every rule in the list gets **Remove** (undoable). The Inspector gains "Required
   unless…" and a "Use that condition" fix when a requirement diverges from the shared condition.
3. **Validation UX** (`validation.ts`, Inspector, canvas)
   - Plain-language summary on every field card and in the Inspector
     ("Required · Digits only, 6 characters"); length limits a pattern already implies are hidden.
   - **Test cases**: generated inputs at every boundary (empty, pattern example, wrong character,
     one under/over each length and range bound, decimals, words, date and email shapes), each
     with the exact verdict and copy an applicant gets from the citizen runtime mirror.
   - Contradiction checks: `PATTERN_LENGTH_CONFLICT` and `NUMBER_RANGE_EMPTY` (errors: no answer
     can pass); `ERROR_MESSAGE_UNUSED` (advice: custom copy that can never show). The error-message
     editor lists only the problems a field can produce.
4. **Field library** (`palette.ts`, `library.ts`, `DesignerPalette.tsx`)
   - Palette **search** across fields and sections.
   - Presets from existing canonical builders only: father's, mother's and parent-or-guardian
     names (`SF-SEM-PERSON-*-NAME`) and the tenant-scoped "Address with LGD codes" section.
     No semantic id invented.
   - **Sections from the catalogue**: 26 distinct sections from the 215 catalogue form versions,
     most reused first (e.g. the LGD address is in 210 forms). Copies carry their own rules;
     rules on outside answers stay behind and the author is told.
   - **Duplicate section** (canvas): fields, grouped data and rules copied with unique keys, inner
     rule references remapped; inner "required when/unless" rules stay behind (single root
     condition), with a notice.
5. **Preview = runtime** (`DesignerPreview.tsx`, `form-readiness.ts`)
   - **Fill with sample answers**: synthetic SAMPLE_LAB values that satisfy every field's own
     rules; "Check whole form" then shows what the citizen gets.
   - **Ready to publish?** checklist on Publish: no blocking checks, sample answers pass the
     citizen checks, logic matrix complete, review step, declaration, canonical bindings, no
     unused messages. Advisory except "Fix"; CMP-033/CMP-009 still re-check on save and freeze.
6. **Accessibility fixes found by the new journey test**: the test-case table scroll region is
   keyboard-focusable (`scrollable-region-focusable`); the signed-out Publish alert's Session link
   is now a bordered UX4G button link (pre-existing `link-in-text-block` on `main`).

## Executed evidence (local, on `23973939` + this branch)

| Check | Result |
|---|---|
| `pnpm format:check` | pass |
| `pnpm lint` (`--max-warnings=0`) | pass |
| `pnpm typecheck` | pass |
| `pnpm test:coverage` | 409 files, **4905 tests pass**; lines 85.22 %, statements 81.73 %, functions 83.67 %, branches 73.22 % |
| Studio + designer unit | 349 pass (34 new: `packages/studio-designers/test/forms-depth.test.ts`, `apps/web-studio/test/forms-designer-depth.test.tsx`) |
| `pnpm test:cdc` | **480 pass**; Studio parity file 219 → **442** |
| `pnpm gates` | 11/11 pass (incl. UX4G token gate: 152 TSX files, 0 errors) |
| `pnpm deps:graph` | no violations |
| `pnpm contracts:validate` | 12 contracts, 0 failures |
| Playwright `studio-forms-designer.spec.ts` (Studio only) | 3/3 authoring tests pass incl. new depth journey; axe WCAG 2.1 A/AA **0 violations** on Design, Logic, Inspector test cases, Preview, Publish |

New CDC coverage in `tests/cdc/studio-forms-preview-parity.cdc.test.ts` (CMP-009 runtime as
provider):
- "Has any answer" + "required unless" form: every one of 16 logic combinations × raw / valid /
  refused fills agrees on shown, required, renderer and refused answers.
- "Required unless" on a hideable answer: the wizard accepts, CMP-009 refuses `/reason` —
  exactly the case the designer now refuses.
- Validation test cases: every case of every distinct field (palette, depth form and all
  catalogue versions) gets the same verdict from the bench mirror and from CMP-009.
- Sample answers: accepted by the citizen checks **and** CMP-009 for the palette, conditional and
  depth forms and **all 215 catalogue form versions**.
- Every catalogue library section placed in a blank form agrees in every logic scenario; a
  duplicated section keeps its own rules working under new keys.

Not run locally: the publish/tamper e2e tests (need the CMP-004/CMP-015 platform host; CI).

## Media

Store `media/path-to-8-studio/`: `01-palette-search-catalogue-sections` …
`09-publish-readiness` (PNG) and `studio-designer-depth-walkthrough.webm`, recorded with
`evidence/SF-P8-STUDIO/capture-designer-depth.mjs` against a production build of Studio.

## Residuals / non-claims

- CMP-009 still evaluates one root requirement condition; the designer guides authors to it but
  cannot lift it (CMP-009 owner).
- The citizen number box stores whole numbers only, so decimals are refused in the citizen form;
  the test cases show this honestly (ui-ux4g owner; also noted in SF-WC2).
- ENABLE/DISABLE rules are accepted by CMP-009 but not rendered by the citizen wizard, so they are
  not offered.
- Manual screen-reader smoke and visual-regression baselines for the new panels are not claimed.
- Not CERTIFIED; G6 not issued; DigiLocker untouched; independent review required.
