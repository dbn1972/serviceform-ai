# SF-M05-STITCH-A evidence — Wave A mechanical stitch + lockfile

**Outcome: STOPPED — not a STITCHED_CANDIDATE.** Composition and lockfile admission are complete and byte-faithful, but two STOP items remain (see `RESIDUALS.md`). Not CERTIFIED. Not G4. Not G6. Wave B / SF-M05-009 / INT / SEC / EVD / M06 / M08 OFF.

Do **not** merge this stitch. Do **not** merge builder PRs #87/#88/#89/#90.

| Field | Value |
|---|---|
| Task | SF-M05-STITCH-A (LOCK-4) |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/91 |
| Branch | `agent/M05-stitch-a-SF-M05-STITCH-A` (from exactly `6e9f048`) |
| Base | `origin/main` `6e9f0481eb3007dedee5580838cab59ceea66f03` |
| Trees commit | `be789fc622609ddba85ab047f80f41ec6cfde19a` |
| Lockfile / code head (evidence subject) | `2d06259aacd3a8d4abebe48d8b97de63ef952063` |
| Frozen contracts | 19/19 FROZEN MATCH; contracts/** + contracts-lock diff 0; CCR false |
| Self-certified | false |

## Immutable inputs (not rewritten, not merged)

| Task | CMP | PR | SHA |
|---|---|---|---|
| SF-M05-001 | CMP-015 | #90 | `2d68e37c3e01d78129f1604b02fe98bae4048489` |
| SF-M05-002 | CMP-016 | #89 | `50f56aff9cc1e46c927b881f30c249cb9e1955d2` |
| SF-M05-003 | CMP-017 | #88 | `8641c756b539492e3f90d2b04c8a9eb1f2192175` |
| SF-M05-004 | CMP-029 | #87 | `5c4d8ac700364b8b01fa10a44f8a1b049b3da825` |

All five SHAs verified against GitHub at start (no `STITCH_A_AUTHORIZATION_STALE`).

## Tree fidelity

`git checkout <sha> -- <service tree> <its two migrations>` per input. Git tree ids of the four service directories and blob ids of the eight migrations are identical to the accepted heads (`logs/tree-fidelity.log`): **4/4 trees MATCH, 8/8 migrations MATCH, semantic diff 0**. 196 changed files = 187 service files + 8 migrations + `pnpm-lock.yaml` (`changed-files.txt`). Builder `evidence/SF-M05-00*` and handovers not copied. Migration timestamps preserved (`1759540150*`, `160*`, `170*`, `400*`).

## Lockfile

`LOCKFILE.md`. Additive +1191/−0; four importers; Temporal `@temporalio/{activity,client,common,worker,workflow}@1.24.0` + dev `@temporalio/testing@1.24.0` admitted under unchanged `minimumReleaseAge` / `trustPolicy` / `blockExoticSubdeps`. `pnpm install --frozen-lockfile` **PASS**. No `STITCH_A_LOCKFILE_POLICY_BLOCKED`.

## Local executed checks (combined tree `2d06259`, PostgreSQL 16.15, Node 22.14.0, pnpm 10.28.0)

| Check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | `logs/frozen-lockfile.log` |
| `pnpm format:check` | PASS | `logs/format-check.log` |
| `pnpm lint` | PASS | `logs/lint.log` |
| `pnpm typecheck` | PASS | `logs/typecheck.log` |
| `pnpm test:coverage` | PASS 188 files / 1291 tests; stmt 85.43 / branch 75.44 / fn 90.47 / line 88.99 | `logs/coverage-root.log` |
| `pnpm contracts:validate` | PASS | `logs/contracts-validate.log` |
| `contracts_lock_gate.py` | PASS 19/19 FROZEN | `logs/contracts-lock.log` |
| `pnpm test:cdc` | PASS 3 files / 19 | `logs/cdc.log` |
| `pnpm deps:graph` | PASS 1184 modules, 0 violations | `logs/deps-graph.log` |
| `pnpm build` | PASS | `logs/build.log` |
| gate self-tests (pytest) | PASS 25 | `logs/gates-selftest.log` |
| `run_all.py` architecture gates | PASS 10/10 | `logs/architecture-gates.log` |
| `migration_lint.py` | PASS 53 files | `logs/migration-lint.log` |
| `pnpm db:test` (combined chain up/down/up + RLS harness) | PASS 3 files / 17 | `logs/db-test.log` |
| `pnpm audit --prod --audit-level high` | PASS, no known vulnerabilities | `logs/pnpm-audit-prod.log` |
| `pnpm audit --audit-level moderate` (all) | 1 high pre-existing on base (`braces`, dev-only); report-only | `logs/pnpm-audit-all.log` |
| `check_scope.py` (STITCH-A envelope) | **FAIL** — `pnpm-lock.yaml` refused (R-STITCH-A-SCOPE-LOCKFILE) | `logs/check-scope.log` |
| M01 envelope INT | not run locally (needs Kafka/OPA); CI job | CI |

## Per-component suites (combined migration chain, fresh DB per suite)

| Suite | Result | Baseline | Log / JUnit |
|---|---|---|---|
| CMP-015 unit + contract | 125/125 | 125 | `logs/cmp-015-unit.log`, `junit/cmp-015-unit.xml` |
| CMP-015 PostgreSQL int | 27/27 | 27 | `logs/cmp-015-int.log` |
| CMP-016 unit + contract | 136/136 | 136 | `logs/cmp-016-unit.log` |
| CMP-016 PostgreSQL int | **19/21** — 2 migration-order failures (R-CMP016-DOWN2); 18/18 db-isolation PASS | 21 | `logs/cmp-016-int.log` |
| CMP-016 PostgreSQL int, diagnostic without CMP-017/029 migrations | 21/21 | 21 | `logs/cmp-016-int-diagnostic-without-later-migrations.log` |
| CMP-016 Temporal SDK (real Worker + time-skipping server + PostgreSQL), lockfile-installed 1.24.0 | 12/12 | 12 | `logs/cmp-016-temporal-sdk.log`, `junit/cmp-016-temporal-sdk.xml` |
| CMP-017 unit + contract | 74/74 | 74 | `logs/cmp-017-unit.log` |
| CMP-017 PostgreSQL int | 21/21 | 21 | `logs/cmp-017-int.log` |
| CMP-029 unit + contract | 90/90 | 90 | `logs/cmp-029-unit.log` |
| CMP-029 PostgreSQL int | 16/16 | 16 | `logs/cmp-029-int.log` |

JUnit output was redirected to `junit/` by CLI flag, so no file was written under builder evidence paths. `CROSS_TENANT_LEAKAGE=0`: every tenant-negative / FORCE RLS / privilege test in the four integration suites and the Temporal cross-tenant-signal test passed; the only failures are the two migration-order tests.

## Architecture reconfirm (combined migrations)

Per-component roles `sf_cmp015_rw`, `sf_cmp016_rw`, `sf_cmp017_rw`, `sf_cmp029_rw` and `sf_migrator`: `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. ENABLE + FORCE RLS: CMP-015 6/6, CMP-016 8/8, CMP-017 5/5, CMP-029 7/7. Each migration references only its own schema (`sf_application_case`, `sf_workflow`, `sf_tasks`, `sf_sla`) plus `sf_platform.current_tenant_id` and `sf_app.*` session settings — no cross-component SQL.

## CI on code head `2d06259`

| Workflow | Run | Result |
|---|---|---|
| developer-platform | 37325617054 | SUCCESS |
| security | 37325617379 | SUCCESS (dependency audit incl. frozen install, semgrep, CodeQL, gitleaks, checkov) |
| ci | 37325617264 | **FAILURE** — `architecture gates` fails only at `task envelope scope (agent branches only)`; quality, migrations harness, workflows/infra, web smoke, flutter SUCCESS |

`EXPECTED_STITCH_LOCKFILE_ADMISSION` is no longer present anywhere: every frozen install on this head succeeds.

## Residuals / STOP

`RESIDUALS.md`: **R-CMP016-DOWN2** (return to SF-M05-002) and **R-STITCH-A-SCOPE-LOCKFILE** (orchestrator/human). `summary.json` binds base, inputs and results.
