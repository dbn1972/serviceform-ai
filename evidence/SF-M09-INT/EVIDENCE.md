# SF-M09-INT evidence — independent integration stitcher (CG-03)

**Not CERTIFIED. Not G3. Not G4. Not G6. `self_certified: false`. Recommend only.**
Authorization: `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION`.

| Field | Value |
|---|---|
| Task | SF-M09-INT (integration_stitcher, independent of builders) |
| Branch | `cursor/m09-int-91f2` |
| Execution base | `91640ac117c2a1307682d3066d46e9cbcfd0b3c1` (merge #170, SF-M09-HOST on `main`) |
| Model route / release | `opus` / `claude-opus-5-5` |
| Run | `local-vitest-2026-10-15T17:16Z` — `npx vitest run --config tests/integration/m09/vitest.config.ts` |
| Vitest | **FAIL — 49 passed / 9 failed / 58 total** (`logs/vitest.log`, `junit/independent-unit.xml`) |
| ESLint / Prettier | PASS / PASS (`logs/eslint.log`, `logs/prettier.log`) |
| Scope gate | PASS — 16 files, 0 errors (`logs/check_scope.log`) |
| Production code modified | **false** (0 files under `services/`, `apps/`, `contracts/`, `pnpm-lock.yaml`) |
| CROSS_TENANT_LEAKAGE | **0** |
| Recommended result | **`SF_M09_INT_FAIL`** |

## Suites

| Suite | INT | Result | Seam exercised |
|---|---|---|---|
| `int-011-host.test.ts` | INT-011 | 10/12 | `buildApp` + `composition/m09`; mounts CMP-056..061 in order; CMP-036 once; forged `X-Tenant-ID`/`Forwarded: tenant=` → SF-TEN-002 on 15 routes; body `tenant_id` never adopted; M06+M08+M09 coexistence |
| `int-014-scheduler.test.ts` | INT-014 | 10/10 | Real CMP-056 service + tenant-partitioned memory repo: atomic capacity, notify-failure ≠ cancel (notify outside tx), idempotency replay/conflict, PDP deny/unavailable, cross-tenant read 404, FROZEN `SF-CON-APPOINTMENT` projection |
| `int-015-assisted.test.ts` | INT-015 | 10/10 | Real CMP-057 service + memory repo: `applied_by ≠ applied_for`, applicant-in-tenant check (outside tx), verification unavailable → SF-INT-001, visibility, cross-tenant 404, FROZEN `SF-CON-ASSISTED-SESSION` projection |
| `int-016-019-host-seams.test.ts` | INT-016..019 | 13/18 | CMP-058/059/060 through recording pg pool + PDP doubles (tenant, DB session context, transaction boundary); CMP-061 handler guards with service doubles |
| `int-013-modes.test.ts` | INT-013 | 6/8 | Unbound ports fail closed (056/057/061 repos, 058/059 authorizers); CMP-060 SIMULATED ports vs PRODUCTION |

## Findings (recorded against owners; not patched by this stitcher)

Blocking findings are hard gates (`MODEL-ROUTING-QUALITY.md`): contract, tenant/security and the
"no network inside an authoritative transaction" rule. A suite or quality score cannot override them.

| ID | Owner | Severity | Finding | Failing test |
|---|---|---|---|---|
| F-01 | CMP-060 | BLOCKING (contract) | Refusals use `{error:{code,message,details}}`, not FROZEN `SF-CON-ERROR-RESPONSE` (`error_code`/`message`/`correlation_id`). `services/cmp-060-risk-integrity/src/routes/risk-routes.ts` `sendError`. | int-011 `[F-01 CMP-060]` |
| F-02 | CMP-060 | BLOCKING (contract/tenant) | Tx sets `app.current_tenant_id` / `app.current_cell_id` (`src/db/tx.ts`). FROZEN `SF-CON-DB-SESSION-CONTEXT` requires `app.tenant_id`… and CMP-060's own RLS reads `sf_platform.current_tenant_id()` = `current_setting('app.tenant_id')`. Under real RLS every CMP-060 read/insert sees tenant NULL. That fails closed (no leakage) but makes the component non-functional. Static analysis plus recorded `set_config` keys; not executed against PostgreSQL here. | int-016-019 `[F-02 CMP-060]` |
| F-03 | CMP-059 | BLOCKING (contract) | Tx sets `sf.tenant_id` / `sf.actor_id` (`src/db/tx.ts`), and the RLS policies in `db/migrations/1761100000000_cmp-059-migration-workbench.sql` use `current_setting('sf.tenant_id', true)::uuid` directly. Both breach FROZEN `SF-CON-DB-SESSION-CONTEXT`: wrong keys, and RLS must read only through `sf_platform.current_tenant_id()` (the CR-01 pooled-session cast hazard). | int-016-019 `[F-03 CMP-059]` |
| F-04 | CMP-060 | BLOCKING (security) | `registerRiskRoutes` defaults `authz` to `SimulatedAllowAllTenantAuthz` (documented "unit tests only"). If the host mount omits `authz`, an assessment is created with no authorization decision (201). `M09PluginMounts.risk.options` is an untyped record, so the host cannot enforce the port. | int-016-019 `[F-04 CMP-060]` |
| F-05 | CMP-060 | BLOCKING (INT-013) | No environment gate exists. A PRODUCTION host admits and uses `SimulatedReviewRoutingPort` (mode `SIMULATED`, "must not be used in production") and `SimulatedAllowAllTenantAuthz`. This breaches "No SIMULATED critical connector in production". | int-013 `[F-05 CMP-060]` ×2 |
| F-06 | CMP-060 | BLOCKING (constitution) | `createAssessment` calls the external `reviewRouting.routeToReview` inside `withContextTx`, between BEGIN and COMMIT, with 1 open transaction observed. This breaches "No network calls inside authoritative DB transactions". | int-016-019 `[F-06 CMP-060]` |
| F-07 | CMP-060 | BLOCKING (contract) | The 201 body declares `contract_id: SF-CON-RISK-ASSESSMENT`, `contract_status: FROZEN`, but carries `risk_tier`, `raw_risk_score`, `signal_count` and `review_requested`. The FROZEN schema has `additionalProperties: false`. | int-016-019 `[F-07 CMP-060]` |
| F-08 | CMP-058 | NON-BLOCKING (LOW) | `POST /v1/elements` runs Fastify body-schema validation before the `preHandler` context check, so an unauthenticated caller gets 400 SF-SYS-003 instead of 401. No port or DB is reached. | int-011 `[F-08 CMP-058]` |

### Observations (non-blocking; owner/security review recommended, not asserted)

- O-01 CMP-059: `dry-run` accepts caller-supplied `simulated_processed`/`simulated_failed`/`simulated_exceptions`, and `execute` accepts `processed_records`/`failed_records`, in every environment. Reconciliation status is derived from those caller numbers (`src/service/migrations.ts`). This needs review against the "dry-run evidence before execute" invariant.
- O-02 CMP-060: a PDP deny maps to `SF-TEN-002 AUTHZ_DENIED`, and a missing context maps to `SF-TEN-001 "Authentication required"`. The rest of M09 uses `SF-AUTH-002` / `SF-AUTH-001` for these cases.
- O-03 SF-M09-HOST: the CMP-060 adapter calls `resolveContext({ headers } as FastifyRequest)`. A host resolver that depends on request state other than headers sees nothing, which fails closed (no leak).

## Passing seams of note

- Forged tenant headers are denied at CMP-036 on all 15 probed M09 routes, with no canary echo and no port, PDP or DB statement reached. `CROSS_TENANT_LEAKAGE=0`.
- Server-side context drives the tenant end to end: PDP subject/resource, DB `set_config`, outbox envelopes and notifier/verification calls all carry T1 only. A T1 record is invisible from T2 (CMP-056, CMP-057).
- CMP-056 booking invariants (atomic capacity; a notify failure does not cancel; notify outside the tx) and the CMP-057 `applied_by ≠ applied_for` invariant both hold through the host.
- CMP-058 and CMP-059 fail closed with no authorizer. CMP-056, CMP-057 and CMP-061 refuse construction without a repository. CMP-060 refuses statutory-outcome signal codes.

## Not exercised

PostgreSQL RLS and privilege roles (F-02/F-03 rely on static evidence plus recorded settings), Temporal, real CMP-025 notification, real CMP-004/005/030 verification, CMP-061 owner-task fulfilment beyond the handler guards, the CMP-058 publish/deprecate lifecycle and the CMP-059 project lifecycle against a database.

## Process note

A concurrent writer committed `b3ac2c2` and `68e694c` to this branch from this worktree while
the suites were running. Those commits rewrote the failing conformance assertions into tests that
assert the defects (and so pass), and recorded `SF_M09_INT_PASS_WITH_FINDINGS`. This evidence
restores the conformance assertions, keeping each one tagged with its finding ID, and records
FAIL. Under the hard-gate rule, blocking findings cannot be passed with a qualifier.

## Certification stance

CERTIFIED=false · G3=false · G4=false · G6=false · self_certified=false ·
recommended_result **`SF_M09_INT_FAIL`** (7 blocking findings: F-01..F-07; 1 non-blocking: F-08).
