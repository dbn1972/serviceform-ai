# World-class forms WS1 — citizen apply UX (SAMPLE_LAB)

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · OTP / DigiLocker / Payment **SIMULATED** · synthetic data only
**Branch:** `cursor/citizen-form-ux-world-class-f410` · **Code SHA:** see `code-sha.txt`
**Scope:** Citizen apply wizard (save and resume, validation errors, phone, keyboard, accessibility) on the platform path; UX4G renderer registry for JSON Forms. No published form metadata, frozen contract, CMP service or policy changed.

## What landed

| Area | Change |
|---|---|
| Save and resume | Citizen BFF `POST /api/portal/drafts`, `GET`/`PUT /api/portal/drafts/[id]`: answers kept as a CMP-015 `DRAFT` with working data (CCR-M10-001) on the placement binding; optimistic `expected_revision`; SAMPLE_LAB synthetic-name refusal before anything is stored (Phase A L-2) |
| Autosave | Every "Save & continue" queues one serialized save; "Save and come back later" confirms with the reference; URL carries `?draft=` |
| Resume | My applications draft card → "Continue application"; lands on the first step that still needs an answer; restores the CMP-013 upload; refuses drafts for another service (404), submitted (409 + link) or a republished form (409, Constitution §35) |
| Submit from draft | `POST /api/portal/applications` accepts `application_id`; CMP-009 still validates first; the same case is submitted, so no orphan drafts |
| Errors | Error summary counts problems, links to fields (radio groups by name) and scrolls the question clear of the sticky bar (WCAG 2.4.11); page title `Error: …`; validate on leave, clear as fixed; hidden `Error:` prefix on field messages |
| Keyboard | Real `<form>`: Enter continues; focus moves to the visible step heading; stepper states for assistive tech; future steps disabled; "Change" → "Save & return to preview" |
| Phone | `minmax(0,1fr)` grid fixes controls clipped at 360 px; step-marker row; 14 px labels / 16 px answers; static, full-width actions |
| Renderer (`@serviceform/ui-ux4g`) | `Ux4gFormStepper` (registered extension `form-wizard-stepper`), `fieldError`, `resumeStepIndex`, layout `slots` + `onBlur`, review `display` overrides, textarea character count; tokens-only CSS |
| UX4G classes | Invented citizen-desk classes replaced with defined UX4G classes — landed separately as PR #274 (`15a2d2d3`), not in this diff |

## Executed checks (local, SAMPLE_LAB lab host: PostgreSQL 16 + OPA 1.21.1 + Temporal CLI, fresh `sf_lab` DB)

`code-sha.txt` names the WS1 code commit on the pushed branch. The checks ran on a working tree whose content in every path of this diff equals that commit. Later rebases changed only the base (#271–#274 touch no file in this diff; #274 carried the identical class renames), and the SHA is refreshed on each rebase.

| Check | Result | Log |
|---|---|---|
| `pnpm format:check` | PASS | `logs/format.log` |
| `pnpm lint` | PASS | `logs/lint.log` |
| `pnpm typecheck` (all workspaces) | PASS | `logs/typecheck.log` |
| `pnpm test:coverage` | 399 files · **4779 PASS** | `logs/unit-summary.log` |
| WS1 unit (renderer + draft BFF incl. IDOR, stale revision, refusal paths) | **34 PASS** | `junit/unit-ws1.xml` |
| `python3 scripts/gates/run_all.py` | 10/10 gates PASS | `logs/gates.log` |
| `pnpm deps:graph` | 0 violations | `logs/deps.log` |
| `pnpm e2e` (full suite incl. golden, journey, Studio) | **115/115 PASS** | `junit/e2e-full.xml`, `logs/e2e-full.log` |
| `tests/e2e/citizen-form-ux.spec.ts` `--repeat-each=3 --workers=2` | 24/24 PASS | — |

New e2e coverage (`tests/e2e/citizen-form-ux.spec.ts`): save → My applications → resume → submit files the same case; IDOR read/save/resume refused; draft under another service refused; stale revision 409; non-synthetic name refused with nothing stored; Enter + error-summary focus not obscured; validate on leave; evidence error link + Change/return; 320 px no clipped controls + axe WCAG 2.1 A/AA on every step.

## Findings (not fixed here)

1. **Lab state pollution:** after the full e2e suite on one lab host, the Studio specs' maker-checker publishes leave the Residence placement binding unusable for new applies (CMP-015 `SF-FORM-001`); an unmodified `main` test then fails the same way. CI is unaffected (fresh DB per run). Owner: Studio / lab test isolation.
2. **Next.js 16.4.3** `next build` stops once per app with a security-upgrade notice; a retry succeeds. Dependency upgrade is out of scope (version-pinned release change).
3. **Identity per-IP limit (SEC F-08):** heavy parallel local e2e from one IP can exhaust the CMP-004 window; not seen at CI concurrency.

## Not claimed

No REAL DigiLocker / SMS / Payment. Not production IAM. Not UX4G READY (`SF_M10_UX4G_READY` unset; screen-reader, 200 % zoom and non-Chromium passes remain human/EVD work). Builder evidence only — human/CI gate decides; **do not** claim CERTIFIED or G6.
