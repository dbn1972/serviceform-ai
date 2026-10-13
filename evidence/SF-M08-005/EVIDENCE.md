# SF-M08-005 evidence — CMP-049 Data Retention / Archival

Builder candidate evidence only. **Not CERTIFIED / not G3 / not G6 / not self-certified.** No gate is
issued here; independent INT / SEC / EVD review and a human or CI gate are still required.
Recommended gate status: none (builder candidate).

- Authorization: `HUMAN_SF_M08_005_READY_DISPATCH_AUTHORIZATION` (user "continue to next" after M05 G4 + M06 G3).
- Execution base (exact): `69100b3f4f07a46ac91e081c8741c7de1b9d6667` (`origin/main` at dispatch).
- Branch: `cursor/m08-005-retention-91f2`. No PR opened by the builder; not merged.
- Implementation commit the logs were produced on: `a5377093206fa6c3666c8dfc0a2561341c94d4aa`
  (`logs/impl-head.txt`). The package `README.md` in that commit was written after the test runs
  (docs only); later commits add only this evidence directory and the handover `candidate:` block.
- Agent / model: Cursor Cloud Agent, route `opus`, release `claude-opus-5-5` (per
  `MODEL-ROUTING-QUALITY.md`; self-assessment is not evidence).

## Statutory policy input (STATUTORY_RETENTION_POLICY_INPUT_REQUIRED)
- No retention period, day count, due date, DPDP timeline or jurisdiction schedule is defined in
  code, migrations, contracts or fixtures. `statutory_retention_policy_input_required: true` and
  `invented_statutory_period_forbidden: true` are constants (service + DB CHECK).
- `ARCHIVE_ELIGIBLE` / `DELETE_ELIGIBLE` transitions fail closed with `409 SF-APP-001` detail
  `POLICY_INPUT_REQUIRED` while `owner_supplied_period_ref` is null — enforced in the domain
  evaluator, the `retention_subject` guard trigger (`HINT SF_POLICY_INPUT_REQUIRED`) and the
  `retention_transition_log` CHECK. Refusals are audited `FAILED`.
- The period ref is an opaque owner reference, bound once; duration-like values (`30`, `365d`,
  `P7Y`, `PT24H`, …) are refused by the service and a DB CHECK.
- Fixtures use synthetic UUIDs and a synthetic ref (`owner-input:retention-schedule/ref-0001`).

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package) | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` (package) | exit 0 | `eslint.log` |
| Prettier `--check` (package + handover) | exit 0 | `prettier.log` |
| Unit + contract (vitest 5.0.3) | 68/68 pass (28 domain, 24 service/API, 16 contract) | `unit-contract.log`, `junit/unit.xml` |
| Integration on PostgreSQL 16.15 (fresh DB, full migration chain, real LOGIN roles, FORCE RLS) | 14/14 pass (8 privilege/RLS/DB-guard/reversibility, 6 API flow) | `integration-postgres16.log`, `junit/integration.xml` |
| Repo gates `scripts/gates/run_all.py` | 10/10 PASS (migration-lint, contracts-lock, openapi-asyncapi, hardcoding, cg01 uniqueness, …) | `gates.log` |
| Write scope `check_scope.py --envelope orchestrator/handovers/SF-M08-005.yaml` | PASS, 47 files | `scope.log`, `write-scope-diff.txt` |

Commands (from `services/cmp-049-data-retention`):
`tsc --noEmit -p tsconfig.json`; `vitest run --root . --config vitest.unit.config.ts`;
`DATABASE_URL=… vitest run --root . --config vitest.integration.config.ts`.
CI-only checks (CodeQL, Semgrep packs, gitleaks, checkov, coverage thresholds, dependency-cruiser)
were not run on the builder VM.

## Requirement → test traceability
- Archive/delete fail closed without owner input: `domain.test.ts` "evaluateTransition (fail closed)" (incl. exhaustive check); `service.test.ts` "fail closed until the owner supplies the period ref"; `privilege-rls.int.test.ts` "DB fail-closed"; `api-flow.int.test.ts` "fails closed with POLICY_INPUT_REQUIRED".
- No hard-coded statutory periods: `contracts.test.ts` "statutory policy invention guard"; `domain.test.ts` period-ref cases; `privilege-rls.int.test.ts` "database refuses invented periods".
- Tenant-scoped and audited: `service.test.ts` "tenant context", "OPA enforcement"; `privilege-rls.int.test.ts` FORCE RLS / no-tenant / cross-tenant FK; `api-flow.int.test.ts` "tenant B cannot …".
- SF-CON-RETENTION-POLICY shape: `contracts.test.ts` validates every returned policy (bound and unbound) against the frozen schema; shared envelopes, audit, error, PEP input validated against SF-CON schemas.
- Transitions only when policy allows; LEGAL_HOLD release needs a separate grant; optimistic concurrency; idempotency; atomic state + log + event + audit: `service.test.ts`, `api-flow.int.test.ts`.
- Privilege posture (`sf_cmp049_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS, sf_migrator owner, no DELETE grants, no peer grants) and reversible migration pair: `privilege-rls.int.test.ts`.

## Scope
`logs/write-scope-diff.txt` lists every path changed against the execution base; 0 lines changed in
`pnpm-lock.yaml`, `apps/**`, `contracts/**`, `orchestrator/contracts-lock.yaml`. Frozen contracts
unaltered; `ccr_required=false`.

## Residuals (explicit)
1. `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` — the new workspace package needs an importer row in `pnpm-lock.yaml` (not modified here).
2. OPA policy data for the `RETENTION_*` actions lives in `policy/**` (read-only for this lane); until added the PDP denies (fail-closed).
3. Owner-supplied statutory retention period refs are not provided; archive/delete eligibility remains refused until they are.
4. Period-ref binding is restricted to `PRIVILEGED_ADMIN`/`SYSTEM` + OPA; maker-checker via CMP-051 is not wired (guardian decision).
5. Owner consumers that act on `RetentionEligibilityChanged` (e.g. CMP-032 storage archival) are out of scope.
6. Host mount deferred to SF-M08-007; no UI. Local DB was PostgreSQL 16.15 (distro); CI uses `postgres:16.14-alpine`.
