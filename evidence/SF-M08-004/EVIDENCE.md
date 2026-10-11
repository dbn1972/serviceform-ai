# SF-M08-004 evidence — CMP-046 Operational Dashboard

Builder candidate evidence only. **Not CERTIFIED / not G3 / not G6.** No gate is issued here; independent
INT / SEC / EVD and a human or CI gate are still required. Recommended gate status: none (builder candidate).

- Dispatch base (exact): `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` (== `origin/main` at dispatch)
- Branch: `agent/M08-ops-SF-M08-004` — draft PR [#116](https://github.com/dbn1972/serviceform-ai/pull/116)
- Implementation commit the logs below were produced on: `81603210c3fc3333714de7ca4936280868667d55`
  (`logs/impl-head.txt`). Later commits add only this evidence directory and the handover YAML.
  The frozen candidate head is the branch tip recorded in the PR and in the builder return.
- Agent / model: Cursor Cloud Agent, Claude Sonnet 5.5 (per `MODEL-ROUTING-QUALITY.md`; self-assessment is not evidence).

## Guard (before branching)
`origin/main == 8b1c26ce…` PASS; own envelope READY / `implementation_authorized=true` / `dispatched=false` /
`wave_eligible_now=true` PASS; `cg01_path_uniqueness_gate.py` PASS; contracts lock 29/29 FROZEN MATCH
(`logs/gates.log`); #107 / #108 / #109 OPEN at `59ddddd4…` / `d1614d70…` / `8b270beb…`.

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` | exit 0 | `eslint.log` |
| Prettier `--check` | exit 0 | `prettier.log` |
| Unit + contract (vitest) | 59/59 pass (22 domain, 25 service/API, 12 contract) | `unit-contract.log`, `junit/unit.xml` |
| Integration on PostgreSQL 16.15 (real LOGIN roles, FORCE RLS) | 13/13 pass (7 privilege/RLS/reversibility, 6 API flow) | `integration-postgres16.log`, `junit/integration.xml` |
| Repo gates `run_all.py` | 10/10 pass (migration-lint, contracts-lock 29/29, openapi-asyncapi, hardcoding, uniqueness, …) | `gates.log` |
| Semgrep (repo `.semgrep/` rules, 1.x) | 0 findings | `semgrep-local-rules.log` |
| dependency-cruiser | no violations | `depcruise.log` |
| Coverage of `src/` (unit+contract only) | stmts 81.5 %, branches 76.9 %, funcs 75.6 %, lines 85.8 % | `coverage-unit.log` |

CI-only checks (CodeQL, registry Semgrep packs, gitleaks, checkov, web/flutter) are not reproducible on the builder VM;
the exact-head GitHub workflows on the PR are the evidence for those.

## Requirement → test traceability
- OPA on every protected view, fail-closed, denial audited: `test/unit/service.test.ts` “OPA enforcement”; `api-flow.int.test.ts` “denies and fails closed”.
- Wrong-tenant / unauthorized access denied: “tenant isolation”, “OPA enforcement”, `privilege-rls.int.test.ts` (FORCE RLS, no-tenant session, peer role).
- No case approval / SLA actions: “ops surface only” (route allow-list), `contracts.test.ts` boundary tests, DB CHECKs (source pinning, `non_authoritative`), no grants on peer schemas (`privilege-rls.int.test.ts`).
- Consume SLA / integration / event / health via ports; no network in DB txn: `contracts.test.ts`, “never calls a source port inside a database transaction”, source-failure tests.
- Aggregates only (no PII / individual records): `domain.test.ts` “normalizeSample”, “refuses a payload that carries individual records”.
- Idempotency, atomic outbox + audit + snapshot, rollback: “idempotency”, “rolls … back together”, `api-flow.int.test.ts`.
- Reversible migration, role retained: isolated-chain `down 2` / `up` in `privilege-rls.int.test.ts`.

## Scope
`logs/write-scope-diff.txt` lists every path changed against the dispatch base; 0 lines changed in `pnpm-lock.yaml`,
`contracts/**`, `orchestrator/contracts-lock.yaml`, `orchestrator/tasks/**`, `apps/**`, `specs/**`, `policy/**`, `infra/**`,
`scripts/**`, `packages/**` or any sibling service. `CCR_REQUIRED=false`; frozen contracts unaltered.

## Residuals (explicit, not hidden)
1. `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` — the new workspace package needs an importer row; owned by STITCH-A.
2. OPA policy data for `OPS_VIEW_SLA|QUEUE|INTEGRATION|EVENTS|HEALTH` and `OPS_REFRESH_VIEW` lives in `policy/**` (read-only here). Until added, the PDP denies: fail-closed, not open.
3. Owner adapters for the five `SummaryPort`s do not exist yet; unbound ports report `UNAVAILABLE`. QUEUE view sources CMP-017 aggregates (CMP-017 is on main; the envelope notes list 029/037/038/047 — flagged for guardian review).
4. Host mount deferred to SF-M08-007; no UI (UX4G) delivered. A cross-tenant / platform-wide operator view was deliberately not built (would need an ADR).
5. Concurrent *first* refreshes of the same tenant/view may lose a unique-key race and return 409; clients retry.
6. Local integration DB used PostgreSQL 16.15 from the distro; CI uses `postgres:16.14-alpine`.
