# SF-M10-B-CMP012-PG — CMP-012 PostgreSQL DigiLocker publish repository

- Code commit under test: `d7465221978a606b5df5fa7ed6139678ea6dba34` (base `origin/main` `4df2a0be2723c7a30a6ebc65ddf14ff89f7e7f91`)
- Branch: `cursor/m10-cmp012-pg-repository-0b20`
- Builder: serviceform-credential-builder, model route `opus` (Claude Opus 5.5)
- Environment: local PostgreSQL 16.15, Node 22.23.4, disposable database `sf_cmp012`
- Connector mode: SAMPLE_LAB / SIMULATED only. REAL DigiLocker held.
- Status: CERTIFIED=false, G6=false, self_certified=false. Recommended gate status is for human/CI review only.

## Executed commands

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `pnpm format:check` | 0 | clean | `format-check.log` |
| `pnpm lint` | 0 | clean | `lint.log` |
| `pnpm --filter @serviceform/cmp-012-digilocker run typecheck` | 0 | clean | `typecheck.log` |
| `pnpm --filter @serviceform/cmp-012-digilocker run test:unit` | 0 | 73/73 passed (7 new in `pg-repo.test.ts`) | `test-unit.log` |
| `pnpm --filter @serviceform/cmp-012-digilocker run test:integration` | 0 | 19/19 passed | `test-integration.log` |
| `python3 scripts/gates/run_all.py` | 0 | 10/10 gates passed | `gates.log` |
| `pnpm test` (root, excludes `*.int.test.ts`) | 0 | 2994/2994 passed, 311 files | `root-test.log` |

Exit codes are also in `exit-codes.txt`.

## Negative control

With `ROW LEVEL SECURITY` temporarily disabled on `sf_digilocker.publish_record` in the
disposable database, the two RLS tenant-negative tests fail as expected (2 failed / 17 passed,
`negative-control-rls-disabled.log`). RLS was re-enabled afterwards (`relrowsecurity=t`,
`relforcerowsecurity=t`) and the suite re-run green.

## Integration coverage

Login roles per ADR-0006: runtime `sf_t012_rt` = `sf_app` + `sf_cmp012_rw`; peer `sf_t012_peer` =
`sf_app` + `sf_cmp022_rw`; `sf_t012_app` = `sf_app` only.

- Publish record insert/get/update round-trip; domain outbox row committed in the same tx; rollback
  discards record and outbox together; tenant-null audit envelopes land in `outbox_event_platform`.
- CHECK invariants: `issuance_reversed_on_publish_failure=true` and FAILED without `failure_code`
  are refused (23514); immutable columns cannot be updated and rows cannot be deleted (42501).
- Idempotency: claim → `claimed`; replay returns stored IN_PROGRESS record; complete → peek and
  re-claim return COMPLETED 201 response; records are tenant-isolated.
- Tenant-negative: T1 record invisible/unupdatable under T2 (repository and raw SQL); no tenant
  context sees nothing; mismatched-tenant writes refused by the repository (SF-TEN-002) and by RLS
  WITH CHECK when bypassing the repository (42501); missing tenant context → SF-TEN-001.
- Privilege boundary: peer and sf_app-only logins get 42501 on read/write of `publish_record` and
  `idempotency_record`; tables owned by `sf_migrator` with FORCE RLS; runtime role is not
  superuser/BYPASSRLS.
- `inTransaction()` true only inside `withTx`, false after success and failure; nested `withTx`
  refused.
- Full `DigiLockerService` flow with the SIMULATED connector: PUBLISHED and FAILED outcomes, domain +
  audit outbox, connector invoked outside any DB transaction, idempotent replay with a single
  persisted record, fingerprint mismatch → SF-APP-002, cross-tenant read → SF-SYS-002, non-ISSUED
  credential persists nothing.

## Gaps

- No CI job runs CMP-012 integration tests: `pnpm db:test` only runs `db/test/**`, and
  `scripts/ci/run-m01-envelope-int.sh` covers M01 components only. Wiring requires a
  `.github/workflows` change outside this task's write paths.
- `claimIdempotency` mirrors the memory double and returns the existing record without a fingerprint
  check; the service enforces fingerprint equality in `priorResult()` before claiming.
- The junit reporters in `vitest.*.config.ts` write to `evidence/SF-M07-004/junit/`; those files
  were regenerated locally and intentionally not committed.
