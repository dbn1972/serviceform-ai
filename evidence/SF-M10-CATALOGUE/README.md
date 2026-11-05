# SF-M10-CATALOGUE — Studio certificate template catalogue + citizen service catalogue

| Field | Value |
|---|---|
| Code commit | `4d47ddb27dc0af5642e4fe7868ee8c6eb0181737` (branch `cursor/template-catalogue-ux-9452`, on `main` `15b7874`) |
| Run | Local, Cursor cloud VM, 5 Nov 2026. Node 22, PostgreSQL 16 (fresh database), OPA 1.21.1, Chromium headless shell 1243 |
| Builder model | claude-opus-5-5 (this agent). Builder evidence only; independent UX4G/EVD pending |
| Builds on | SF-M10-FORMS (`evidence/SF-M10-FORMS/README.md`, PR #218) |
| Stamp | SAMPLE_LAB · stubs invent no policy · DigiLocker SIMULATED · CERTIFIED=false · G6=false · self_certified=false |

## What is delivered

- **Studio `/templates`.** Browse the versioned catalogue: Residence (published) and Income, Domicile
  and Birth (stubs from `docs/catalogue`). Search, category and maturity filters, with a live result
  count.
- **Studio `/templates/{id}`.**
  - Version history with content hashes; the selected version is marked `aria-current`.
  - Field-level diff from the previous version.
  - Interactive preview through the same UX4G renderer the citizen portal uses.
  - Form field table; registry facts; policy (`Policy input required` for stubs); certificate fields.
- **Citizen `/services`.**
  - A catalogue built from template metadata and the portal placement.
  - Only services the placement binds with a PUBLISHED version show "Apply now".
  - Stubs are listed as "Not yet available in this portal".
- **Citizen `/services/{id}`.**
  - A generic overview from metadata: definition, authority, validity and format.
  - "What you will be asked": steps and fields.
  - "What the certificate shows".
  - Unpublished policy is shown as "To be published by the department".
- **Generic `/services/{id}/apply`.** Works for any offered service and returns 404 otherwise. The
  IND-SOC-002 route uses the same component.

## Executed

| Check | Result | Log |
|---|---|---|
| `scripts/dev/platform-lab.sh up` on a fresh database | up | `logs/platform-lab-up.log` |
| `pnpm e2e` (incl. 4 new catalogue tests: filters, version history/diff/preview, stub policy, citizen catalogue; axe + 320 px on each page) | 69/69 | `logs/e2e.log` |
| `pnpm test:coverage` (incl. Studio and citizen catalogue unit tests) | 3088 tests; lines 86.7%, branches 74.3% | `logs/unit-coverage-summary.log` |
| `python3 scripts/gates/run_all.py` | 10/10 | `logs/gates.log` |
| format, lint, typecheck, contracts, deps graph | pass | — |
| gitleaks (branch commits), semgrep (changed files, CI rule packs) | 0 findings | — |

Screenshots: project store `media/forms-catalogue-ux/` (gallery `index.html`).

## Known limitations for the verifiers

- The catalogue is a package (Studio-authored metadata in code) with a SIMULATED publication. It
  is not yet CMP-001/CMP-052 backed; Studio cannot create a new version from the UI here.
- Stub forms follow registry core fields only. Their option lists are UI choices, not statutory
  lists. Fee, time, eligibility and evidence stay `POLICY_INPUT_REQUIRED`.
- UX4G evidence covers axe (WCAG 2.1 AA) and 320 px reflow in Chromium only.

Agents recommend only. No gate is issued by this evidence.
