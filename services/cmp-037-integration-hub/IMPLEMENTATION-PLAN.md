# SF-M01-005 IMPLEMENTATION PLAN — CMP-037 Integration Hub

| Field | Value |
|---|---|
| Task | SF-M01-005 |
| Component | CMP-037 Integration Hub |
| Integration | INT-013 |
| Phase | **PLAN ONLY** — no implementation in this commit |
| Branch | `agent/M01-cmp-037-integration-hub-SF-M01-005` |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` |
| Builder | serviceform-integration-builder |
| Resolved model | claude-sonnet-5-5, effort high (envelope `model_route: sonnet`) |
| Gate | Design. Recommended after orchestrator plan approval: Develop. Not VERIFIED/CERTIFIED. |
| Privilege role | `sf_cmp037_rw` (ADR-0006 Option A; supersedes PLAN-REVIEW `sf_integration_hub_rw`) |

**Stop for orchestrator approval.** Wave 2, merge, and self-certification are out of scope.

Binding documents (read, not edited): envelope `orchestrator/tasks/SF-M01-005.yaml`; PLAN-REVIEW-M01-W1; SECURITY-PRECHECK P-005-1..5; dispatch plan + negative tests; ADR-0006 ACCEPTED; frozen SF-CON-CONNECTOR-BINDING, SF-CON-SIMULATION-MARKER, SF-CON-OUTBOX, SF-CON-EVENT-ENVELOPE, SF-CON-DB-SESSION-CONTEXT, SF-CON-ERROR-CATALOGUE, SF-CON-IDEMPOTENCY, SF-CON-AUTHZ-DECISION, SF-CON-AUDIT-EVENT, SF-CON-ISOLATION-DECLARATION, SF-CON-REQUEST-CONTEXT; M00 baseline + shared-db-contracts; `simulators/README.md`; Constitution #11, #12, #21, #22, #23, #24.

---

## 1. Impact plan (AGENTS.md loop step 2)

### Domain

CMP-037 owns connector **definition** catalogue, tenant/service **binding** registry, **invocation lifecycle** (`ConnectorTransaction`), webhook intake, retry/circuit-breaker, and REAL | SANDBOX | SIMULATED mode resolution. It does **not** own payment/OTP/eSign/DigiLocker business state machines. It returns normalised results and emits domain events. Consumers in later modules own those machines.

No provider-specific adapter in this task (envelope stop condition). W1 ships one **reference echo simulator** (`DEPARTMENT_API`, SIMULATED only) under `simulators/framework/`.

### Data

Schema `sf_integration_hub` (PLAN-REVIEW X-2). Authoritative tables listed in §3. No cross-component SQL (Constitution #23, ADR-0006 condition 7). Tenant context from `RequestContext` / `sf_platform.current_tenant_id()` only (never body or client header).

### APIs (Eng v1.4 CMP-037; PLAN-REVIEW X-10)

Export Fastify plugin `registerIntegrationHub(app, deps)` with a `prefix` option. **Not** registered in `apps/api` (read-only; CMP-036/W2 wires it). Default paths under `/v1`:

| Method | Path | Kind | Auth |
|---|---|---|---|
| POST | `/v1/connectors/{id}/invoke` | Command | RequestContext + AuthorizationPort (default deny) |
| GET | `/v1/connectors/{id}/health` | Query | RequestContext + AuthorizationPort |
| POST | `/v1/webhooks/{connectorId}` | Command | Unauthenticated; tenant from `webhook_route` then RLS |

`{id}` / `{connectorId}` = `connector_binding_id`. Component OpenAPI: `services/cmp-037-integration-hub/contracts/openapi.yaml`. Errors from frozen catalogue only: SF-INT-001, SF-TEN-001/002, SF-AUTH-001/002, SF-APP-002, SF-SYS-002/003/004, SF-RATE-001. Structured `details[].code` for internal reasons (X-8): `CIRCUIT_OPEN`, `BINDING_INVALID`, `CONNECTOR_MODE_FORBIDDEN`, `OUTBOUND_IN_TX`, `PII_FIELD_REJECTED` not used here.

### Events (X-3, X-6)

Topic `sf.integration-hub.events.v1` listed in `services/cmp-037-integration-hub/contracts/topics.json`. Envelope v1, `schema_version` 1, `aggregate_type` `ConnectorTransaction`, `aggregate_id` = `connector_transaction_id`, `partition_key` = that id.

| Event type | When |
|---|---|
| ConnectorInvocationStarted | Invoke TX1 only (not webhooks; PLAN-REVIEW Q12) |
| ConnectorInvocationSucceeded | Invoke TX2 success; webhook first-seen success |
| ConnectorInvocationFailed | Invoke TX2 failure / circuit-open; webhook first-seen failure |

Audit hand-off (X-4): `AuditRecorder` port writes `AuditEventSubmitted` (`data` = one SF-CON-AUDIT-EVENT) to **this** outbox, topic `sf.audit.ingest.v1`, in the same TX as the audited change. No import of CMP-031/038 code.

Payloads: ids, connector_type, mode, attempt count, outcome/`error_code`, provider_reference, simulation marker when simulated. No secret_ref, no secret values, no PII, no provider bodies.

Producer INSERT-only into outbox (frozen template). Local helper `// replaced by packages/outbox at stitching`.

### Tenancy / authz

- Tenant from server-derived RequestContext. Forged `x-tenant-id` / body `tenant_id` → 403/400 (005-06).
- AuthorizationPort is a caller-supplied narrow port (OPA/CMP-032 not importable). Default deny → SF-AUTH-002, no provider call.
- Webhook: no user context. Tenant from `webhook_route` (no SECURITY DEFINER — PLAN-REVIEW Q1). Signature verified **after** tenant+binding load and **before** any processing write (SECURITY-PRECHECK: verify after resolve; 005-12: verify before persist). Order: resolve route → set session tenant → load binding under RLS → production/mode guard → no-txn → resolve secret → verifyWebhook → persist.

### Observability

`@serviceform/observability` logger (redaction). Spans per attempt. Injected `MetricsPort`. Canary secret never in logs/events/responses.

### Rollback

See §11. Code rollback = revert branch. Nothing else references CMP-037 yet.

---

## 2. ADR-0006 privilege model (MUST)

Canonical names (ADR-0006 Option A). PLAN-REVIEW X-1 `sf_integration_hub_rw` is **superseded**.

| Identity | Kind | Attributes | Membership |
|---|---|---|---|
| `sf_cmp037_rw` | NOLOGIN group | NOSUPERUSER NOCREATEDB NOCREATEROLE **NOBYPASSRLS** | none |
| CMP-037 runtime LOGIN (deploy: secrets provider; tests: `sf_t005_rt`) | LOGIN | NOSUPERUSER NOBYPASSRLS INHERIT | **only** `sf_app` + `sf_cmp037_rw` |
| `sf_migrator` (or equivalent; CREATE IF NOT EXISTS) | NOLOGIN | NOSUPERUSER NOBYPASSRLS | schema/table **owner**; never used as app runtime |
| `sf_app` | existing NOLOGIN | NOBYPASSRLS | RLS policy target `TO sf_app` only |
| `sf_outbox_publisher` | existing NOLOGIN | frozen template grants | not granted `sf_cmp037_rw` |

### Conditions mapped to this component

1. **No generic DML on `sf_app`** for CMP-037 authoritative tables (`connector_definition`, `connector_binding`, `connector_transaction`, `webhook_route`). INSERT/UPDATE/DELETE + sequence use → `sf_cmp037_rw` only. **Residual (frozen, not changed):** outbox/inbox grants stay exactly as `outbox.template.sql` (`GRANT INSERT … TO sf_app`, inbox SELECT/INSERT to `sf_app`). Recorded in EVIDENCE.md; tightening needs a CCR (condition 9).
2. `sf_cmp037_rw` is NOLOGIN.
3. Runtime LOGIN inherits only `sf_app` and `sf_cmp037_rw`. Tests assert `pg_auth_members` has no `sf_cmp002_rw` / `sf_cmp031_rw` / `sf_cmp038_rw` / `sf_cmp048_rw`. `SET ROLE` to those roles fails.
4. Runtime: `rolsuper = false`, `rolbypassrls = false`.
5. Runtime is **not** table/schema owner. Owner = `sf_migrator` (created IF NOT EXISTS in this migration with identical attributes if missing; not dropped on down if other components may share it).
6. TENANT_SCOPED tables: ENABLE + **FORCE** RLS. Policies `USING/WITH CHECK (tenant_id = sf_platform.current_tenant_id())` **TO sf_app**. Policies read tenant **only** via `sf_platform.current_tenant_id()` (never raw `current_setting('app.tenant_id')`).
7. Cross-component SQL **DENY**: no SELECT/INSERT/UPDATE/DELETE on CMP-037 authoritative tables to other `_rw` roles or to `sf_app` (except frozen outbox/inbox). No views that leak. Zero `prosecdef` functions in `sf_integration_hub`.
8. `REVOKE ALL ON SCHEMA/TABLES/SEQUENCES FROM PUBLIC`. `ALTER DEFAULT PRIVILEGES IN SCHEMA sf_integration_hub REVOKE ALL ON TABLES, SEQUENCES FROM PUBLIC` (and from `sf_app` for DML). `sf_app` gets no TRUNCATE/TRIGGER/REFERENCES/CREATE.
9. Outbox/inbox copied **byte-for-byte** from the frozen template with only `{schema}` → `sf_integration_hub` and `{cmp}` → `CMP-037`. Diff test against rendered template.
10. Privilege-boundary suite §8.B; evidence `evidence/SF-M01-005/privilege-boundary.log`. Hard gate `component_privilege_boundary`.

P-005-1 **adapted to ADR-0006**: `webhook_route` INSERT/SELECT granted to **`sf_cmp037_rw`**, not `sf_app`. RLS INSERT `WITH CHECK (tenant_id = sf_platform.current_tenant_id())` TO sf_app; SELECT policy `USING (true)` TO sf_app (runtime is in `sf_app`, so the policy applies; other components lack table GRANT). Composite FK `(tenant_id, binding_id)` → `connector_binding`. No UPDATE/DELETE grant. Test 005-04 still holds (rt under T1 cannot insert T2 routes).

---

## 3. Schema / table list with isolation classes

Migrations in band **17595005xxxxx** (PLAN-REVIEW X-1), names `*_cmp-037-*.sql`, timestamp > 1759490000000:

1. `1759500500000_cmp-037-integration-hub-schema.sql` — schema, `sf_cmp037_rw`, `sf_migrator` IF NOT EXISTS, domain tables, RLS, grants, REVOKE PUBLIC.
2. `1759500510000_cmp-037-integration-hub-outbox.sql` — frozen outbox/inbox copy.
3. `1759500520000_cmp-037-integration-hub-webhook-route.sql` — `webhook_route` + FK + policies + `_rw` grants.

Each `CREATE TABLE` preceded by `-- sf:isolation <schema.table> <CLASS> owner=CMP-037`.

| Table | Isolation | RLS | Grants (authoritative) |
|---|---|---|---|
| `connector_definition` | GLOBAL | none | SELECT/INSERT/UPDATE to `sf_cmp037_rw`; no DELETE; seed via repository (no public admin HTTP — Q3) |
| `connector_binding` | TENANT_SCOPED | ENABLE+FORCE; tenant policy TO sf_app | SELECT/INSERT/UPDATE to `sf_cmp037_rw`; no DELETE |
| `connector_transaction` | TENANT_SCOPED | ENABLE+FORCE | SELECT/INSERT/UPDATE to `sf_cmp037_rw`; no DELETE |
| `webhook_route` | PLATFORM_OPERATIONAL | ENABLE+FORCE; INSERT WITH CHECK tenant; SELECT USING true | SELECT+INSERT to `sf_cmp037_rw`; **no** UPDATE/DELETE |
| `outbox_event` | TENANT_SCOPED | template | **unchanged template** (sf_app INSERT; publisher SELECT/UPDATE/DELETE) |
| `outbox_event_platform` | PLATFORM_OPERATIONAL | template | unchanged template |
| `inbox_event` | TENANT_SCOPED | template | unchanged template |
| `inbox_event_platform` | PLATFORM_OPERATIONAL | template | unchanged template |

**Not in W1:** `connector_binding_platform` / null-tenant bindings (PLAN-REVIEW Q4). Binding `tenant_id uuid NOT NULL` (lint + W1 scope). Contract still allows `tenant_id: null`; W1 refuses those rows at the repository (BINDING_INVALID). CCR follow-up if platform-wide bindings are needed.

### `connector_definition` (GLOBAL)

`connector_definition_id` uuid PK; `connector_type` CHECK ∈ contract enum; `adapter_key` text UNIQUE; `display_name`; `supported_modes` text[] CHECK subset of REAL/SANDBOX/SIMULATED; `retry_policy` jsonb; `timeout_ms` int; `webhook_signature_scheme` text; `status` ACTIVE\|DISABLED; `version` int; timestamps. **No secrets column.** Egress **host allowlist** lives here (or jsonb `egress_allowlist`), never from request input (P-005-3).

### `connector_binding` (TENANT_SCOPED)

Mirrors SF-CON-CONNECTOR-BINDING plus DB-only `enabled bool` (not in frozen schema; not exposed as a contract field). CHECKs:

- PRODUCTION + critical → mode REAL (contract).
- **W1 extra (Q2, stricter than contract, allowed):** PRODUCTION → mode REAL for **every** binding (critical or not). SANDBOX/SIMULATED in PRODUCTION refused at DB + startup + per-call. Gap recorded for CCR (O-4 / CR-06 follow-up).
- LOCAL/CI → SIMULATED.
- SIMULATED → `simulator_version` NOT NULL and environment ∈ LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE.
- REAL/SANDBOX → `secret_ref` NOT NULL matching `^(aws-sm|aws-ssm|vault)://[A-Za-z0-9/_.+=@-]+$`.
- REAL PRODUCTION `secret_ref` must **not** start with `vault://sim/` (005-26).
- Unique `(tenant_id, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'), connector_type, environment)` where enabled.

`secret_ref` is a handle only. No column named `/secret|password|token|key_material|private/` except `secret_ref`.

### `connector_transaction` (TENANT_SCOPED)

PK; `tenant_id` NOT NULL; composite FK `(tenant_id, connector_binding_id)` → binding; `direction` INVOKE\|WEBHOOK; `operation`; `idempotency_key`; `request_fingerprint`; `provider_reference`; `status` PENDING\|IN_PROGRESS\|SUCCEEDED\|FAILED\|CIRCUIT_OPEN; `attempts`; `error_code`; `response_ref` (redacted pointer, no body); `mode`; `environment`; `simulation` jsonb CHECK (mode=SIMULATED ⇒ marker present); `correlation_id`; `aggregate_version`; timestamps.

Uniques: `(tenant_id, connector_binding_id, direction, idempotency_key)` WHERE key NOT NULL; `(tenant_id, connector_binding_id, provider_reference)` WHERE direction=WEBHOOK.

### `webhook_route` (PLATFORM_OPERATIONAL)

`binding_id` uuid PK; `tenant_id` uuid NOT NULL; written in the **same TX** as the binding insert. Exposes only binding_id + tenant_id.

---

## 4. packages/connector-sdk (pure library)

Workspace package `@serviceform/connector-sdk` (auto-included via `packages/*`). **No DB, no Fastify.** Depends only on `@serviceform/contracts` workspace:\*. Node built-ins: `node:crypto`, `node:timers/promises`, `node:net` **only inside `guardedFetch`**.

| Module | Responsibility |
|---|---|
| `spi.ts` | `ConnectorAdapter`: `invoke`, `verifyWebhook`, `health`. Discriminated results; adapters do not throw for provider outcomes. |
| `secrets.ts` | `SecretResolver` port; `SecretMaterial` redacts `toString`/`toJSON`/`inspect`; `.reveal()` only. CMP-048 not imported. |
| `modes.ts` | `resolveMode(binding, {deploymentEnvironment})` after `validate('connector-binding', b)`. Binding.environment must equal deployed env. **No fallback** to another binding or SIMULATED. Production: **all** bindings REAL (Q2). `assertProductionSafe` at startup (all enabled bindings) and per call. |
| `retry.ts` | Timeouts, exponential backoff + full jitter. Defaults (X-13, non-spec): timeout 10 s, 3 retries, breaker 5 failures / 30 s. Configurable. |
| `circuit-breaker.ts` | Per binding id, in-process CLOSED/OPEN/HALF_OPEN. Shared Redis/DB breaker = new infra = stop; **not built** (Q10 accepted). |
| `no-txn-guard.ts` | `AsyncLocalStorage` depth; `assertNoOpenTransaction` before each attempt. |
| `guarded-fetch.ts` | **Only** egress helper. Blocks link-local, loopback, RFC1918, fd00::/8, `file:`/`gopher:`, private DNS at connect, redirects to those. Allowlist from definition/config. Adapters/simulators must not import `node:http(s)`, `node:net`, `undici`, or global `fetch` (005-29). |
| `webhook.ts` | Constant-time HMAC-SHA256, timestamp replay window (default 300 s, X-13), raw body. |
| `events.ts` | Envelope builders; `validate('event-envelope')`. Event `data` schemas owned by the service, not `contracts/**`. |

`InMemorySecretResolver` in `packages/connector-sdk/test/support` only.

Environment source: `SF_ENVIRONMENT`. Unset, empty, wrong case, unknown → **refuse to start** (005-18).

---

## 5. Invocation saga, webhook, no-txn, simulation fail-closed

### Invoke (`ConnectorInvoker`)

1. Context + authz (deny default) → **TX1**: set `dbSessionSettings`, load binding (wrong tenant = nothing → same 404/403 body as unknown id), mode/production guard, INSERT transaction (ON CONFLICT idempotency: replay; different fingerprint → SF-APP-002), outbox Started, COMMIT.
2. **No TX open:** secret by handle, `executeWithResilience` + breaker via `guardedFetch`.
3. **TX2:** optimistic UPDATE `WHERE status IN (PENDING, IN_PROGRESS)` + Succeeded/Failed outbox. Crash after provider success: row stays IN_PROGRESS; same Idempotency-Key returns in-progress (409/202) and **does not** call the provider (P-005-4 / 005-33). No stale-reconcile worker (Q5 deferred).

### Webhook

Raw body (size limit → 413 **before** secret resolution) → SELECT `webhook_route` by binding_id (no tenant yet) → unknown / other-tenant / disabled: **identical** status/body (no existence oracle) → set tenant → RLS load binding → guards → verify signature (fail 401, nothing persisted) → provider_reference → TX INSERT ON CONFLICT DO NOTHING; only on insert: outbox event + inbox `(consumer_group, event_id)` with deterministic uuid. Duplicate: 200 original, no second event. Same reference + different payload: original + warning log + anomaly metric, **no payload body** (Q11 / 005-14; known M05 limitation). N sequential + N parallel identical callbacks → 1 transaction + 1 outbox event.

### Production SIMULATED fail-closed (hard gate `production_simulated_critical_connector`)

- Startup: any **enabled** PRODUCTION binding with mode ≠ REAL (or SIMULATED critical) → throw, readiness false, process must not serve traffic.
- Per call: same, no network.
- Disabled bindings do not block startup; a post-startup flip is caught by CHECK and/or per-call guard (005-20).
- Simulated results **must** carry SF-CON-SIMULATION-MARKER + label `TEST/SIMULATED` + `test_run_id`. Missing/mismatched marker fails the transaction. REAL result with a marker is rejected.

### Simulator (`simulators/framework/`)

Not a pnpm workspace member (`pnpm-workspace.yaml` read-only). Compiled via service tsconfig `include`. Echo adapter: type `DEPARTMENT_API`, SIMULATED only, `simulator_version` e.g. `echo-1.0.0`. Scenarios: `success`, `fail_permanent`, `fail_transient_then_success`, `timeout`, `malformed_response`, `duplicate_callback`, `slow`. Deterministic (no `Math.random`/`Date.now`). Coverage of `simulators/framework` **not** in root vitest include (Q14 / W2 gap CMP-055). **Do not** write `simulators/README.md`.

---

## 6. Files to create (allowed_write_paths only)

**Not committed:** `pnpm-lock.yaml` (restore if `pnpm install` dirties it). Envelope + LOCKFILE-POLICY + `check_scope.py`.

### `packages/connector-sdk/`

`package.json`, `tsconfig.json`; `src/{index,spi,secrets,modes,retry,circuit-breaker,no-txn-guard,webhook,events,errors,guarded-fetch}.ts`; `test/*.test.ts`; `test/support/{in-memory-secrets,fake-clock}.ts`.

### `services/cmp-037-integration-hub/`

`package.json`, `tsconfig.json`, `vitest.integration.config.ts`, this `IMPLEMENTATION-PLAN.md`; `contracts/{openapi.yaml,topics.json,events/*.schema.json}`; `src/` plugin, config, domain (invoker, webhook-intake, binding-resolver, events, audit-recorder), db (unit-of-work, repositories, outbox-writer), http routes, ports (authorization, metrics, secrets); `test/*.test.ts`, `test/*.int.test.ts`, `test/support/{db,doubles}.ts`.

### `db/migrations/`

The three `*_cmp-037-*.sql` files above. **No** `services/.../migrations/`.

### `simulators/framework/`

`tsconfig.json`, `src/{index,echo-adapter,echo-webhook,marker,scenarios}.ts`. No README.

### After implementation (not this commit)

`evidence/SF-M01-005/**`, `orchestrator/handovers/SF-M01-005.yaml` (scope-allowed for every task). TRACEABILITY.md is read-only — report in handover.

---

## 7. Third-party dependencies

**None new.** Pin exact versions already in the repo:

| Package | Deps |
|---|---|
| `@serviceform/connector-sdk` | `@serviceform/contracts` workspace:\* |
| `@serviceform/cmp-037-integration-hub` (name TBD to match siblings) | `fastify` 5.12.5, `fastify-plugin` 5.1.0, `pg` 8.23.1, `@types/pg` 8.23.1 (dev), workspace contracts, observability, connector-sdk; `ajv` 8.20.0 if validating event data; `tsx` 4.23.15 (dev) if needed |

Retry, breaker, HMAC, uuid v5: hand-written on `node:crypto` (no cockatiel/opossum/uuid). Root lockfile regenerated later by orchestrator/integration.

`packages/connector-sdk` joins the workspace via existing `packages/*` glob. Service joins via `services/*`. No `pnpm-workspace.yaml` edit.

---

## 8. Tests (test-before-code)

Mandatory: dispatch plan §6 **plus** `SF-M01-005-negative-tests.md` cases **005-01..005-33** **plus** ADR-0006 suite below. Harness **H1** (not M00 `SET LOCAL ROLE sf_app` from superuser): per-run LOGIN `sf_t005_rt IN ROLE sf_app, sf_cmp037_rw`, NOSUPERUSER NOBYPASSRLS; `beforeAll` asserts `rolsuper`/`rolbypassrls` false, `session_user = current_user`, not a member of schema owner, not table owner.

### A. Negative / isolation (verifier-authored)

Reproduce 005-01..005-33 as specified (RLS, webhook_route, leak, invoke oracle, idempotency tenancy, webhook intake, duplicate callback log, mode matrix, secrets, SSRF, saga, crash-before-TX2). Duplicate-callback log → `evidence/SF-M01-005/duplicate-callback.log`. Mode matrix → `evidence/SF-M01-005/simulation-mode-matrix.md`.

### B. ADR-0006 privilege-boundary (new; gate `component_privilege_boundary`)

| ID | Proof |
|---|---|
| 005-34 | Runtime LOGIN identity: IN ROLE only `sf_app` + `sf_cmp037_rw`; `sf_cmp037_rw` `rolcanlogin=false`; runtime `rolsuper`/`rolbypassrls` false; `pg_tables.tableowner` / schema owner ≠ runtime; owner is `sf_migrator` (or equivalent). |
| 005-35 | Own authorized DML succeeds (insert/update binding+transaction+route+definition under T1). |
| 005-36 | Wrong-tenant S/I/U/D fail through RLS (overlap 005-02). |
| 005-37 | Login `IN ROLE sf_app` **only** cannot SELECT/INSERT/UPDATE/DELETE domain tables; may still INSERT outbox (frozen residual, asserted and documented). |
| 005-38 | Login `IN ROLE sf_app, sf_cmp002_rw` (peer stub role, **no** grants on our tables) cannot S/I/U/D CMP-037 authoritative tables. Same for stubs `sf_cmp031_rw`, `sf_cmp038_rw`, `sf_cmp048_rw`. |
| 005-39 | Runtime `SET ROLE sf_cmp002_rw` (etc.) fails; `pg_has_role(rt, 'sf_cmp002_rw', 'MEMBER')` false. |
| 005-40 | PUBLIC: zero table/sequence privileges in `sf_integration_hub`; default privileges do not grant to PUBLIC/`sf_app`. Zero SECURITY DEFINER functions (005-03). |
| 005-41 | Outbox SQL equals rendered frozen template (grant/column identical). |

Log: `evidence/SF-M01-005/privilege-boundary.log`.

### C. Contract / unit / failure-path

Mode matrix 8×3×critical; startup guard; secrets canary; retry/breaker; webhook crypto; event builders; no-txn guard; simulation marker; guardedFetch SSRF; static grep no SIMULATED substitution; adapters import only guardedFetch.

### D. Commands (implementation phase)

```
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test
pnpm --filter @serviceform/cmp-037-integration-hub test:integration   # PG16
pnpm gates
python scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-005.yaml --base origin/main
pnpm deps:graph
gitleaks / semgrep on the diff
```

Do **not** disable lint/security. Do **not** claim CERTIFIED.

---

## 9. Observability, evidence, handover (implementation phase)

- `evidence/SF-M01-005/EVIDENCE.md` — commit SHA, resolved model/effort, commands, results, non-spec defaults (X-13), frozen outbox residual, Q11 M05 limitation, simulator coverage gap.
- `privilege-boundary.log`, `simulation-mode-matrix.md`, `duplicate-callback.log`
- `junit/*.xml`, `coverage-summary.json` (≥80% lines on new `packages/connector-sdk/src` + `services/cmp-037-integration-hub/src`)
- `scope-check.log`, `gates.log`
- `orchestrator/handovers/SF-M01-005.yaml`

---

## 10. Rollback

- **Down migrations:** DROP tables/schema objects in reverse; DROP ROLE `sf_cmp037_rw`; do **not** DROP shared `sf_migrator` if created IF NOT EXISTS. Lint checks destructive markers on **up** only (X-9).
- **Code:** revert the branch. No apps/api wiring, so no runtime consumers in W1.
- **Forward-safe:** new schema only; no backfill of existing business data.

---

## 11. Write-path limits

| Allowed | Refused |
|---|---|
| `services/cmp-037-integration-hub/**` | `pnpm-lock.yaml`, `contracts/**`, Constitution, other CMPs, `apps/**`, `packages/contracts/**`, `orchestrator/tasks/**`, `simulators/README.md`, frozen contracts, `db/migrations/1759482000000_*`, `db/test/**` |
| `packages/connector-sdk/**` | New infra, Kafka, Redis, second database |
| `simulators/framework/**` | Provider-specific connectors |
| `db/migrations/*_cmp-037-*.sql` | SECURITY DEFINER, BYPASSRLS, editing outbox grants |
| `evidence/SF-M01-005/**`, `orchestrator/handovers/SF-M01-005.yaml` | Import of unmerged SF-M01-001..004 code |

---

## 12. Resolved questions (do not re-open without a stop)

| ID | Ruling applied |
|---|---|
| Q1 | No SECURITY DEFINER. `webhook_route` + ADR-0006 grants. |
| Q2 | PRODUCTION ⇒ REAL for every enabled binding (stricter than frozen schema). |
| Q3 | Repository methods only; no public admin HTTP in W1. |
| Q4 | Null-tenant / platform bindings out of W1. No fallback chain. |
| Q5 | Stale IN_PROGRESS reconciliation deferred; replay must not re-call (005-33). |
| Q6/X-10 | Plugin `prefix`; Eng paths; no `apps/api` registration. |
| Q7/X-3 | Topic `sf.integration-hub.events.v1`. |
| Q8/X-9 | Down DROP allowed without `sf:allow-destructive` on down. |
| Q9/X-13 | Configurable defaults: 10 s / 3 retries / 5 failures / 30 s / 300 s skew. |
| Q10 | In-process breaker only. |
| Q11 | Same provider_reference + different payload = idempotent + warning. |
| Q12 | Webhooks emit Succeeded/Failed only. |
| Q13/X-7 | Webhook `cell_id` from `SF_CELL_ID`. |
| Q14 | Simulator outside workspace/coverage; W2 gap. |
| Q15 | Timestamp band 17595005xxxxx. |
| ADR-0006 names | `sf_cmp037_rw` (not `sf_integration_hub_rw`). |

No remaining architecture/statutory ambiguity that blocks planning. Implementation starts only after orchestrator **plan approval**.

---

## 13. Stop conditions (implementation will halt)

Frozen contract change; tenant/security boundary change beyond approved Q1/P-005-1; new infra; write outside allowed paths; need for unmerged sibling code; provider-specific connector; secrets backend beyond SecretResolver port; ADR-0006 condition 1–10 violated (including granting another component SQL or editing outbox grants); lockfile commit required; second failed Sonnet verification (escalate to Opus); VTQS < 85.

---

## 14. This commit vs next

| This PR (plan) | After approval |
|---|---|
| `IMPLEMENTATION-PLAN.md` only | Tests first (duplicate-callback, simulation-mode, privilege-boundary), then schema/SDK/service/simulator |
| Draft PR, unmerged | Evidence + handover; still no self-certify, no merge, no Wave 2 |
