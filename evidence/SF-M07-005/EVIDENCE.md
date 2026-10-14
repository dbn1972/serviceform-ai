# SF-M07-005 — API host M07 composition mounts

Builder evidence only. Not CERTIFIED. G3 = false. G6 = false. Builder does not self-certify.

| Item | Value |
| --- | --- |
| Branch | `cursor/m07-005-host-91f2` |
| Execution base | `6ec17a34` (origin/main after STITCH-A #148) |
| Implementation commit | `8ddc91629b8164de3bb1fde2e492cb6b0be156fb` |
| Authorization | `HUMAN_M07_THROUGH_EVD_AUTHORIZATION` (STITCH-B N/A — no Wave B) |
| Model | route `opus`, release `claude-opus-5-5` |

## Scope

- `apps/api/src/composition/m07.ts` — new; `registerM07Plugins` mounts CMP-022, CMP-024, CMP-023, CMP-012 via
  non-literal dynamic import of each component's transport-neutral `create*Api` + `ROUTE_DESCRIPTORS`.
- `apps/api/src/app.ts` — additive only: import, `m07?` dependency, optional mount block, `m07Mounted` decoration.
  M01–M06/M08 mounts untouched; CMP-036 registered exactly once.
- `apps/api/test/composition-m07.test.ts` — new (10 tests).
- No `apps/api/package.json` / `pnpm-lock.yaml` changes (file-URL fallback as in M06/M08).

## Routes mounted (component descriptors already carry `/v1`)

| CMP | Method | Path |
| --- | --- | --- |
| CMP-022 | POST | `/v1/credentials` |
| CMP-022 | GET | `/v1/credentials/:credential_id` |
| CMP-022 | GET | `/v1/credentials/:credential_id/signing-records` |
| CMP-022 | POST | `/v1/credentials/:credential_id/downstream-outcomes` |
| CMP-022 | GET | `/v1/applications/:application_id/credentials` |
| CMP-024 | POST | `/v1/credential-registry/credentials` |
| CMP-024 | GET | `/v1/credential-registry/credentials/:credential_id/status` |
| CMP-024 | POST | `/v1/credential-registry/credentials/:credential_id/{activate,suspend,reinstate,revoke,reissue}` |
| CMP-023 | POST | `/v1/qr/tokens` |
| CMP-023 | GET | `/v1/qr/tokens/:token_id` |
| CMP-023 | GET | `/v1/qr/verify/:opaque_token` |
| CMP-012 | POST | `/v1/digilocker-publish` |
| CMP-012 | GET | `/v1/digilocker-publish/:publish_request_id` |

Coexistence with CMP-015 `/v1/applications/:applicationId/*` verified (no Fastify route collision).

## Results

| Check | Result | Log |
| --- | --- | --- |
| Host M07 composition vitest | PASS 10/10 | `logs/host-vitest-m07.log` |
| Regression (M05/M06/M08/app) | PASS 44/44 | `logs/regression-vitest.log` |
| Full API host vitest | PASS 81/81 (10 files) | `logs/api-host-full-vitest.log`, `junit/api-host.xml` |
| Typecheck | PASS | `logs/typecheck.log` |
| Build (esbuild) | PASS | `logs/build.log` |
| ESLint | PASS | `logs/eslint.log` |
| Prettier | PASS | `logs/format-check.log` |
| check_scope vs `orchestrator/tasks/SF-M07-005.yaml` | PASS (3 files) | `logs/check-scope.log` |
| contracts-lock | PASS 34/34 FROZEN | `logs/contracts-lock.log` |
| gates run_all | PASS 10/10 | `logs/gates-run-all.log` |

## Tests covered

- No M07 deps → `m07Mounted` undefined, prior decorations unchanged, M07 paths 404.
- Each component mounts independently (only its own routes resolve).
- All four mount in deterministic order; CMP-036 not remounted (plugin count 1, source check).
- Read routes reach each component with server-derived context.
- Fail-closed: resolver returning no context → 401/403 `SF-AUTH-*`/`SF-TEN-*` on every route.
- Commands without `Idempotency-Key` → 400 `SF-SYS-003`, service never reached.
- Forged tenant headers (`x-tenant-id`, `X-Tenant-ID`, `x-tenant`) on all GET/POST routes → 403 `SF-TEN-002`,
  canary not echoed. CROSS_TENANT_LEAKAGE = 0.
- Coexistence with M05 (CMP-015), M06 (CMP-020), M08 (CMP-046).
- Static: no SQL, no tenant literal, no environment branching in host composition.

## Residuals / deferred (not waived)

- Tests use service doubles; DB-backed INT-008/INT-011/INT-013 runs belong to SF-M07-INT.
- CMP-012 host wiring is SIMULATED only; REAL DigiLocker connector validation is required before production.
- `orchestrator/tasks/SF-M07-005.yaml` still reads PLANNING (outside this envelope's write paths); orchestrator to reconcile.
