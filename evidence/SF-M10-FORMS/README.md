# SF-M10-FORMS — CMP-009 on the citizen apply path + versioned template catalogue

| Field | Value |
|---|---|
| Code commit | `623b938b05cf552e65554f448b37af4b5c265985` (branch `cursor/forms-engine-citizen-apply-9452`) |
| Run | Local, Cursor cloud VM, 5 Nov 2026. Node 22, PostgreSQL 16 (fresh database), OPA 1.21.1, Chromium headless shell 1243 |
| Builder model | claude-opus-5-5 (this agent). Builder evidence only; independent INT/SEC/UX4G/EVD pending |
| Change record | `docs/change-requests/CCR-M10-002-cmp009-citizen-form-wiring.md` |
| Stamp | SAMPLE_LAB · OTP/IdP/DigiLocker SIMULATED · published-form source SIMULATED · CERTIFIED=false · G6=false · self_certified=false |

## What is wired

Citizen apply page → `GET /api/portal/forms/IND-SOC-002` (pinned FORM package + CMP-009
interpretation) → UX4G wizard rendered from the package: steps from `Categorization`, sections
from `Group`, controls from the schema and CMP-009 renderer ids, labels from the interpretation,
conditional visibility re-interpreted by CMP-009 when a rule-condition value changes.

Submit → `POST /api/portal/applications` → CMP-009 `POST /v1/executions` (authoritative) →
CMP-015 draft (pinned form version must equal the validated version) → working data (CMP-015
`data_hash` must equal CMP-009 `data_hash`) → ready → submitted.

The form is Residence Certificate v1.0.0 from `@serviceform/service-templates`, published to the
host's CMP-009 through a SIMULATED port. The host refuses to start if the binding pins a version
that is not PUBLISHED or whose content hash no longer matches.

## Executed

| Check | Result | Log |
|---|---|---|
| `scripts/dev/platform-lab.sh up` on a fresh database (3 runtime logins incl. `sf_lab_cmp009`) | up | `logs/platform-lab-up.log` |
| `pnpm e2e` (shells, golden, platform journey + 3 new CMP-009 journey tests) | 65/65 | `logs/e2e.log` |
| OPA `opa test policy/opa` (`m10-b2`, 12 new CCR-M10-002 tests) | 80/80 | `logs/opa-test.log` |
| CMP-009 integration (PostgreSQL, RLS, privilege boundary, migrations) | 9/9 | `logs/cmp009-integration.log` |
| `pnpm test:coverage` (incl. pattern, catalogue, renderer, host tests) | 3082 tests; lines 86.7%, branches 74.3% | `logs/unit-coverage-summary.log` |
| `python3 scripts/gates/run_all.py` | 10/10 | `logs/gates.log` |
| format, lint, typecheck (all workspaces), contracts, CDC, deps graph | pass | — |
| gitleaks (branch commits) and semgrep (p/default, p/typescript, p/nodejsscan, p/secrets, `.semgrep/`) on changed files | 0 findings | — |

New E2E coverage:

- Wizard rendered from the pinned form: metadata step labels, provenance line, conditional email
  shown/hidden by CMP-009, error summary focus, pattern error, indicative check, declaration
  `const`, axe (WCAG 2.1 AA) on first and review steps, 320 px reflow, then submit.
- CMP-009 authoritative: bad PIN, false declaration and an unknown field return 422
  `field_errors` (`PATTERN`, `CONST_MISMATCH`, `ADDITIONAL_PROPERTY`) and no application is filed.
- Only offered services expose a form: catalogue stubs (IND-SOC-031, IND-CIV-001) are 404 for
  form and apply; anonymous form read is 401; the pin is `0d15ba00-0010-…` with a `sha256:` hash.

## Known limitations for the verifiers

- CMP-015 does not yet verify the CMP-009 execution on SUBMIT itself; the BFF enforces the
  version and `data_hash` binding.
- CMP-009 is rate limited per BFF address, like CMP-004 (SEC F-08).
- The citizen session exposes no raw mobile, so the mobile field is not prefilled; sample answers
  are SAMPLE_LAB prefill until CMP-005 is wired.
- Independent suites outside CI (`tests/integration/m10-platform`, `tests/security/m10`) assert
  `m10-b1` and post the old flat body without the now-required fields; their owners must refresh
  them.

Agents recommend only. No gate is issued by this evidence.
