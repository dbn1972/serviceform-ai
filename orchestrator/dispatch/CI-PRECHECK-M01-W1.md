# CI precheck M01-W1 (executed 3 October 2026)

| Field | Value |
|---|---|
| Commit run | `993b35599e720dd1828aa495bc4572a3c8ab1966` (PR #6 head at check start) |
| GitHub Actions | PR checks were **queued, not executed** (runs 37130945600 ci, 37130945590 security) at 14:54–14:57 UTC |
| Local SHA | same |

This is executed evidence, not certification.

## Local results (this VM, Node 22.14.0, pnpm 10.28.0)

| Check | Result | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS (13s) | |
| `pnpm format:check` | PASS (2s) | |
| `pnpm lint` | PASS (2s) | |
| `pnpm typecheck` | PASS (10s) | |
| `pnpm test:coverage` | PASS (2s) | 33 tests, 6 files; lines 95.77% |
| `pnpm contracts:validate` | PASS (1s) | |
| `pnpm deps:graph` | PASS (2s) | |
| `python3 -m pytest scripts/gates/tests -q` | PASS after `pip install -r scripts/requirements.txt` | first attempt FAIL: `No module named pytest` (env gap, not product). Retry: **17 passed** |
| `python3 scripts/gates/run_all.py` | PASS | 7/7 gates |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | PASS (23s) | |
| `python3 scripts/gates/migration_lint.py` | PASS | |
| FROZEN contract hash reconfirm (13/13) | PASS | |
| `pnpm audit --prod --audit-level high` | PASS | no known vulnerabilities |
| `pnpm e2e` (Playwright Chromium 1.63.0) | PASS | 20 tests |
| `pnpm db:test` against local PostgreSQL 16.15 | PASS | 16 tests, 3 files |
| gitleaks / semgrep / checkov / terraform / actionlint / flutter / docker compose | **NOT RUN** | binaries not installed on this VM |

## GitHub required jobs (ci.yml + security.yml)

All listed jobs were **pending/queued** when inspected. They are not PASS. Do not treat PR #6 as CI-green.

## Does this block M01 builder start?

- Local quality, contracts, architecture gates, unit, build, e2e, db/RLS harness: executed PASS on 993b355. **Not a product-code failure.**
- Gate self-test first FAIL was missing pytest in the image; resolved by installing `scripts/requirements.txt`. **Does not block M01** once pytest is in CI (already in architecture-gates job).
- GitHub Actions not yet green, and secret/SAST/IaC/Flutter jobs have **no executed result here**. Owner merge policy (G-01) still requires GitHub CI green before merge. For **builder start**, incomplete GitHub security/mobile jobs are a **dispatch hold** until those jobs actually run.
- ADR-0006 owner decision is a separate dispatch hold (see decision brief).
