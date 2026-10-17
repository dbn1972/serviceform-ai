# SF-M09-002 evidence — CMP-057 Assisted Service / Omnichannel

Builder candidate evidence only. **Not CERTIFIED / not G4 / not G6 / not self-certified.** No gate is
issued here; independent INT / SEC / EVD review and a human or CI gate are still required.
Recommended gate status: none (builder candidate).

- Authorization: `HUMAN_CG03_THROUGH_EVD` Wave A READY (PR #159 on main).
- Execution base: `fd7492b` (`origin/main` after Wave A READY). Freeze tip `e09ec3f1…`.
- Branch: `cursor/m09-002-assisted-91f2`. DRAFT PR (see handover).
- Agent / model: Cursor Cloud Agent, route `opus` (per `MODEL-ROUTING-QUALITY.md`; self-assessment is not evidence).

## Representation / statute guard (no invented representation statute)
- `applied_by_distinct_from_applied_for: true` is a FROZEN constant (SF-CON-ASSISTED-SESSION), enforced
  in service start, `toContract`, DB CHECK, and `sf_assisted.guard_session()`.
- `invented_statutory_policy_forbidden: true` is a constant (service + DB CHECK).
- `representation_authority_ref` is an opaque owner-supplied reference only; CMP-057 never interprets
  guardian calendars, power-of-attorney statutes, or eligibility rules.
- Representation channels require a third-party verifier (not applied_by / applied_for) before
  `REPRESENTATION_VERIFIED`; consent is verified via host port (CMP-030) before the CMP-057 transaction.

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package) | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` (package) | exit 0 | `eslint.log` |
| Prettier `--check` (package) | exit 0 | `prettier.log` |
| Unit + contract (vitest 5.0.3) | 30/30 pass (7 domain, 11 service/API, 12 contract) | `unit-contract.log`, `junit/unit.xml` |
| Integration on PostgreSQL 16.15 (fresh DB, migration chain, real LOGIN roles, FORCE RLS) | 12/12 pass (8 privilege/RLS/DB-guard/reversibility, 4 API flow) | `integration-postgres16.log`, `junit/integration.xml` |
| migration-lint | PASS | `migration-lint.log` |

Commands (from `services/cmp-057-assisted-service`):
`tsc --noEmit -p tsconfig.json`; `vitest run --root . --config vitest.unit.config.ts`;
`DATABASE_URL=… vitest run --root . --config vitest.integration.config.ts`.
CI-only checks (CodeQL, Semgrep packs, gitleaks, checkov, coverage thresholds, dependency-cruiser)
were not run on the builder VM.

## Requirement → test traceability
- INT-015 applied_by ≠ applied_for: `service.test.ts` self-assisted start; `domain.test.ts` toContract;
  `privilege-rls.int.test.ts` DB CHECK; `api-flow.int.test.ts` API refusal.
- Representation opaque ref / third-party verify: `service.test.ts` representation channel;
  `privilege-rls.int.test.ts` DB guard; `api-flow.int.test.ts`.
- Consent before submit/handoff: lifecycle `COMMAND_SOURCES` + service happy path / refusal tests.
- Citizen resume preserves citizen_id + application_id: handoff/resume unit + API flow tests.
- Tenant isolation / OPA PEP: service OPA tests; FORCE RLS integration; cross-tenant GET 404.
- SF-CON-ASSISTED-SESSION shape: `contracts.test.ts` validates every returned session against frozen schema.
- Privilege posture (`sf_cmp057_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS, sf_migrator owner, peer denied)
  and reversible migration pair: `privilege-rls.int.test.ts`.

## Scope
Allowed paths only: `services/cmp-057-assisted-service/**`, `db/migrations/*_cmp-057-*.sql`,
`evidence/SF-M09-002/**`, `orchestrator/handovers/SF-M09-002.yaml`. Frozen contracts unaltered;
`pnpm-lock.yaml` not modified; `ccr_required=false`.

## Residuals (explicit)
1. `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` — new workspace package needs an importer row in `pnpm-lock.yaml` (not modified here).
2. OPA policy data for `ASSISTED_SESSION_*` actions lives in `policy/**` (read-only for this lane); until added the PDP denies (fail-closed).
3. Host verification ports (CMP-004/005 applicant, CMP-030 consent) are unbound doubles here; fail closed when unavailable.
4. Host mount deferred to SF-M09-HOST; no UI.
5. CERTIFIED / G4 / G6 remain false.
