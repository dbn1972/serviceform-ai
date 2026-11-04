# SF-M10-B-2 — Citizen and officer portals on the platform path (CMP-004 + CMP-015)

| Field | Value |
|---|---|
| Code commit | `8b16bf35de7bd11abdb91aa2e72d36081eaf0b25` (branch `cursor/m10-phase-b-platform-wire-0b20`, stacked on SF-M10-B-1) |
| Run | Local, Cursor cloud VM, 4 Nov 2026. Node 22, PostgreSQL 16 (fresh database), OPA 1.21.1, Chromium headless shell 1243 |
| Builder model | claude-opus-5-5 (this agent). Builder evidence only — independent INT/SEC/UX4G/EVD pending |
| Stamp | SAMPLE_LAB · OTP/IdP SIMULATED · CERTIFIED=false · G6=false · self_certified=false |

## What is wired

Browser → portal BFF (`/api/portal/*`) → platform host (`apps/api/src/platform`, `scripts/dev/platform-lab.sh`) →
CMP-004 (citizen OTP, officer session) and CMP-015 (case, working data, list) on PostgreSQL with
FORCE RLS and one runtime login per component (ADR-0006), with real OPA as the PDP (`m10-b1`).
The lab JSON store and unsigned lab cookie are removed.

Not wired on this slice: CMP-016 Temporal sequencing (the officer drives intake transitions), CMP-022/024
credential issuance, CMP-012 DigiLocker publish, CMP-005 profile, CMP-008 eligibility, CMP-009 schema
validation, Studio → CMP-052 publication (the published binding is a SIMULATED port seeded from fixtures).

## Executed

| Check | Result | Log |
|---|---|---|
| `scripts/dev/platform-lab.sh up` on a fresh database (migrations, per-component logins, OPA, host) | up | `logs/platform-lab-up.log` |
| `pnpm e2e` (shells, golden, platform journey) | 58 passed | `logs/e2e.log`, `e2e-junit.xml` |
| API smoke: IDOR, forged token, tenant header, citizen officer-command, AI decision refusal, revocation | all expected | `api-smoke.sh`, `logs/api-smoke.log` |
| CMP-004 integration (PostgreSQL): incl. OTP lockout/expiry durability and officer roles (both red without the fixes) | 8/8 | `logs/cmp004-integration.log` |
| CMP-015 integration (PostgreSQL): incl. CCR-M10-001 list/working data, RLS, privilege | 31/31 | `logs/cmp015-integration.log` |
| `pnpm test:coverage` | 3003 tests; lines 86.6%, branches 74.3% (thresholds met) | `logs/unit-coverage-summary.log` |
| `python3 scripts/gates/run_all.py` | 10/10 | `logs/gates.log` |
| format, lint, typecheck (api, web-citizen, web-officer, web-studio, m10-sample-lab), contracts, CDC, deps graph, build | pass | — |

## Defects found and fixed on the path

- **CMP-004 OTP lockout never engaged on PostgreSQL.** Failed attempts, `LOCKED` and `EXPIRED` were written and
  then rolled back by the same transaction's throw. The in-memory double hid it.
- **CMP-004 officer contexts lost their roles** (`lookupActiveBySubject` returned none) and fell back to an
  invented `SERVICE_CHECKER` role.

## Known limitations for the verifiers

- **Rate limiting is per BFF address.** CMP-004 keys its limit by client IP, and every portal request arrives
  from the BFF. The lab host raises the limit (`SF_IDENTITY_RATE_LIMIT_MAX`). Production needs the client
  address forwarded through a trusted hop.
- **SIMULATED OTP inbox.** `/v1/simulated/otp-inbox/{challenge_id}` returns the code to whoever holds the
  challenge id. It is refused outside LOCAL/CI.
- **CMP-015 existence disclosure.** Get-by-id returns 403 for another citizen's case in the same tenant and
  404 otherwise. The citizen BFF maps both to 404.
