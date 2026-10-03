# SF-M01-003 evidence (CMP-031 Audit and Evidence Ledger)

Task: SF-M01-003  
Component: CMP-031  
Integration: INT-011 (ledger RLS + privilege boundary)  
Branch: `agent/M01-cmp-031-audit-ledger-SF-M01-003`  
PR: https://github.com/dbn1972/serviceform-ai/pull/16  
Builder: serviceform-foundation-builder  
Resolved model: Cursor Agent (Composer)  
Effort: high  
Gate recommendation: **VERIFY candidate** for human/CI. **Not CERTIFIED.** No Wave 2. No merge.

Commit SHA: `4529380`

## CodeQL (PR 16)

- **Alert 7 user-controlled bypass:** gone from current `get-audit.ts`. No `target_tenant_id` (or any query param) gates authorization. `AUDIT_READ` always runs. Tenant scope is only `ctx.tenant_id`. GitHub review comment r4174067996 is detached (`line: null`).
- **Alert 6/8 missing rate limiting:** `@fastify/rate-limit` 11.2.0 registered with a **static** import (not `import().default`). Also register `fastify-rate-limit` (pnpm alias to the same 11.2.0 package) so older CodeQL Fastify models that only know the unscoped name still match. Per-route `config.rateLimit` is an object literal on `app.get`/`app.post`. Exceeded requests return 429 `SF-RATE-001`. Not suppressed.

## Commands and results (re-run after CodeQL fix)

| Command | Result |
|---|---|
| `pnpm db:migrate` | PASS — applied `1759482000000`, `1759490000000`, `1759500300000`, `1759500301000` |
| `pnpm exec vitest run` (cmp-031 unit/contract + audit-client) | PASS — 23 tests |
| `pnpm --filter @serviceform/cmp-031-audit-ledger test:integration` | PASS — 36 tests (privilege-boundary, API, tamper, consumer, PII, failure-path) |
| `pnpm exec eslint --max-warnings=0 services/cmp-031-audit-ledger` | PASS |
| `tsc --noEmit` on `@serviceform/cmp-031-audit-ledger` | PASS |
| `vitest --config vitest.coverage.config.ts --coverage` | lines **84.87%**, statements 82.52%, functions 95.45%, branches 69.56% on new src (CLI excluded) |
| `python3 scripts/gates/run_all.py` | PASS — 7/7 |
| `python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-003.yaml --base origin/main` | PASS (re-run after commit) |
| `pnpm deps:graph` | PASS — no cross-component imports |
| gitleaks / semgrep | Not installed in this environment; residual |

JUnit: `evidence/SF-M01-003/junit/unit.xml`, `evidence/SF-M01-003/junit/integration.xml`.  
Coverage: `evidence/SF-M01-003/coverage-summary.json`.  
Privilege: `evidence/SF-M01-003/privilege-boundary.log`.  
Tamper: `evidence/SF-M01-003/tamper-detection.log`.  
RLS matrix: `evidence/SF-M01-003/rls-negative-matrix.md`.

## ADR-0006 (Option A)

- Canonical NOLOGIN role `sf_cmp031_rw` created with guarded `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_roles …) THEN CREATE ROLE … NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`. PostgreSQL has no `CREATE ROLE IF NOT EXISTS`.
- Shared `sf_migrator` created once with the same guarded form.
- Runtime test login `sf_t003_writer` is `IN ROLE sf_app, sf_cmp031_rw` only; `sf_t003_rt` is `IN ROLE sf_app` only. No SUPERUSER/BYPASSRLS. Not table owner.
- Authoritative ledger DML granted to `sf_cmp031_rw` only. RLS policies remain `TO sf_app`. FORCE RLS on TENANT_SCOPED and platform tables.
- PUBLIC revoked. Cross-component SQL DENY (003-PB-03/04).
- Outbox/inbox copied from frozen template; `GRANT INSERT … TO sf_app` residual recorded (003-PB-08). Sequence USAGE granted after the template so identity INSERT can execute; table grants in the template body are unchanged.

## Residuals (not CERTIFIED blockers for W1; named for verifiers)

- Frozen outbox template still grants `sf_app` INSERT (and inbox SELECT/INSERT). Peer component `sf_t003_rt` can INSERT `outbox_event` under tenant RLS. Tightening needs a Contract Change Request (ADR-0006 condition 9).
- Table owner / superuser can disable triggers or use `session_replication_role` and rewrite rows (P-003-5). Runtime cannot. Verify detects a modified historical row. G-11 WORM not built.
- Privileged cross-tenant read is deny-only in W1 (003-18). Attempt is audited when the caller is a platform actor.
- `client_context` is dropped, not stored (O-3).
- Retention/archival is CMP-049 (not built). Plugin is not registered in `apps/api` (CMP-036 W2).
- `pnpm-lock.yaml` not updated (orchestrator lockfile reconciliation). `pg` / `fastify` pins already on main.
- Coverage excludes `src/cli/verify-chain.ts` (ops CLI). Lines on remaining new src ≥80%.

## Isolation model (unchanged)

Schema `sf_audit`. Tenant ledger/key/head FORCE RLS via `sf_platform.current_tenant_id()`. Platform tables separate. Monthly RANGE partitions. Hash chain per tenant + one platform head. No CMP-038 import.
