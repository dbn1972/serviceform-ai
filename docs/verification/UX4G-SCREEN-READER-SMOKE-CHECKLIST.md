# UX4G manual screen-reader smoke — release-critical forms journeys

**Input to SF-15 (owner bind). Humans run and sign this; agents cannot.**
**CERTIFIED=false · G6=false · self_certified=false · `SF_M10_UX4G_READY` unset · SF-15 unbound**
**Covers:** `specs/design-system.yaml` → `manual_screen_reader_smoke_for_release_critical_journeys`
**Packet:** [`SF-15-UX4G-READY-BIND-PREP.md`](./SF-15-UX4G-READY-BIND-PREP.md) · automated evidence `evidence/SF-P8-A11Y/`

Automated checks (axe, keyboard, focus, reflow, forced colours) cannot tell whether a screen reader
*says* the right thing in the right order. This script lists what each screen should announce,
taken from the accessibility tree the journey suite records (`evidence/SF-P8-A11Y/journey/*.aria.yml`).
Mark each row Pass / Fail / Note. A Fail on a row marked **critical** blocks the bind.

## 1. Test matrix

| ID | Screen reader | Browser | Platform | Required for READY |
|---|---|---|---|---|
| SR-1 | NVDA (current stable) | Chrome stable | Windows 11 | **Yes** |
| SR-2 | VoiceOver | Safari | iOS (phone, portrait) | **Yes** |
| SR-3 | TalkBack | Chrome | Android (phone, portrait) | **Yes** |
| SR-4 | VoiceOver | Safari | macOS | Yes (Studio preview, officer) |
| SR-5 | JAWS | Chrome or Edge | Windows 11 | Optional |
| HC-1 | Windows Contrast theme (Aquatic or Desert) | Edge | Windows 11 | **Yes** (forced colours, eyes-on) |

Record exact versions in §5. Use the SAMPLE_LAB host only, synthetic values only
(names start with `SAMPLE`). OTP is SIMULATED: the code appears on the sign-in page.

## 2. Citizen apply — Residence Certificate (IND-SOC-002)

Start at `/services/IND-SOC-002/apply` signed out.

| # | Action | Expected announcement / behaviour | Critical | SR-1 | SR-2 | SR-3 |
|---|---|---|---|---|---|---|
| C-01 | Load sign-in | Page title names the page; first stop is "Skip to main content" link | yes | | | |
| C-02 | Enter mobile, Get OTP | Mobile field announced as "Mobile number, edit"; OTP sent state announced (status) | yes | | | |
| C-03 | Enter OTP digits | Each box "Digit n of 6"; wrong code error announced (alert) | yes | | | |
| C-04 | Arrive on apply | Title "Applicant details (step 1 of 4) - …"; h1 "Apply — Residence Certificate" | yes | | | |
| C-05 | Stepper | Navigation "Application steps"; buttons read "Applicant Identity details, step 1 of 4, Current step"; later steps "Not started", dimmed/unavailable | yes | | | |
| C-06 | Fields on step 1 | Each field reads its label; optional fields say "(optional)"; hints read after label (e.g. "10 digits · synthetic only") | yes | | | |
| C-07 | Clear the name, press Enter | Focus jumps to "There is a problem" alert; link "Enter the full name"; title starts "Error:" | yes | | | |
| C-08 | Activate the error link | Focus on "Full name …, invalid entry"; description "Error: Enter the full name" | yes | | | |
| C-09 | Fix name, Save & continue | Focus on heading "Step 2 of 4 Residence address"; status "Saved at …" announced politely, once | yes | | | |
| C-10 | Step 3 without a file, Save & continue | Error summary "Upload a supporting document…"; link moves to "Upload supporting evidence" file input with its hint | yes | | | |
| C-11 | Choose a PDF | "Uploading and checking the file (SIMULATED)…" then file name + "Technically accepted (CMP-013)" | yes | | | |
| C-12 | Preview step | Heading "Step 4 of 4 Preview application"; answers read as term/definition pairs; buttons "Change applicant details" etc. | yes | | | |
| C-13 | Submit without declaring | Error summary focused; declaration checkbox announced invalid with its error | yes | | | |
| C-14 | Declare, Submit application (₹0) | Lands on status page; h1 "Residence Certificate"; "Submitted · under review" | yes | | | |
| C-15 | Save and come back later | Focus on "Saved" notice with Ref and "Go to My applications" link | no | | | |
| C-16 | My applications | Card link "Continue Residence Certificate application" for drafts; status per card | no | | | |
| C-17 | Rotor / landmarks list | banner, navigation "Citizen", main, navigation "Breadcrumb", form "Step n of 4 …", contentinfo | no | | | |

## 3. Studio designer preview (Residence template)

Start at Studio `/forms` → "Open Residence Certificate … in designer" → Preview tab.

| # | Action | Expected | Critical | SR-1 | SR-4 |
|---|---|---|---|---|---|
| S-01 | Designer views | Tab list "Designer views": Design, Logic, Preview, Schema, Publish; arrow keys move between tabs | yes | | |
| S-02 | Preview bar | Group "Preview width" with toggle buttons (pressed state read); "Jump to step" combobox; "Runtime details" switch | yes | | |
| S-03 | Preview stepper | Navigation "Preview steps" with the same step names as the citizen form | yes | | |
| S-04 | Clear answers, Check whole form | Focus on preview error summary; links move to the named fields | yes | | |
| S-05 | Phone (360 px) | Same reading order as desktop; nothing announced twice | no | | |

## 4. Officer review

| # | Action | Expected | Critical | SR-1 | SR-4 |
|---|---|---|---|---|---|
| O-01 | Queue | Table or list of applications with reference and status read per row | yes | | |
| O-02 | Open an application | h1 names the application; applicant/residence/evidence sections are headed regions | yes | | |
| O-03 | Decision controls | "Approve" and the other decision buttons read their purpose; result announced after acting | yes | | |

## 4a. Points to listen for (from the accessibility tree; not axe failures)

Confirm or dismiss each; anything confirmed goes to the owner residual list.

| Ref | What the tree shows | What to check |
|---|---|---|
| L-1 | Stepper names contain a stray space before the comma ("Identity details , step 1 of 4") | Does the reader pause oddly or read "comma"? |
| L-2 | The apply policy tags carry `aria-label="Service policy summary"` on a plain `div`; the tree exposes only the tag text | Is the label announced? If not, it is harmless but unused |
| L-3 | The "Signed in with a verified mobile (OTP)" notice is a `status` region present at load | Is it read once on arrival, not on every step? |
| L-4 | An empty `alert` at the top is the Next.js route announcer | Is each page change announced exactly once? |
| L-5 | Status page progress list conveys completion as text "(completed)"; no `aria-current` on the active stage | Is the current stage clear by ear? |

## 5. Sign-off

| Field | Value |
|---|---|
| Tester(s) | |
| Date (IST) | |
| SAMPLE_LAB host / commit | |
| SR-1 NVDA + Chrome versions | |
| SR-2 iOS + VoiceOver versions | |
| SR-3 Android + TalkBack versions | |
| SR-4 macOS + VoiceOver versions | |
| HC-1 Windows theme | |
| Critical rows failed | |
| Notes / defects raised | |
| Result | PASS / FAIL |

Signing this sheet does not set `SF_M10_UX4G_READY`. The owner decides the bind in SF-15.
