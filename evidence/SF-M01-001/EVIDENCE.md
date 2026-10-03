# SF-M01-001 evidence — CMP-002 Tenant & Government Organisation

**Not CERTIFIED.** Builder recommendation: Design complete; Develop ready for independent Verify.

| Field | Value |
|---|---|
| Task | SF-M01-001 |
| Component | CMP-002 |
| Integration | INT-011 |
| Branch | `agent/M01-cmp-002-tenant-organisation-SF-M01-001` |
| PR | https://github.com/dbn1972/serviceform-ai/pull/14 |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` |
| Result commit | `944574fc7463fdca17a2f45f615b34e7b8857f7a` |
| Model / effort actually used | Cursor Auto / Composer (cloud agent), effort high |
| Envelope route | opus / claude-opus-5-5 (not the executing runtime) |
| Plugin mount | **not** registered in `apps/api` (Wave 2 / CMP-036) |

## Commands and results

| Command | Result |
|---|---|
| Guarded role create (no `CREATE ROLE IF NOT EXISTS`) | PASS (static assert in File A + migration.int.test.ts) |
| `vitest` unit+contract (`vitest.unit.config.ts`) | PASS 38 tests |
| `vitest` integration (`vitest.integration.config.ts`) | PASS 31 tests (PostgreSQL 16, real LOGIN `sf_t001_rt`) |
| Stitch unit coverage (`*.int.test.ts` excluded) | lines **100%**, statements 100%, functions 100%, branches **96.09%** (thresholds 80/80/80/70) |
| `prettier --check` (this package) | PASS |
| `eslint services/cmp-002-tenant-organisation --max-warnings=0` | PASS |
| `pnpm --filter @serviceform/cmp-002-tenant-organisation run typecheck` | PASS |
| `python3 scripts/gates/run_all.py` | PASS 7/7 |
| `pnpm deps:graph` | PASS (110 modules, 199 deps, no violations) |
| Migration down 2 / up | PASS (`evidence/SF-M01-001/migration-roundtrip.log`) |
| `check_scope.py --envelope orchestrator/tasks/SF-M01-001.yaml --base origin/main` | recorded in `scope-check.log` |
| gitleaks / semgrep | GitHub: in-scope helpers.ts connection-string and node_username findings fixed. Sibling `packages/security` leaks remain (out of write scope). |

## ADR-0006 privilege layer (executed)

- `sf_cmp002_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS, created with guarded `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_roles …) THEN CREATE ROLE …`
- Shared `sf_migrator` same idiom; Down does **not** drop `sf_migrator`
- Runtime LOGIN `sf_t001_rt` ∈ `{sf_app, sf_cmp002_rw}`; `rolsuper=false`, `rolbypassrls=false`; not table owner
- TENANT_SCOPED tables ENABLE + FORCE RLS; policies `TO sf_app` using `sf_platform.current_tenant_id()`
- Business DML granted to `sf_cmp002_rw` only (not `sf_app`)
- Cross-component `sf_t001_other` DML permission denied; `SET ROLE sf_cmp031_rw` / `037` / `038` / `048` unavailable
- PUBLIC revoked on schema/tables; `GRANT SELECT TO PUBLIC` fails for runtime
- SF-CON-OUTBOX template copied with `{schema}`/`{cmp}` only (residual: template still `GRANT INSERT … TO sf_app` on outbox/inbox — not tightened)

## Isolation / API (executed)

- Forged tenant / `x-sf-*` / role headers → 403 SF-TEN-002
- GET other tenant → 403; missing context → 401 SF-AUTH-001; null tenant on tenant route → 401 SF-TEN-001
- Idempotency replay same fingerprint 201; different body 409 SF-APP-002
- Maker-checker: same-actor approve fails; second PRIVILEGED_ADMIN + MFA succeeds; emits `TenantPlacementChanged`
- Hierarchy self-parent → 400 + `HIERARCHY_CYCLE`
- RLS matrix written to `rls-negative-matrix.md`

## Residuals / risks (not blockers claimed)

- `pnpm-lock.yaml` not committed (envelope). CI `--frozen-lockfile` **fails** until orchestrator/merger regenerates the lockfile for this workspace importer.
- GitHub gitleaks also reports `packages/security/test/*.ts` from SF-M01-002 (commit `1cf3d995`, not on this branch). `.gitleaks.toml` is not an allowed write.
- In-scope helpers.ts gitleaks/semgrep findings fixed (Pool config fields; no `*User = 'literal'`).
- Stitch unit coverage on `services/cmp-002-tenant-organisation/src` is 100% lines / 96.09% branches (`evidence/SF-M01-001/unit-coverage.log`).
- Plugin not mounted in the API host (intentional, Wave 2).
- Production rollback is forward-fix; Down drops `sf_tenant_org` (data loss) and `sf_cmp002_rw` only.

## Recommended gate status

Design: complete. Develop: IMPLEMENTATION_READY for independent security/evidence verifiers. **Not VERIFIED. Not CERTIFIED.**
