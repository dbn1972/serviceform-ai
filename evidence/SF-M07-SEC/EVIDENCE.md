# SF-M07-SEC evidence — independent security verifier

**Not CERTIFIED. Not G3. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M07-SEC |
| Components | CMP-022 credential engine · CMP-024 credential registry · CMP-023 QR verification · CMP-012 DigiLocker |
| Integrations | INT-008 · INT-011 · INT-013 |
| Branch | `cursor/m07-sec-91f2` |
| Base | `dfa96a0e8b61754d2ed6323bae8455caf5a285aa` (host #149 merged on main) |
| Test commit | `a6ad0dc` |
| Model route | opus (`claude-opus-5-5`), verifier role |
| Suite | `pnpm exec vitest run -c tests/security/m07/vitest.config.ts` |
| Result (live PG 16) | **44/44 PASS**, 8 files — `logs/vitest-with-db.log`, `junit/security.xml` |
| Result (no DB) | 37 PASS, 7 skipped (DB file `describe.skipIf`) — `logs/vitest-no-db.log` |
| CROSS_TENANT_LEAKAGE | **0** |
| Production/owner code modified | **false** |
| Blocking hard-gate failures | **0** (no exploitable cross-tenant, RLS, or status-authority bypass found) |

## Coverage

| Area | Suite | Evidence |
|---|---|---|
| Forged tenant/identity headers at host (SF-TEN-002) | `host-forged-tenant.test.ts` | 17 routes × 11 header spellings → 403 SF-TEN-002, schema-valid, canary never reflected or logged, 0 service hits |
| Missing / throwing server context | `host-forged-tenant.test.ts` | All 17 routes 401/403, no stack or canary in body, 0 service hits |
| Idempotency-Key enforcement | `host-forged-tenant.test.ts` | All 9 POST routes refuse missing/empty/short/oversize key (400 SF-SYS-003) |
| Component-level header guards (defence in depth) | `component-guards.test.ts` | CMP-022/023/024 refuse tenant/identity headers + `Forwarded: tenant=` themselves; CMP-012 gap (F01, F02) |
| Authz deny-by-default | `authz-deny-by-default.test.ts` | Deny → 403 SF-AUTH-002; PDP outage → 503 SF-SYS-004; malformed decisions (null, {}, "true", 1) deny on CMP-022/023/024; no writes, no connector calls; CMP-012 gap (F04) |
| OPA bundle | `authz-deny-by-default.test.ts` | `default allow := false`; no M07 action in catalogue → live PDP returns UNKNOWN_ACTION (fail-closed, residual R1) |
| Tenant isolation / IDOR | `tenant-isolation.test.ts` | Tenant B cannot read/list/mutate tenant A credentials, registry status, QR tokens (by id or opaque), publish records; cross-tenant port responses refused SF-TEN-002 |
| Status authority (QR cannot write status) | `status-mutation-boundary.test.ts` | CMP-023 routes = mint + 2 reads; registry port = single `getStatus`; no CMP-024 import/SQL in CMP-023/012; CMP-022 port = `register` only; CMP-024 read port frozen; INTEGRATION (QR workload) and CITIZEN get ACTOR_NOT_PERMITTED on every lifecycle verb even with allow-all OPA; verify reflects revocation live, `no-store`, 503 on registry outage |
| Live DB privileges + RLS | `db-privilege-rls.test.ts` | All M07 tenant tables ENABLE+FORCE RLS (only `*_platform` exempt); runtime roles NOSUPERUSER NOBYPASSRLS; only `sf_cmp024_rw` can write registry (022/023/012 → 42501 on UPDATE/SELECT/INSERT/DELETE); no M07 role can read another M07 schema; RLS hides tenant A rows from tenant B, UPDATE affects 0 rows, WITH CHECK blocks foreign tenant_id, unset tenant sees nothing |
| PII / secrets | `pii-logging.test.ts` | No Aadhaar/mobile/PAN/email/private-key/AWS-key/bearer literals in M07 src, fixtures or these tests; no `console.*`; QR audit stores token ref not opaque token; host logs exclude bodies, idempotency keys, query strings; opaque token in path IS logged (F05) |
| DigiLocker preconditions / SIMULATED | `digilocker-preconditions.test.ts` | SIMULATED refused in PRODUCTION (critical and non-critical); foreign-tenant binding refused; no ISSUED/consent verification (F06) |

## Findings (owner remediation — not patched here)

| ID | Severity | Component | Finding | Exploitable via API host today |
|---|---|---|---|---|
| M07-SEC-F05 | **HIGH** | Host / CMP-047 access log × CMP-023 | `GET /v1/qr/verify/:opaque_token` puts the bearer verification token in the path; `sanitizeUrlForLog` strips only query/fragment, so the token is written to `incoming request` and `request completed` log lines. Anyone with log access can replay verification (purpose-minimised view only, but still a credential-linked bearer secret in logs; Constitution: no tokens in logs). | Yes (log readers) |
| M07-SEC-F06 | **HIGH** (privacy/integrity; blocks REAL enablement) | CMP-012 | `publishCredential` never checks CMP-022 (credential ISSUED and same tenant) or CMP-030 (consent active for purpose). `DigiLockerServiceDeps` has no credential or consent port; row records `credential_lifecycle_status_at_request: 'ISSUED'` unconditionally. Frozen SF-CON-DIGILOCKER-PUBLISH requires both. Storage key is tenant-prefixed, so no cross-tenant read, but consent/purpose is not enforced. | Yes (any OPA-permitted publisher) — SIMULATED only today |
| M07-SEC-F04 | MEDIUM | CMP-012 | `authorize()` uses `!decision.allow` (truthy) instead of `allow === true`; `allow: "true"` / `allow: 1` permit (201), `null` decision throws → 500 instead of a mapped deny. CMP-022/023/024 are strict. | Only with a malformed PDP response |
| M07-SEC-F01 | MEDIUM (defence in depth) | CMP-012 | Component header guard blocks only `x-real-tenant-id`, `x-bypass-rls`, `x-override-tenant`; accepts `x-tenant-id`, `x-sf-*`, `x-roles`, `x-actor-type`, `x-assurance`, `x-org-id`, `Forwarded: tenant=`. CMP-036 edge still refuses all of these. | No (edge blocks) |
| M07-SEC-F02 | MEDIUM (defence in depth) | CMP-012 | `requireTenantContext` checks only null tenant; non-UUID tenant and malformed actor id reach the service. CMP-022/023/024 validate shape. | No (host resolver supplies context) |
| M07-SEC-F03 | LOW | CMP-036 edge, CMP-022/023/024 | `x-bypass-rls` passes the host edge for CMP-022/023/024 (CMP-012 refuses it). Header is inert (nothing reads it; with no context every route still fails closed). Inconsistent deny-list only. | No |

## Residuals

- **R1** OPA catalogue (`policy/opa/sf/common/data.json`) has no M07 actions or resource types; under a live PDP every M07 action denies as UNKNOWN_ACTION. Fail-closed, but M07 is not functional end-to-end until policy data lands (owner/policy task).
- **R2** CMP-012 has no PostgreSQL repository (`src/repo/pg.ts` absent); DB-backed RLS for publish is verified at schema/grant level only, not through the component.
- **R3** Live OPA (`opa` binary) unavailable in this environment; OPA coverage is static plus PEP-level fakes.
- **R4** REAL DigiLocker and REAL signer remain deferred; SIMULATED fail-closed in PRODUCTION verified at the binding-policy layer.
- **R5** `fastify` types do not resolve from repo root for an ad-hoc `tsc` over `tests/security/m07` (same as M06-SEC); runtime under vitest is unaffected. ESLint + Prettier clean.

## Environment

Local PostgreSQL 16 cluster; disposable database migrated with the full `db/migrations` chain (`node-pg-migrate up`). Admin URL supplied only via `M07SEC_DATABASE_URL` at run time; no credentials are committed. Test login roles (`sf_m07sec_r0xx`) are created with a random password and dropped after the run.

## Certification stance

CERTIFIED=false · G3=false · G6=false. Recommendation: **do not recommend G3 for M07 until F05 and F06 are remediated and re-verified**; F01/F02/F04 should be fixed in the same CMP-012 change. No hard tenant-isolation, RLS or status-authority gate failed.
