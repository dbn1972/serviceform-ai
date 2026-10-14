# SF-M07-STITCH-A — M07 Wave A mechanical stitch

- Role: serviceform-integration-stitcher (independent; no owner production code changed)
- Model route: opus (resolved: Claude Opus, Cursor cloud agent `bc-e5e8844a-4929-5f4e-828f-333f89489cf1`)
- Base: `origin/main` @ `53a2c86` (Merge PR #146, SF-M07-004 DigiLocker)
- Branch: `cursor/m07-stitch-a-91f2`
- Authorization: `HUMAN_M07_THROUGH_EVD_AUTHORIZATION = true`
- Status: CANDIDATE_COMPLETE. NOT CERTIFIED. G3 not issued. G6 not issued.

## Change set

| Path | Change |
| --- | --- |
| `pnpm-lock.yaml` | Admit importers `services/cmp-012-digilocker`, `services/cmp-022-credential-engine`, `services/cmp-023-qr-verification`, `services/cmp-024-credential-registry` (all `{}`: no declared deps); pnpm also dropped 2 stray blank lines (`sonic-boom` / snapshots) |
| `package.json`, `pnpm-workspace.yaml` | Unchanged — `services/*` glob already admits the packages |
| `services/**`, `db/migrations/**`, `contracts/**`, `apps/**` | Unchanged — no mechanical fixes were needed |

## Gate results (local, Node 22.14.0, pnpm 10.28.0)

| Gate | Result | Log |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` (with regenerated lock) | PASS | `logs/install-frozen.log` |
| `pnpm format:check` | PASS | `logs/format-check.log` |
| `pnpm lint` (`--max-warnings=0`) | PASS | `logs/lint.log` |
| `pnpm typecheck` (recursive; includes 4 M07 packages) | PASS | `logs/typecheck.log` |
| `pnpm test:coverage` (root) | PASS — 279 files / 2696 tests | `logs/root-test-coverage.log` |
| `pnpm contracts:validate` | PASS | `logs/contracts-validate.log` |
| `pnpm deps:graph` | PASS | `logs/deps-graph.log` |
| `pnpm build` | PASS | `logs/build.log` |
| `scripts/gates/migration_lint.py` | PASS | `logs/migration-lint.log` |
| `scripts/gates/contracts_lock_gate.py` | PASS | `logs/contracts-lock-gate.log` |
| `scripts/gates/run_all.py` | PASS | `logs/gates-run-all.log` |

### Per-package

| Package | Unit | PostgreSQL integration (full chain, fresh DB, 3 consecutive runs) |
| --- | --- | --- |
| CMP-022 credential-engine | 145/145 PASS | 10/10 PASS x3 |
| CMP-024 credential-registry | 85/85 PASS | 9/9 PASS x3 |
| CMP-023 qr-verification | 62/62 PASS | 13/13 PASS x3 |
| CMP-012 digilocker | 40/40 PASS | N/A — no `test/integration/**/*.int.test.ts` exist (see finding F1) |

Integration ran against a throwaway local PostgreSQL database `sf_m07_stitch_a` with a throwaway
superuser (random password, not logged); both were dropped after the run. Suites applied the
complete combined migration chain themselves, so CMP-022/024/023 migrations co-exist on main.

## Findings (recorded against owners; not patched)

- **F1 — CMP-012 (SF-M07-004), non-blocking:** `test:integration` script is defined but no
  integration test files exist; the script exits 1 ("No test files found"). Root CI does not call
  per-package `test:integration`, so CI is unaffected. Owner should either add INT-008/INT-013
  integration tests or drop the script.
- **F2 — CMP-012/022/023/024 vitest configs, non-blocking hygiene:** per-package unit/integration
  configs write JUnit to the owner evidence folders (`evidence/SF-M07-00{1..4}/junit/*.xml`), so
  any local re-run dirties committed owner evidence. Restored after this run; no owner evidence
  was modified in this commit.

## Not claimed

No CERTIFIED, G3, or G6. Recommendation for parent: SF-M07-STITCH-A is merge-ready for
SF-M07-INT / SF-M07-SEC to proceed.
