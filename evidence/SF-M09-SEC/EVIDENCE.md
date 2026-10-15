# SF-M09-SEC evidence — independent security verifier

**Not CERTIFIED. Not G3. Not G4. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M09-SEC (CG-03) |
| Authorization | HUMAN_CG03_THROUGH_EVD_AUTHORIZATION |
| Branch | `cursor/m09-sec-91f2` |
| Execution base | `f56356e65f4c741da4ab95e177822d6332e4f911` (SF-M09-HOST tip, includes `apps/api/src/composition/m09.ts`) |
| Model | route `opus` / release `claude-opus-5-5` |
| Runner | vitest 5.0.3, node v22.14.0, PostgreSQL 16.15 (local, throwaway database per run) |
| Command | `DATABASE_URL=<local admin> npx vitest run -c tests/security/m09/vitest.config.ts` |
| Result (with DB) | **31 passed / 12 failed (43)** — `logs/vitest.log`, `junit/security.xml` |
| Result (no DB, CI shape) | 32 passed / 4 failed / 7 skipped (43) — `logs/vitest-no-db.log`, `junit/security-no-db.xml` |
| CROSS_TENANT_LEAKAGE | HTTP **0** (282 forged requests) · PostgreSQL **1** (live canary row, CMP-059 outbox) |
| Critical findings | **2** |
| Production code modified | **false** |
| Statute / periods invented | **false** |
| Recommended result | **SF_M09_SEC_FAIL** |

Every failing test encodes a required security/contract invariant; none were weakened to pass.

## Suites

| File | Tests | Result | What it proves |
|---|---|---|---|
| `forged-tenant-http.test.ts` | 4 | PASS | All 47 published M09 host routes (CMP-056/057/061 from each `ROUTE_DESCRIPTORS`; CMP-058 12, CMP-059 6, CMP-060 3 Fastify routes, counts cross-checked against the route sources) are registered and live, and each returns 403 `SF-TEN-002` (valid `error-response`) for 6 forged header variants (incl. caller's own tenant, `x-sf-*`, `Forwarded: tenant=`). Recording doubles: zero calls to `resolveContext` or any port/pool. Canary absent from bodies and logs. Body `tenant_id` never echoed. CMP-036 answers before M09 mounts. |
| `static-isolation.test.ts` | 21 | 17 / 4 fail | Per M09 schema: own `CREATE SCHEMA`, every table declared; tenant classes have `tenant_id NOT NULL` + ENABLE/FORCE RLS + policy; non-tenant classes carry no `tenant_id`; policies read the tenant only through `sf_platform.current_tenant_id()`; `sf_cmpNNN_rw` NOLOGIN/NOSUPERUSER/NOBYPASSRLS; no BYPASSRLS/DISABLE/NO FORCE/`TO PUBLIC`; no cross-schema SQL or sibling imports; runtime `set_config` keys limited to `dbSessionSettings` keys; `m09.ts` has no CMP-036 remount, SQL, or period values. |
| `db-rls-live.test.ts` | 7 | 2 / 5 fail | Baseline + shared contracts + all 10 M09 migrations applied with `node-pg-migrate` into a throwaway DB. Catalog: every `tenant_id` table `sf_app` can SELECT must be FORCE RLS. Drives CMP-059/CMP-060 **own** tx helpers through login roles inheriting only `sf_app` (+ the component's `_rw` role). Control (FORCE-RLS `sf_migration.idempotency_record`) isolates correctly. |
| `simulation-fail-closed.test.ts` | 4 | 1 / 3 fail | SIMULATED inventory (only CMP-060 ships SIMULATED ports); CMP-060 host mount without authz must deny; SIMULATED env guard; review-routing port must run outside the DB transaction. |
| `policy-input.test.ts` | 7 | PASS | CMP-061: denial/exception require opaque owner-supplied refs (`POLICY_INPUT_REQUIRED`), requester cannot supply basis/deadline/tenant or flip `invented_statutory_policy_forbidden`; migration has no deadline/interval column. CMP-060: signals encoding outcomes (APPROVE/REJECT/ELIGIBLE/PENALTY/…) rejected `SF-AI-001`; HIGH/CRITICAL route to human review; no authoritative-decision claim. Fixtures use opaque refs only — no statute asserted. |

## Findings

| ID | Sev | Component / owner task | Finding | Evidence |
|---|---|---|---|---|
| F-01 | **CRITICAL** | CMP-059 / SF-M09-004 | `sf_migration.outbox_event` carries `tenant_id NOT NULL` + tenant event payload but is declared `PLATFORM_OPERATIONAL`, has **no RLS**, and is `GRANT SELECT … TO sf_app`. Any runtime principal holding `sf_app` (any component, any tenant) can read every tenant's migration events. `scripts/gates/migration_lint.py` does not catch a tenant-carrying PLATFORM_OPERATIONAL table. | Live: event written by CMP-059's own `withContextTx`/`insertOutbox` for T1 read back by an `sf_app`-only login with T2 set in every tenant GUC (1 canary row). Catalog: `['sf_migration.outbox_event']` is the only unprotected tenant table. Static: `sf_migration.outbox_event is PLATFORM_OPERATIONAL but carries tenant_id`. |
| F-02 | **CRITICAL** | CMP-060 / SF-M09-005 (+ SF-M09-HOST wiring) | `registerRiskRoutes` defaults `authz` to `SimulatedAllowAllTenantAuthz` when no port is supplied; `m09.ts` passes options through unchanged (the SF-M09-HOST composition test itself mounts CMP-060 without `authz`). Authorization fails **open**. | Host `buildApp` with `m09.risk = { options: { pool } }`: `POST /v1/risk/assessments` returned success and reached the pool (BEGIN/INSERT) with no authorization decision. |
| F-03 | HIGH | CMP-059 / SF-M09-004 | SF-CON-DB-SESSION-CONTEXT deviation: tx sets private `sf.tenant_id` / `sf.actor_id`; all 7 policies read raw `current_setting('sf.tenant_id', true)::uuid` (evades lint, which only matches `app.tenant_id`). Reproduces CONTRACT-REVIEW-001 CR-01: on a reused pooled session the policy raises `invalid input syntax for type uuid: ""` instead of failing closed with zero rows. `sf_platform.current_tenant_id()` is NULL inside CMP-059 transactions. | Live tests (2) + static tests (2). Fails closed by error, not a leak. |
| F-04 | HIGH | CMP-060 / SF-M09-005 | SF-CON-DB-SESSION-CONTEXT deviation: tx sets `app.current_tenant_id` / `app.current_cell_id`, but CMP-060 policies use `sf_platform.current_tenant_id()` (reads `app.tenant_id`) → NULL inside every CMP-060 transaction, so all RLS reads/writes are denied. Fail-closed (no leak) but CMP-060 cannot operate on a real database; its suite uses doubles. | Live: `current_tenant_id()` NULL inside CMP-060 `withContextTx`. Static: non-contract keys. |
| F-05 | HIGH | CMP-060 / SF-M09-005 | Review-routing port (INT-018 external notification) is invoked **inside** the authoritative DB transaction (`BEGIN … INSERT/UPDATE > routeToReview > INSERT outbox > COMMIT`). Violates "no network calls inside authoritative DB transactions". | Recording pool event order in `simulation-fail-closed.test.ts`. |
| F-06 | MEDIUM | CMP-060 / SF-M09-005 | `SimulatedReviewRoutingPort` / `SimulatedAllowAllTenantAuthz` exported with no environment guard (contrast CMP-035 `assertPortAllowed`). "Must not be used in production" is a comment only. | Static. |

### Observations (non-blocking, owner/ADR routing — verifier proposes no values)

- O-1 CMP-060 `DEFAULT_THRESHOLDS` (tier cut-offs) are fixed in code (`domain/risk-classifier.ts`). Advisory only and not statutory, but policy values belong in versioned GoRules/metadata; owner/ADR decision.
- O-2 CMP-060 error body is `{ error: { code, … } }`, not SF-CON-ERROR-RESPONSE (`error_code`). Not reachable on forged headers (CMP-036 answers first).
- O-3 Live DB probes skip without `DATABASE_URL`; CI without a database still fails on F-01 (static), F-02, F-05, F-06 and the static halves of F-03/F-04.
- O-4 CMP-058 `semantic_element` is GLOBAL with no `tenant_id` and an immutability trigger — consistent with declaration.

## Not covered

- OPA policy content and jurisdiction/delegation decisions inside CMP-056/057/061 services (doubles at the HTTP layer).
- Live RLS for CMP-056/057/058/061 data paths beyond the catalog FORCE-RLS check.
- Production connectors (none REAL in M09).

## Certification stance

CERTIFIED=false · G3=false · G4=false · G6=false · self_certified=false.
Recommended **SF_M09_SEC_FAIL** for human/CI gate: two CRITICAL hard-gate findings (F-01 cross-tenant read, F-02 fail-open authorization). Hard tenant/security gates are 100% blocking; no score overrides them. Re-run this suite after owner remediation.
