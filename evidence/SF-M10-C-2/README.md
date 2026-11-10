# SF-M10-C-2 Evidence — Studio workflow designer (SAMPLE_LAB)

**Branch:** `cursor/phase-c2-workflow-designer-34d9` (stacked on C-1 `cursor/phase-c1-forms-designer-34d9`)
**Implementation commit:** the PR head (rebased onto C-1 `c477aa3`); full run on the pre-rebase tree, re-run for `studio-designers` (25/25) and CDC (29/29) after the CodeQL linear-trim fix in `uniqueNodeId`
**Model:** Claude Opus 5.5, xhigh effort (builder self-assessment is not evidence)
**CERTIFIED:** false | **G6:** false | **self_certified:** false | **TSB seal:** false

## Scope

Phase C slice C-2: a graphical workflow designer in ServiceForm Studio over the canonical
ServiceForm Workflow Model (FROZEN SF-CON-WORKFLOW-MODEL, CMP-016). Temporal remains the only
runtime; BPMN 2.0 is import/export through CMP-016's existing profile and is never executed
(Constitution §33). No Camunda/Zeebe/Flowable or second runtime is introduced.

| Item | Ids |
|---|---|
| Components | CMP-050 Studio surface, CMP-016, CMP-033, CMP-051, CMP-052, CMP-054 UX4G wrapper |
| Contracts | SF-CON-WORKFLOW-MODEL (FROZEN, unchanged), SF-CON-BPMN-PROFILE (unchanged); new component-local `services/cmp-016-workflow-engine/contracts/openapi.json` |
| Constitution | §7, §8, §9, §19, §33; UX4G Experience Constitution |

## What changed

1. **`packages/studio-designers/workflow`**: designer model (layout and labels kept beside, never
   inside, the hashed graph), compiler to canonical `{nodes, edges}` in authoring order, CMP-016
   `graph_hash` via Web Crypto, deterministic layered layout (back edges ignored, longest-path
   columns), plain-language lint with CMP-016's rule codes, immutable canvas operations, the
   SAMPLE_LAB commit-wait graph as a template (test pins it to the lab fixture and hash).
2. **CMP-016 Studio API** (`src/http/studio-api.ts`, framework-neutral, OpenAPI contract):
   `POST /v1/workflow-graphs/check` (parseGraph + graph_hash + non-executable BPMN view),
   `POST /v1/workflow-graphs/import-bpmn` (screened profile; scripts, engine extensions and named
   performers refused), `POST /v1/workflow-drafts` (declared hash re-checked; stable definition id
   per tenant + key; DRAFT through `WorkflowService` with RLS, audit and immutability),
   `GET /v1/workflow-versions/{id}/bpmn`. Publication stays maker-checker (`publish` + ApprovalPort).
3. **Host** (`apps/api/src/platform/workflow-studio.ts`): mounts the routes with tenant and roles
   from the CMP-004 session only, OPA authorisation, rate limit; Drafts never reach Temporal.
4. **CMP-033**: WORKFLOW documents may carry `workflow_graph` + `graph_hash` + `layout`; validate
   recomputes the canonical graph hash and refuses a mismatch.
5. **OPA**: catalogued `WORKFLOW_DEFINITION_CREATE`, `WORKFLOW_VERSION_DRAFT`,
   `WORKFLOW_VERSION_IMPORT_BPMN` (PROTECTED), `WORKFLOW_VERSION_EXPORT_BPMN` (READ_ONLY); policy
   revision `m10-c2`. Lab: Studio designer may check/import/emit drafts (never publish); checker
   may read the BPMN view. `WORKFLOW_VERSION_PUBLISH` stays uncatalogued for Studio roles.
6. **Studio** `/workflows`, `/workflows/designer`: SVG canvas (drag to move, drag handle to
   connect, drop from palette; Tab/arrow keys move steps, Enter selects, Delete removes), palette
   over the frozen node kinds, inspector (role + organisation + jurisdiction assignment, never a
   named officer; outcomes; GoRules decision refs), Outline table (screen-reader alternative),
   Schema, BPMN (export via CMP-016, import via CMP-016), Publish stepper (CMP-033 draft →
   validate → freeze → emit CMP-016 DRAFT → binding change → CMP-051). Checker desk links the
   pinned workflow version's BPMN view.

## Executed evidence (local, SAMPLE_LAB, PostgreSQL 16, OPA 1.21.1, Temporal CLI 1.5.0)

| Check | Result |
|---|---|
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | pass / pass / pass |
| `pnpm test:coverage` | 339 files, **3243 tests pass**; lines 86.85 %, branches 74.48 % |
| `studio-designers` workflow unit | 6/6 (template = lab fixture graph and hash; layout never changes the hash) |
| CMP-016 `studio-api.test.ts` | 5/5 (check = parseGraph/exportBpmn; BPMN script refused; hash mismatch refused; deny-by-default) |
| `pnpm test:cdc` | 29/29 incl. `studio-workflow-designer.cdc.test.ts` 10/10 (frozen node kinds, round trip same graph_hash, designer and CMP-016 refuse the same 6 broken graphs) |
| CMP-033 unit | 18/18 (workflow graph hash verified; tampered, missing and extra keys refused) |
| Host route tests | 3/3 (session-derived caller, client tenant headers ignored, 401 before CMP-016) |
| `opa test policy/opa` (+ lab data) | **116/116** |
| Playwright (`pnpm e2e`, platform lab up) | **77/77** incl. `studio-workflow-designer.spec.ts` 3/3 with axe on landing, canvas, BPMN view and publish path |
| `pnpm deps:graph` | no violations |
| `python3 scripts/gates/run_all.py` | **10/10** |
| `pnpm contracts:validate` | 12 contracts, 0 failures |

Live lab smoke: Studio BFF → host → CMP-016 `check` returned the graph_hash and BPMN; `workflow-drafts`
stored a DRAFT (`origin: STUDIO`) under real OPA and FORCE RLS.

Screenshots: Project store `media/phase-c-studio/c2-workflow/` (`scripts/dev/capture-workflow-designer.mjs`).

## Non-claims and residuals

- SAMPLE_LAB only; CMP-016 publication of a Studio-emitted version needs a CMP-051-backed
  ApprovalPort (the lab's workflow publication is the fixture-bound SIMULATED approval). Citizen
  cases still pin the fixture workflow; a Studio version is not executed on Temporal in this slice.
- HUMAN_TASK assignments take organisation/jurisdiction ids typed by the author; master-data
  pickers (CMP-002/003) are follow-up. Port nodes are not wired in the lab (lint advises).
- BPMN export carries no diagram interchange (layout is recomputed on import).
- No AI in this slice. No FROZEN contract changed.
