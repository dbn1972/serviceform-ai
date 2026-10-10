# SF-M08-003 builder evidence (CMP-045 Analytics & MIS)

Builder output only. Not CERTIFIED, not G3, not G6, not self-certified. Recommended gate status:
`BUILDER_CANDIDATE_READY` for independent builder review. Certification requires independent
verification and a human/CI gate.

| Field | Value |
|---|---|
| Task / component | SF-M08-003 / CMP-045 (INT-010, INT-011) |
| Dispatch base | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` (`origin/main` at dispatch) |
| Branch | `agent/M08-analytics-SF-M08-003` |
| Code commit the logs were produced on | `1eccfd63a6d68ad1fa448d4ad11129ab50cee939` (see `logs/code-commit.txt`); later commits on the branch change only `evidence/SF-M08-003/**` and `orchestrator/handovers/SF-M08-003.yaml` |
| Local run environment | Node v22.14.0, pnpm 10.28.0, PostgreSQL 16.15 (Ubuntu package; CI pins 16.14, CI result is the authoritative run) |
| Connector mode | none (no external connector; replay source is an in-memory simulator, never production) |
| Run identifiers | local run; GitHub Actions run ids are bound by the PR head SHA once CI reports |

## Results (executed, logs under `logs/`)

| Check | Result | Log |
|---|---|---|
| typecheck (`tsc --noEmit`, strict + exactOptionalPropertyTypes) | exit 0 | `logs/typecheck.log` |
| eslint `--max-warnings=0` | exit 0 | `logs/eslint.log` |
| prettier `--check` | exit 0 | `logs/prettier.log` |
| unit + contract (4 files) | 70 passed / 0 failed | `logs/unit.log`, `junit/unit.xml` |
| root `vitest run services/cmp-045-analytics-mis` | 70 passed | `logs/root-vitest.log` |
| PostgreSQL integration (privilege/RLS/guards + end-to-end) | 22 passed / 0 failed | `logs/integration.log`, `junit/integration.xml` |
| Unit coverage of `src/**` (pg.ts partly integration-covered) | stmts 88.8%, branches 81.4%, funcs 88.3%, lines 91.4% | `logs/coverage-unit.log` |
| repo gates (`scripts/gates/run_all.py`) | 10/10 passed (contracts-lock 29/29 FROZEN, migration-lint, openapi-asyncapi, hardcoding, ...) | `logs/gates.log` |
| migration lint | pass | `logs/migration-lint.log` |
| dependency-cruiser | no violations (37 modules) | `logs/depcruise.log` |
| `pnpm db:test` (shared migrations/tenant-isolation harness) | 17 passed | `logs/db-test.log` |
| migration down (both files) then up | schema dropped then 9 tables recreated | manual run, recorded below |

## Requirement and risk mapping

| Requirement | Test evidence |
|---|---|
| Aggregates only, no raw PII payload (`SF-CON-ANALYTICS-METRIC`) | `domain.test.ts` (privacy, contributionOf), `analytics-api.test.ts` (ingest: aggregates, UNCLASSIFIED, no PII in stored state), `contracts.test.ts` (frozen schema conformance, stored column allowlist), `privilege-rls.int.test.ts` (DB refuses PII-shaped dimensions), `api-flow.int.test.ts` (full-table dump contains no canary PII) |
| Purpose limitation | `analytics-api.test.ts` (purpose mismatch refused and audited, context purpose wins), DB trigger requires point purpose == definition purpose (`privilege-rls.int.test.ts`) |
| Disclosure control | `analytics-api.test.ts` and `api-flow.int.test.ts` (small cohort suppressed, value never returned) |
| Tenant isolation (INT-011) | `analytics-api.test.ts` (headers refused, tenant B cannot read/retire/rebuild A), `privilege-rls.int.test.ts` (FORCE RLS, forged tenant, cross-tenant UPDATE/DELETE affect 0 rows, other component login denied), `api-flow.int.test.ts` (T2 negative at API/repository/DB) |
| Projection only, no authoritative state | `contracts.test.ts` (no case/application/payment reference in code, SQL or grants; only own schema; route allowlist), `privilege-rls.int.test.ts` (no DML outside `sf_analytics`) |
| Rebuildable derived store (INT-010) | `analytics-api.test.ts` and `api-flow.int.test.ts` (rebuild equals live, corruption repaired, live events mid-rebuild, lease refusal, takeover, failed rebuild keeps active generation, cross-tenant replay event refused) |
| Duplicate delivery safe | `analytics-api.test.ts`, `api-flow.int.test.ts` (12 events delivered twice concurrently, exact counts) |
| Failure paths | PDP down (503), deny (403), replay outage (503), schema-version mismatch, bad SUM value, future event time, tenant-less event, failed commit leaves no partial aggregate |
| No network in a DB transaction | `analytics-api.test.ts` (inTransaction probe over PEP and replay), `contracts.test.ts` (`NETWORK_IN_TX`) |
| Frozen contracts untouched | `contracts.test.ts` re-hashes `SF-CON-ANALYTICS-METRIC` against `contracts-lock.yaml`; `git diff` shows no `contracts/**`, `contracts-lock`, `pnpm-lock.yaml` change |

## Test sensitivity (mutation spot checks, executed locally, reverted)

Each defect below made at least one test fail; the code was restored afterwards.

| Defect injected | Tests that failed |
|---|---|
| suppression disabled | 1 (suppression) |
| purpose filter removed | 2 (purpose refusal, envelope/error conformance) |
| inbox duplicate guard removed | 2 (duplicate delivery, consumer authorization) |
| dimension value sanitiser removed | 3 (privacy domain and ingest) |
| live apply limited to active generation | 1 (mid-rebuild live event) |
| DB trigger category-code check disabled (SQL) | 2 integration (PII-shaped dimension refusal, bypass attempt) |

## Known limitations and residuals

- `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`: `pnpm-lock.yaml` is not modified; the frozen-lockfile
  importer for this workspace package is admitted at STITCH-A. The package declares no dependencies.
- Host mount, CMP-038 subscription wiring and the production `EventReplayPort` binding are SF-M08-007.
- Retention/archival is SF-M08-005 (`STATUTORY_RETENTION_POLICY_INPUT_REQUIRED`); no period was defined or assumed.
- Suppression is per cell; cross-query differencing needs an owner policy decision (README, residual risks).
- No performance, resilience, backup/restore or real-connector validation was run (out of builder scope).
- The numeric cohort threshold is published definition data; tests use arbitrary values and none is a policy claim.
