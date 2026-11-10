# SF-M10-C-3 Evidence — Studio rules designer (SAMPLE_LAB)

**Branch:** `cursor/phase-c3-rules-designer-34d9` (stacked on C-2 `cursor/phase-c2-workflow-designer-34d9` @ `f494fb3`)
**Implementation commit:** the PR head; checks below were run on that tree
**Model:** Claude Opus 5.5, xhigh effort (builder self-assessment is not evidence)
**CERTIFIED:** false | **G6:** false | **self_certified:** false | **TSB seal:** false

## Scope

Phase C slice C-3: a rules designer in ServiceForm Studio that authors GoRules JSON Decision Model
(JDM) decision tables in plain language, runs author-written test cases on CMP-008's ZEN engine and
publishes the frozen pack through the existing CMP-033 → CMP-052 → CMP-051 maker-checker path.
Rule outputs are advisory outcome and reason codes; no rule approves, rejects or issues anything
(Constitution §20). No AI is used in this slice; boundary-test suggestions are deterministic.

| Item | Ids |
|---|---|
| Components | CMP-050 Studio surface, CMP-008, CMP-033, CMP-051, CMP-052, CMP-048 (OPA), CMP-054 UX4G wrapper |
| Contracts | CMP-008 component-local OpenAPI gains `POST /v1/rule-packs/test`; no FROZEN contract changed |
| Constitution | §7, §8, §9, §20; UX4G Experience Constitution |

## What changed

1. **`packages/studio-designers/rules`**: designer model (inputs, result columns, declared outcome
   and reason codes, rows, test cases), compiler to JDM (`inputNode → decisionTableNode(hitPolicy
   first) → outputNode`, ZEN unary tests per operator), `content_hash` over the executable pack only
   (`rule_pack_id`, `engine`, `jdm`, `outcome_field`, `reason_codes_field`), plain-language lint
   (decision-sounding codes such as APPROVE/REJECT flagged, clock/random functions refused,
   unreachable rows, undeclared codes, untested outcomes, tests without expectations), immutable
   row/column/test operations, deterministic boundary-test suggestions, a SAMPLE_LAB residence-period
   template (12+ months → MEETS_SAMPLE_CRITERIA, otherwise REFER_TO_OFFICER).
2. **CMP-008 Studio test bench** (`src/http/studio-api.ts`, framework-neutral, OpenAPI): parses a
   draft pack exactly like a published one (`parseRulePack`), evaluates up to 50 cases on the real
   ZEN engine with the same timeout and input/output limits, returns outcome, reason codes, matched
   row ids, the server-computed `content_hash` and `advisory: true`. Nothing is persisted or pinned;
   published evaluation stays `POST /v1/evaluations` by pin. Deny-by-default `RULE_PACK_TEST`.
3. **Host** (`apps/api/src/platform/rules-studio.ts`): mounts the test bench with tenant and roles
   from the CMP-004 session only, OPA authorisation and rate limits.
4. **CMP-033**: RULES documents carrying `jdm` must carry a `content_hash` equal to the canonical
   hash of the executable pack; validate recomputes it and refuses a mismatch.
5. **OPA** (revision `m10-c3`): `RULE_PACK_TEST` (READ_ONLY) on resource `RulePack`; lab grants it to
   STUDIO_DESIGNER and STUDIO_CHECKER only.
6. **Studio** `/rules`, `/rules/designer` (UX4G only): decision table with plain-language cells
   ("at least 12", "any value"), row/column inspector, declared code lists (a code used by a row
   cannot be removed), Tests tab (synthetic inputs, run on CMP-008, per-test verdict, "Use this
   result as expected" requires an explicit author click), JDM view and download, Publish stepper
   (save → validate → every test passes for this exact `content_hash` → freeze → binding change →
   CMP-051). Publication desk links the pinned pack read-only. Read-only panes stay keyboard
   reachable for axe `scrollable-region-focusable`.

## Executed evidence (local, SAMPLE_LAB, PostgreSQL 16, OPA 1.21.1, Temporal CLI 1.5.0)

| Check | Result |
|---|---|
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | pass / pass / pass |
| `pnpm test:coverage` | 343 files, **3265 tests pass**; lines 86.96 %, branches 74.55 % |
| `studio-designers` rules unit | 9/9 (operators → ZEN unary tests, hash excludes tests/authoring, column/test edits keep rows and tests consistent) |
| CMP-008 `studio-api.test.ts` | 3/3 (ZEN evaluation and verdicts, invalid pack refused, deny-by-default) |
| `pnpm test:cdc` | 38/38 incl. `studio-rules-designer.cdc.test.ts` 9/9 (every operator means on ZEN what the designer says; CMP-008 hash equals designer hash) |
| CMP-033 unit | 19/19 (rule pack `content_hash` verified; tampered pack refused) |
| Studio unit (`apps/web-studio/test`) | 29/29 incl. `rules-designer.test.tsx` 5/5 |
| Host route tests | 2/2 (session roles to OPA, 401 before CMP-008) |
| `opa test policy/opa` (+ lab data) | **117/117** (incl. `RULE_PACK_TEST` read-only, granted only by tenant data) |
| Playwright `studio-rules-designer.spec.ts` | 3/3 with axe on landing, table, tests, publish path and the checker's frozen view |
| Playwright full suite (platform lab up) | **80/80** |
| `python3 scripts/gates/run_all.py` | **10/10** |
| `pnpm contracts:validate` / `pnpm deps:graph` | 12 contracts, 0 failures / no violations |

Live lab smoke: unauthenticated `POST /v1/rule-packs/test` → 401; designer session → 200 with ZEN
results; case-officer session → 403; a pack calling `now()` → 422 `JDM_NON_DETERMINISTIC_FUNCTION`.

Screenshots: Project store `media/phase-c-studio/c3-rules/` (`scripts/dev/capture-rules-designer.mjs`).

## Non-claims and residuals

- SAMPLE_LAB only. Citizen cases still pin the fixture rule version; the lab host does not mount
  CMP-008 evaluations by pin, so a Studio pack is not evaluated on a live case in this slice
  (follow-up: CMP-033-backed `RulePackPort` on the host).
- The "tests pass before freeze" gate is enforced by Studio; CMP-033 does not consult CMP-008 on
  publish (cross-component call would need an INT contract).
- No AI assistance yet: CMP-039 AI Gateway is not mounted on the lab host. When added it may only
  propose draft rows/tests the author must accept; it never sets a statutory outcome.
- JDM import from external GoRules editors is not offered (export only); arbitrary JDM expressions
  do not map back to the plain-language table.
- Manual screen-reader smoke and visual-regression baselines not claimed.
