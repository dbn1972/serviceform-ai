# SF-M10-C-1 Evidence — Studio forms designer (SAMPLE_LAB)

**Branch:** `cursor/phase-c1-forms-designer-34d9`
**Implementation commit:** `f12081c` (base `main` at `4766664`; the full run below was on its pre-fix parent `1491c25`)
**Model:** Claude Opus 5.5, xhigh effort (Studio UI routed to the higher-quality model per
`preferences.md`; builder self-assessment is not evidence)
**CERTIFIED:** false | **G6:** false | **self_certified:** false | **TSB seal:** false

## Scope

Phase C slice C-1, authorised by the product owner: a graphical forms designer in ServiceForm
Studio that authors CMP-009 FORM packages (JSON Schema + UX4G UI schema), previews them through the
citizen renderer and takes a frozen, hash-pinned version through the CMP-033 → CMP-051 → CMP-052
maker-checker path already mounted on the SAMPLE_LAB host (B-4, #229).

| Item | Ids |
|---|---|
| Components | CMP-050 Studio surface, CMP-009, CMP-033, CMP-051, CMP-052, CMP-054 UX4G wrapper |
| Integration | INT-002 (metadata → maker-checker → versioning), INT-011 (no client tenant context), INT-013 (SIMULATED fail-closed) |
| Constitution | §1, §8, §9, §20, §30, §38; UX4G Experience Constitution |

## What changed

1. **`packages/studio-designers`** (new, pure TypeScript, browser-safe): designer model, compiler
   to CMP-009 FORM packages, lossless import (every catalogue version recompiles to its recorded
   content hash), CMP-033/CMP-009 lint mirror, bounded pattern builder, immutable editing ops that
   keep rule references valid on rename/move, palette presets reusing the catalogue's
   semantic-element field shapes (no invented semantic ids).
2. **Studio** `/forms`, `/forms/designer`: palette, canvas (keyboard actions plus drag-and-drop),
   inspector, undo/redo, live UX4G preview (desktop and 360 px), schema view, publish stepper:
   save draft → validate → freeze (immutable) → resolve the pin in CMP-009 → TenantServiceBinding
   draft carrying every other pin forward → CMP-051 request + submit. The Publication desk now
   opens a request, shows the pins, refuses a maker decision in the UI (CMP-051 enforces it),
   records an approve/reject reason and publishes the CMP-052 version.
3. **CMP-033**: a FORM document may carry `form_package` and `content_hash`; `validate` recomputes
   the canonical digest and refuses a mismatch. `readPublishedDocument` is CMP-033's own provider
   read (its pool, FORCE RLS, transaction-local tenant) for host composition.
4. **Host** (`apps/api/src/platform/forms.ts`): CMP-009 `FormDefinitionPort` resolves the SIMULATED
   catalogue first, then Studio forms frozen in CMP-033 by document id, recomputing the hash from
   the stored package so CMP-009's pin comparison is against exactly what was validated.
5. **B-4 defects fixed on the lab path** (the desks could not complete with real OPA):
   - OPA action catalogue lacked every CMP-033/051/052 action → `UNKNOWN_ACTION`. Catalogued
     (reads `READ_ONLY`, writes/decisions `PROTECTED`); policy revision `m10-b2d` → `m10-c1`.
   - Host passed CMP-033/051 SIMULATED ports without config → every validate/request failed with
     `*_UNAVAILABLE`. Ports are now built by each plugin from `loadConfig`.
   - `/api/session` did not return the officer id the desk compared with the maker.
6. **UX4G wrapper**: `Select` primitive (Figma "Dropdown"), `Switch` now renders the UX4G track and
   thumb (it rendered no control), AppShell `layout="wide"`, ten icons, registered extension
   `studio-designer-canvas`. Styles use UX4G tokens only.

## Executed evidence (local run on `1491c25`, SAMPLE_LAB, PostgreSQL 16, OPA 1.21.1, Temporal CLI 1.5.0)

CI follow-up folded into `f12081c`: CodeQL `js/polynomial-redos` in `slugKey` replaced by a linear
trim (new 100 000-character test), and a gitleaks `generic-api-key` false positive on a test literal
removed. `studio-designers` 18/18, host form-port 5/5, `gitleaks git` on the branch: no leaks.


| Check | Result |
|---|---|
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | pass / pass (0 warnings) / pass |
| `pnpm test:coverage` | 335 files, **3224 tests pass**; lines 86.75 %, branches 74.45 % |
| `packages/studio-designers` unit | 17/17 (5 catalogue versions round-trip to recorded hashes) |
| CMP-009 `studio-designer-compat` | 17/17 (designer output parses in CMP-009, `sha256Of` equal, runtime enforces required-when, pattern subsets agree on 15 cases) |
| CMP-033 unit / integration (real PostgreSQL, FORCE RLS) | 17/17 / **9/9** incl. tampered hash refused, frozen PATCH refused, other tenant reads `null` |
| `opa test policy/opa` (+ lab tenant data) | **114/114** incl. `studio_publication_test.rego` (maker cannot approve or publish a binding; checker cannot author; cross-tenant `TENANT_MISMATCH`) |
| Playwright full suite (`pnpm e2e`, platform lab up) | **74/74** incl. `studio-forms-designer.spec.ts` 3/3 with axe WCAG 2.1 AA on landing, designer, preview (360 px), publish and checker desk |
| `pnpm deps:graph` | no dependency violations (2101 modules) |
| `python3 scripts/gates/run_all.py` | **10/10** gates |
| `pnpm contracts:validate` | 12 contracts, 0 failures |

Screenshots: Project store `media/phase-c-studio/c1-forms/` (`scripts/dev/capture-forms-designer.mjs`).

## Non-claims and residuals

- **SAMPLE_LAB only.** Officers, OTP/IdP and DigiLocker remain SIMULATED.
- CMP-052 `ApprovalPort` on the lab is still the B-4 `SimulatedApprovalPort(allow=true)`; the
  checker desk only offers publish after CMP-051 shows `APPROVED`, but CMP-052 does not yet query
  CMP-051. A CMP-051-backed approval port is the INT-002 follow-up before any non-lab use.
- The e2e base binding uses synthetic, test-only pins for non-form kinds; no statutory metadata is
  invented. Citizen placement still offers the fixture binding; a Studio-published binding is not
  yet offered to citizens (placement is fixture-defined).
- CMP-033 has no list endpoint; "recent drafts" is browser-local convenience only.
- Accessibility: automated axe, keyboard paths and 320/360 px reflow executed; manual
  screen-reader smoke and visual-regression baselines are not claimed.
- No AI in this slice. No FROZEN contract changed (CMP-033 contract is component-local).
