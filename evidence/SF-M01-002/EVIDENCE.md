# SF-M01-002 evidence (CMP-048 Security Platform)

> **SUPERSEDED — not VERIFIED.** Cursor-host captures below are provenance-invalid for M01 Wave 1 gates (F-V5-002). See [`SUPERSEDED.md`](./SUPERSEDED.md) and [`../m01-w1-remediation/INDEX.md`](../m01-w1-remediation/INDEX.md). Replacement evidence must come from GitHub job `m01-envelope-int`.

| Field | Value |
|---|---|
| Task | SF-M01-002 |
| Component | CMP-048 |
| Integration | INT-011 |
| Branch | `agent/M01-cmp-048-security-platform-SF-M01-002` |
| PR | https://github.com/dbn1972/serviceform-ai/pull/17 |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` |
| Result commit | `9e421342f79344f3605498d9486dff58b69a01d1` (history rewritten; old `1cf3d995` blob removed) |
| Model / effort | claude-opus-5-5, high (as routed) |
| Builder | serviceform-foundation-builder |
| Self-certified | **no** |
| Recommended gate | GATE_READY_WITH_RESIDUALS (human/CI + independent verifiers) |

## Commands and results

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/security/test services/cmp-048-security-platform/test --exclude '**/*.int.test.ts'` | 15 files, **45 passed** (includes PEP 429 + plugin hooks after `@fastify/rate-limit`) |
| `pnpm --filter @serviceform/cmp-048-security-platform test:integration` (DATABASE_URL local PG16, SF_ENVIRONMENT=CI) | 6 files, **18 passed** |
| `opa test -v policy/opa` (OPA 1.21.1) | **48/48 PASS** |
| `scripts/opa-test.sh` (check --strict, fmt --fail, coverage, bundle build, tenant.rego mutation) | pass; coverage **94.73%** lines |
| Privilege-boundary (PB-01..15) | **8/8 pass** (`privilege-boundary.log`) |
| Fail-closed (`pdp-client.fault.test.ts`) | **8/8 pass** (`fail-closed.log`) |
| Local decision p99 | `decision_latency_p99_ms=0.093` (evidence, not a gate) |
| New-src coverage (v8, unit only) | lines **87.65%**, statements 83.33%, functions 82.97%, branches 69.5% |
| `pnpm --filter @serviceform/security typecheck` + cmp-048 typecheck | pass |
| `eslint packages/security services/cmp-048-security-platform --max-warnings=0` | pass |
| `prettier --check` on allowed TS/JSON/MD trees | pass (SQL has no prettier parser) |
| `pnpm gates` | **7/7 passed** (`gates.log`) |
| `pnpm deps:graph` | no violations (124 modules) |
| `python scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-002.yaml --base origin/main` | see `scope-check.log` |
| gitleaks detect (working tree `packages/security/test`) | **no leaks found** (`SYNTHETIC_WRAP_KEY = 'x'.repeat(32)`) |
| gitleaks git (`8a4695d..HEAD` after rewrite) | no leaks; sibling cmp-002 helper hit is out of write scope |

## ADR-0006 / Wave-1 role correction

PostgreSQL has no `CREATE ROLE IF NOT EXISTS`. Migration uses two guarded blocks:

```
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
```

and the same form for `sf_cmp048_rw` plus `NOINHERIT`. Shared `sf_migrator` is created once. Isolation model otherwise unchanged (FORCE RLS, DML to `sf_cmp048_rw`, policies `TO sf_app`, PUBLIC revoked, outbox template frozen).

Runtime test login: `sf_cmp048_rt IN ROLE sf_app, sf_cmp048_rw`. Never `SET ROLE` from superuser. OPA started from the test harness with `--authentication=token --authorization=basic` (not `infra/**`).

## CodeQL (PR comments r4174040932 / r4174040942 / r4174040949)

See `codeql-triage.md`. In-process PEP rate limit (`SF-RATE-001`) and fd-based secret read. No global suppressions. Platform-wide HTTP quotas remain CMP-036 / M00.

## Residuals (not UCS if listed gates hold)

- Frozen outbox/inbox grants still target `sf_app` (ADR-0006 #9).
- Compose OPA remains unauthenticated until infra owners change it.
- Lockfile not committed; orchestrator must reconcile workspace packages (`@serviceform/security` + `@fastify/rate-limit@10.3.0`). Quality / migrations / web-smoke / dependency-audit stay red on `pnpm install --frozen-lockfile` until that reconcile.
- Verifier gaps in `deny-matrix.md` (002-10, 002-26, some variants).
- `sf_migrator` IF-missing from this migration (shared Wave-1 name).

Builder does **not** claim CERTIFIED or VERIFIED. Do not merge from this agent. Wave 2 not started.
