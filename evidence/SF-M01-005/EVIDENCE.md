# SF-M01-005 EVIDENCE — CMP-037 Integration Hub

> **SUPERSEDED — not VERIFIED.** Cursor-host captures below are provenance-invalid for M01 Wave 1 gates (F-V5-002). See [`SUPERSEDED.md`](./SUPERSEDED.md) and [`../m01-w1-remediation/INDEX.md`](../m01-w1-remediation/INDEX.md). Replacement evidence must come from GitHub job `m01-envelope-int`.

| Field | Value |
|---|---|
| Task | SF-M01-005 |
| Component | CMP-037 |
| Integration | INT-013 |
| Branch | `agent/M01-cmp-037-integration-hub-SF-M01-005` |
| PR | https://github.com/dbn1972/serviceform-ai/pull/18 |
| Builder | serviceform-integration-builder |
| Resolved model | claude-sonnet-5-5, effort high (envelope `model_route: sonnet`) |
| Commit SHA | `8c07433a5f553089f62f05b43016a831a388c65f` |
| Recommended gate | **IMPLEMENTATION_READY_PENDING_INTEGRATION**. Not VERIFIED. Not CERTIFIED. |
| Wave 2 | Not started |

## Commands and results

| Command | Result |
|---|---|
| `pnpm exec prettier --check` on allowed paths / `pnpm format:check` | PASS (see `format-check.log`) |
| `pnpm lint` | PASS (`eslint . --max-warnings=0`) |
| `pnpm typecheck` | PASS (workspace, including `@serviceform/connector-sdk` and `@serviceform/cmp-037-integration-hub`) |
| Unit (`packages/connector-sdk/test` + `services/cmp-037-integration-hub/test` excluding `*.int.test.ts`) | 13 files, **28 passed** (`junit/unit.xml`, `unit.log`) |
| Integration (`pnpm --filter @serviceform/cmp-037-integration-hub test:integration`) against PostgreSQL 16 | 2 files, **10 passed** (`junit/integration.xml`, `privilege-boundary.log`) |
| Focused coverage (new src: connector-sdk + cmp-037 + echo simulator) | **lines 92.15%** (505/548); statements 88.72%; functions 95.31%; branches 72.23% (`coverage-summary.json`). Threshold ≥80% lines met. |
| `pnpm gates` | **7/7 PASS** (`gates.log`) |
| `python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-005.yaml --base origin/main` | see `scope-check.log` |
| `pnpm deps:graph` | PASS, 118 modules, 233 dependencies, no violations (`deps-graph.log`) |
| gitleaks | PASS on PR #18 CI |
| Semgrep 1.179.0 | CI had 3 findings; remediations in connector-sdk + plugin; local re-scan **0 findings** (see `semgrep-triage.md`) |

## Privilege / ADR-0006

Runtime LOGIN `sf_t005_rt`: `NOSUPERUSER NOBYPASSRLS`, members only `sf_app` + `sf_cmp037_rw`. `sf_cmp037_rw` is `NOLOGIN`. Table/schema owner is `sf_migrator`. FORCE RLS on TENANT_SCOPED tables. Cross-component SQL DENY (peer `sf_t005_peer` in `sf_app`+`sf_cmp002_rw` gets permission denied). PUBLIC revoked. Zero `SECURITY DEFINER` in `sf_integration_hub`. `webhook_route` DML granted to `sf_cmp037_rw` only.

**CREATE ROLE:** PostgreSQL does not support `CREATE ROLE IF NOT EXISTS`. Both `sf_migrator` (shared Wave 1, create once, not dropped on down) and `sf_cmp037_rw` are created with:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '...') THEN
    CREATE ROLE ... NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
```

Isolation model otherwise unchanged.

## Frozen outbox residual (ADR-0006 condition 9)

`1759500510000_cmp-037-integration-hub-outbox.sql` contains the rendered frozen template (`{schema}`=`sf_integration_hub`, `{cmp}`=`CMP-037`) with no grant/column edits. Residual: `GRANT INSERT … TO sf_app` on outbox/inbox as in the template. Tightening needs a CCR.

## Simulation / production fail-closed

See `simulation-mode-matrix.md`. PRODUCTION ⇒ REAL for every enabled binding (W1 stricter than frozen contract). Startup `assertProductionSafe` throws `ProductionSimulatedCriticalConnectorError` if a critical/non-REAL enabled binding exists in PRODUCTION. Echo simulator only; no provider-specific adapter.

## Duplicate webhook

See `duplicate-callback.log` and `pg.int.test.ts`. Same provider reference → one `connector_transaction` and one outbox event; second response `duplicate=true`.

## Known limitations (not Wave 2 work)

- Plugin is **not** registered in `apps/api` (read-only; later stitch).
- Simulator is not a pnpm workspace member (`pnpm-workspace.yaml` read-only); coverage included via service tests.
- Same provider_reference + different payload: original row + warning/anomaly metric, no second event (Q11; M05 payment-callback follow-up).
- Stale IN_PROGRESS reconciliation deferred (Q5); replay of in-progress does not re-call the provider.
- Null-tenant / platform-wide bindings out of W1.
- Secret backend is a port (`SecretResolver`); no CMP-048 import.
- `pnpm-lock.yaml` not committed (orchestrator/integration owned). New deps: `fastify` 5.12.5, `fastify-plugin` 5.1.0, `pg` 8.23.1, `@types/pg` 8.23.1. Lockfile reconciliation required before frozen-lockfile CI on this package.
- Configurable defaults (Q9/X-13): 10 s timeout / 3 retries / 5 breaker failures / 30 s open / 300 s webhook skew.

## Hard gates (builder-executed, not certified)

| Gate | Builder observation |
|---|---|
| frozen_contract_conformance | contracts-lock 13/13 FROZEN unchanged |
| cross_tenant_leakage | wrong-tenant SELECT empty; forged `x-tenant-id` 403 |
| unresolved_critical_security | none opened by this builder |
| production_simulated_critical_connector | refused at DB CHECK, resolveMode, startup |
| rls_required_negative_tests | FORCE RLS + tenant policy exercised as `sf_t005_rt` |
| component_privilege_boundary | 005-34..005-41 plus guarded CREATE ROLE assertion |

Independent stitcher / security / evidence verifiers remain required.
