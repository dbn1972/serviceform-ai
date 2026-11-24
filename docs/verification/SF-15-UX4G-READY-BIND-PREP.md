# SF-15 UX4G READY — owner bind-prep packet (forms surfaces)

**Prepared by agents for the owner. Agents do not bind.**
**`SF_M10_UX4G_READY`: UNSET — owner SF-15** · CERTIFIED=false · G6=false · self_certified=false
**Scope:** shared UX4G forms layer as assembled in citizen apply (IND-SOC-002), the Studio designer
preview, and the officer queue/review. Citizen mobile (Flutter), tenant admin and platform ops are
outside this packet.
**Evidence:** `evidence/SF-P8-A11Y/` (this packet, journey level) · `evidence/SF-WCF-UX4G-READY/`
(gallery level, #275) · `evidence/SF-M10-005/` (Phase B journey pack, pre-#275)
**Human script:** [`UX4G-SCREEN-READER-SMOKE-CHECKLIST.md`](./UX4G-SCREEN-READER-SMOKE-CHECKLIST.md)

## 1. The decision

One owner decision: **bind UX4G READY for the forms surfaces above, or decline with reasons.**

Agents have produced every automated artifact they can. What remains is human by design: the
screen-reader session, Figma parity, and two waivers or ADRs (Storybook, Indic webfont). §5 lists
them; §6 is the checklist to sign.

## 2. What the flag does today

`tests/ux4g/m10/ux4g-hold.test.ts` is fail-closed: its first test asserts the flag is unset, and a
placeholder runs only when `SF_M10_UX4G_READY=1`. Exporting the variable alone therefore turns CI
red. A bind is a human-authored change that (a) replaces the fail-closed assertion with the
accepted evidence reference, (b) sets the variable where the golden job reads it, and (c) records
the decision in `docs/verification/` and SF-15. None of that is done here.

## 3. Evidence against `specs/design-system.yaml` required_evidence

| Required | Gallery (#275, CI `ux4g-forms`) | Journey (this packet, CI `ui-smoke`) | Status for the bind |
|---|---|---|---|
| storybook_build | Static gallery, not Storybook | — | **GAP** — owner: waive for v1 or require Storybook |
| component_tests | `ui-ux4g` 82 unit tests | — | PASS |
| keyboard_tests | Tab order, skip link, radio arrows, Space toggles | Keyboard-only filing: OTP sign-in, every step, error-summary links, file chooser by Space, declaration, submit. Studio: open template, tab list arrows, preview error summary. Officer: decision reachable | PASS |
| automated_accessibility | axe WCAG 2.2 A/AA, 8 scenes × 2 widths | axe WCAG 2.2 A/AA, 19 live screens × 2 widths (38 runs), 0 violations; heading outline | PASS |
| contrast_token_checks | `token-conformance.test.ts` AA matrix | — | PASS |
| responsive_reflow_200_percent | 320 px reflow, 200% text, 1.4.12 spacing | Same three on all 19 live screens | PASS |
| forced colours (WCAG 1.4.11 / 2.4.7) | Boundaries; focus on every scene (new) | Boundaries and focus on every tab stop of all 19 screens | PASS after F-1 fix |
| focus not obscured (2.4.11) | Gallery scenes | Every tab stop on all 19 screens, including sticky action bars | PASS |
| multilingual_truncation | Devanagari scene | Not run in a live journey | **PARTIAL** — see R-4, R-5 |
| visual_regression | 20 baselines, CI-gated | Screenshots per screen (1280, 320, forced colours) as evidence, not gated | **PARTIAL** — see R-7 |
| figma_code_inventory | Code side PASS | — | **HUMAN** — Figma parity |
| manual_screen_reader_smoke | — | ARIA snapshot per screen as a script aid | **HUMAN** — checklist not yet run |

Journey screens (19): citizen apply step 1, step 1 with errors, step 2, step 3, step 3 with errors,
step 3 uploaded, preview, preview with errors, saved notice, status page, My applications; Studio
forms list, designer, preview (desktop, errors, review step, phone); officer queue, officer review.

## 4. Defects found and fixed in this packet

| ID | Defect | WCAG | Fix |
|---|---|---|---|
| F-1 | `Ux4gFormStepper` step buttons had no focus indicator under forced colours (the ring is a box-shadow, which forced colours drop). Citizen apply and the Studio preview both affected | 2.4.7 | `packages/ui-ux4g/src/styles.css`: system `Highlight` outline for `.sf-stepper-btn:focus-visible` inside the existing forced-colours block |
| H-1 | Harness gap: the focus probe started from the last focused element and stopped on duplicate labels, so citizen apply steps reported 1–12 stops instead of 13–24. Gallery forced-colours focus was checked on one scene only | — | `tests/ux4g/helpers/a11y.ts` walk starts at the document top and stops on a revisited control; forced-colours focus now runs on every gallery scene |

## 5. Residuals for the owner

| ID | Residual | Owner action | Blocks bind? |
|---|---|---|---|
| R-1 | Manual screen-reader smoke not run | Run the checklist (NVDA, VoiceOver iOS, TalkBack, Windows contrast theme) | **Yes** |
| R-2 | Figma parity unverified | Design owner compares the coded inventory with the UX4G kit | **Yes** (or explicit waiver) |
| R-3 | No Storybook build | Waive for v1 or require (ADR if waived permanently) | Owner call |
| R-4 | `--ux4g-font-family-base` names no Indic family; webfonts not embedded | Design-system ADR | Owner call |
| R-5 | No live journey in a second language | Run the journey with Hindi labels once R-4 is decided | Owner call |
| R-6 | Citizen mobile (Flutter) has no UX4G journey evidence | Separate pack before G6 | No (outside this scope) |
| R-7 | Live-journey visual regression not CI-gated; `SF-M10-005` baselines predate #275/#277/#278 | Gate journey baselines after P8-2/P8-3 chrome settles | No |
| R-8 | UX4G button, card, checkmark transitions still run under `prefers-reduced-motion: reduce` | Vendor/design-system decision (WCAG 2.3.3 is AAA) | No |
| R-9 | Accessibility-tree notes L-1…L-5 (stepper name spacing, unexposed policy label, status at load, route announcer, no `aria-current` on the status stage) | Confirm in R-1; route confirmed items to the citizen UX owner | No unless R-1 confirms harm |
| R-10 | Studio e2e specs publish test bindings on the live IND-SOC-002 offering with synthetic form pins; later Residence drafts on that database fail with SF-FORM-001 | Studio spec owner: publish on a lab-only offering | No (test isolation, not UX4G) |
| R-11 | `next build` reports a security advisory for pinned Next.js 16.4.3 | Owner release change | No |

## 6. Owner checklist

- [ ] R-1 screen-reader checklist signed PASS (no critical row failed)
- [ ] R-2 Figma parity accepted or waived in writing
- [ ] R-3 Storybook waived for v1 or delivered
- [ ] R-4 Indic font decision recorded (ADR or waiver)
- [ ] CI green on the bind commit: `ux4g-forms`, `ui-smoke` (includes `a11y-ux4g-forms-journey`), architecture gates
- [ ] Hold test updated by a human per §2; decision recorded in SF-15

## 7. What agents did not do

Did not set `SF_M10_UX4G_READY`, edit the hold test, accept ADR-0007/0008, run a screen reader,
compare against Figma, or claim CERTIFIED or G6.
