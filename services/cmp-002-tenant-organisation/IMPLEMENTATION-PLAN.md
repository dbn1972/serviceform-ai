# SF-M01-001 implementation plan — CMP-002 Tenant & Government Organisation

Status: **PLAN_READY** (Phase 1). Do not implement until the orchestrator approves this document.

| Field | Value |
|---|---|
| Task | SF-M01-001 |
| Component | CMP-002 |
| Integration | INT-011 |
| Builder | serviceform-foundation-builder |
| Branch | `agent/M01-cmp-002-tenant-organisation-SF-M01-001` |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` (PR #6 merged) |
| Schema | `sf_tenant_org` (PLAN-REVIEW X-2) |
| Privilege role | `sf_cmp002_rw` NOLOGIN (ADR-0006 ACCEPTED Option A) |
| Self-certification | **Not claimed.** Gate status is a recommendation after executed evidence only. |

This plan supersedes `orchestrator/dispatch/plans-M01-W1/SF-M01-001-plan.md` where ADR-0006, PLAN-REVIEW-M01-W1, SECURITY-PRECHECK-M01-W1, and the security-verifier negative-test file disagree with that earlier draft.

## 0. Sources read (Phase 1)

- Envelope `orchestrator/tasks/SF-M01-001.yaml` (authoritative for scope)
- `ARCHITECTURE-CONSTITUTION.md`, `AGENTS.md`, `TENANCY.md`, `00_READ_FIRST.md`
- `docs/adr/ADR-0006-per-component-write-roles.md` (**ACCEPTED**, Option A, ten MUST conditions)
- `orchestrator/dispatch/PLAN-REVIEW-M01-W1.md` (Q1–Q4, Q10, Q12; X-1..X-14)
- `orchestrator/dispatch/plans-M01-W1/SF-M01-001-negative-tests.md` (001-01..001-43, H1–H4) — **mandatory**
- `orchestrator/dispatch/plans-M01-W1/SECURITY-PRECHECK-M01-W1.md` (P-001-1..4, X-1)
- Frozen contracts listed in §1.4; `orchestrator/contracts-lock.yaml` hashes
- M00: `db/migrations/1759482000000_platform-baseline.sql`, `1759490000000_shared-db-contracts.sql`, `db/test/*`, `apps/api`, `packages/contracts`, `packages/observability`
- `contracts/shared/sql/outbox.template.sql` (SF-CON-OUTBOX companion; copy unchanged)
- `scripts/gates/check_scope.py`, `migration_lint.py`, `.dependency-cruiser.cjs`, `vitest.config.ts`
- Specs: `specs/component-map.yaml` CMP-002, `specs/integration-map.yaml` INT-011, `specs/build-plan.yaml` M01

## 1. Impact plan (AGENTS.md loop step 2)

### 1.1 Domain

- **Tenant**: identity + status `ACTIVE` \| `SUSPENDED`. Isolation class TENANT_SCOPED keyed by the tenant’s own id (PLAN-REVIEW Q1). Listing all tenants is out of scope.
- **Organisation**: identity row + insert-only effective-dated versions. `organisation_type_code` is configurable text (`^[A-Z][A-Z0-9_]{1,63}$`), never a jurisdiction/state enum.
- **OrganisationRelation**: insert-only effective-dated parent/child edges. A move is a new edge version. Cycle detection in the service under a per-tenant `SELECT … FOR UPDATE` on the tenant row plus a recursive CTE over edges effective at `valid_from`.
- **Office**: `DRAFT` → `ACTIVE` → `INACTIVE`, one organisation of the same tenant. Composite FK prevents cross-tenant office references.
- **TenantCellBinding**: insert-only current/history of `cell_id` + isolation model `POOL` \| `BRIDGE` \| `SILO`. Changes go through **maker-checker** (Q3).
- **Out of scope**: geography (CMP-003), officer permissions / OPA policy (CMP-048), identity (CMP-004), GLOBAL national reference bodies (Q15 deferred).

### 1.2 Data

- One schema `sf_tenant_org`, owner component CMP-002, table owner **`sf_migrator`** (ADR-0006 §5), never `sf_app` or the runtime login.
- No cross-schema FK or query. FKs inside the schema are composite with `tenant_id` where both ends are TENANT_SCOPED.
- Outbox/inbox tables copied from the frozen template with `{schema}` → `sf_tenant_org` and `{cmp}` → `CMP-002` only.

### 1.3 APIs / events

Component-owned OpenAPI 3.1 + AsyncAPI + event data JSON Schemas under `services/cmp-002-tenant-organisation/contracts/`. Shared envelopes consumed, never edited. Host (CMP-036, W2) is not registered in this task. Plugin accepts `prefix` (default `/v1`) and Eng v1.4 paths under it (X-10).

### 1.4 Tenancy / authz / contracts consumed (FROZEN, read-only)

| ID | Use |
|---|---|
| SF-CON-REQUEST-CONTEXT | Server-derived context; never from client tenant headers |
| SF-CON-DB-SESSION-CONTEXT | `dbSessionSettings(ctx)` + `set_config(k, v, true)` inside the tx |
| SF-CON-AUTHZ-DECISION | `AuthorizationPort.decide`; fail closed |
| SF-CON-ERROR-RESPONSE / SF-CON-ERROR-CATALOGUE | HTTP errors; no new families (X-8) |
| SF-CON-EVENT-ENVELOPE | Outbox envelope validation before insert |
| SF-CON-AUDIT-EVENT | Audit payload inside `AuditEventSubmitted` |
| SF-CON-IDEMPOTENCY | Command keys; fingerprint `sha256:` |
| SF-CON-ISOLATION-DECLARATION | `-- sf:isolation` on every `CREATE TABLE` |
| SF-CON-OUTBOX | Template copy; grants **unchanged** (ADR-0006 §9) |
| SF-CON-COMMON | uuid, cellId, actor, actionCode, resourceType |

Not consumed: SF-CON-CONNECTOR-BINDING, SF-CON-SIMULATION-MARKER.

Tenant id is taken only from the validated request context (privileged create: server-generated UUID set as `app.tenant_id` **after** authz, inside that transaction only). Forged client headers are refused (Q10).

### 1.5 Migration

Two forward SQL files in `db/migrations/` (allowed glob `*_cmp-002-*.sql`), timestamps in band **17595001xxxxx** (X-1), after `1759490000000`:

1. `1759500100000_cmp-002-tenant-organisation.sql` — roles, schema, business tables, grants, triggers.
2. `1759500100001_cmp-002-outbox.sql` — template substitution only.

Each file has `-- Up Migration` / `-- Down Migration`. Down drops only `sf_tenant_org` objects and `sf_cmp002_rw`. It does **not** drop `sf_app`, `sf_outbox_publisher`, or `sf_migrator` (cluster-global / shared). Round-trip tests down **these two files only** then up again. No destructive statements in Up.

### 1.6 Tests

Unit, contract, and service integration on disposable PostgreSQL 16 (`services/cmp-002-tenant-organisation/vitest.integration.config.ts`). Security-verifier cases 001-01..001-43 are mandatory. M00 `db/test` harness (`SET LOCAL ROLE sf_app` from superuser) is **not** reused for tenant cases (X-12 / H1).

### 1.7 Observability

Fastify `request.log` via `@serviceform/observability` redaction: `correlation_id`, `tenant_id`, `actor_type`, route, outcome. No names, reasons, PII, or Authorization headers. Read `Cache-Control: private`. Spans/metrics wiring is CMP-047 (W2); only Fastify hooks so it attaches later.

### 1.8 Rollback

- Code is an unregistered plugin until CMP-036 mounts it → revert merge.
- DB: Down revokes grants and `DROP SCHEMA sf_tenant_org CASCADE`. Production rollback is forward-fix only (stated in EVIDENCE.md after implementation).
- Roles: `DROP ROLE sf_cmp002_rw` in Down after schema drop. `sf_migrator` remains (`IF NOT EXISTS` on Up).

## 2. Allowed vs prohibited writes (verified)

| Path | Verdict |
|---|---|
| `services/cmp-002-tenant-organisation/**` | Allowed (this plan; later code/tests/component contracts) |
| `db/migrations/*_cmp-002-*.sql` | Allowed |
| `evidence/SF-M01-001/**` | Implicitly allowed by `check_scope.py` (implementation phase) |
| `orchestrator/handovers/SF-M01-001.yaml` | Implicitly allowed (implementation phase) |
| `pnpm-lock.yaml` | **Do not write** (coordinator: lockfile is read-only; envelope list is superseded). Merger regenerates if needed. |
| `contracts/**`, Constitution, other `services/cmp-*`, `apps/**`, `packages/**`, `db/test/**`, `db/package.json`, root configs, `orchestrator/tasks/**` | Prohibited |
| Another component’s tables / schemas | Prohibited (no cross-schema SQL) |

Scope check after implementation: `python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-001.yaml --base origin/main` (not `d1d0965` / `684b443`; X-11 plus post-PR-#6 main).

## 3. ADR-0006 privilege layer (MUST, all ten)

M00 today: `sf_app` NOLOGIN group; tables would be granted to `sf_app`; tests often `SET LOCAL ROLE sf_app` from postgres. Wave 1 **must not** copy that grant model.

| # | Condition | CMP-002 implementation |
|---|---|---|
| 1 | `sf_app` no generic DML | No `GRANT INSERT/UPDATE/DELETE/SELECT` on authoritative business tables to `sf_app`. DML + sequence use → `sf_cmp002_rw` only. |
| 2 | `_rw` is NOLOGIN | `CREATE ROLE sf_cmp002_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. |
| 3 | Runtime LOGIN = `sf_app` + own `_rw` only | Tests create `sf_t001_rt` / `sf_t001_rt2` `LOGIN … IN ROLE sf_app, sf_cmp002_rw`. A sibling login `sf_t001_other` `IN ROLE sf_app, sf_cmp048_rw` (test-only role) proves cross-component DENY. Production name is deployment-owned, not committed. |
| 4 | No SUPERUSER / BYPASSRLS | Asserted on `sf_cmp002_rw`, `sf_t001_rt`, `sf_app`. Migrations never grant `BYPASSRLS`. |
| 5 | Runtime not table owner | Schema/tables/sequences owned by `sf_migrator` (`CREATE ROLE sf_migrator NOLOGIN … IF NOT EXISTS` then `AUTHORIZATION` / `ALTER … OWNER TO`). Runtime `pg_has_role(session_user, relowner, 'MEMBER') = false`. |
| 6 | FORCE RLS retained | Every TENANT_SCOPED table: `ENABLE` + `FORCE ROW LEVEL SECURITY`; policies `TO sf_app` using `sf_platform.current_tenant_id()`. |
| 7 | Cross-component SQL DENY | No GRANT of SELECT/INSERT/UPDATE/DELETE on `sf_tenant_org` business tables to any other `_rw` or to `sf_app`. Privilege-boundary tests (001-04 plus ADR-0006 §10). |
| 8 | PUBLIC revoked | `REVOKE ALL ON SCHEMA sf_tenant_org FROM PUBLIC`; revoke table/sequence/function from PUBLIC; `ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_tenant_org REVOKE ALL ON TABLES, SEQUENCES FROM PUBLIC`. |
| 9 | SF-CON-OUTBOX unchanged | File B is a byte-for-byte template after substitution. Residual: template still `GRANT INSERT … TO sf_app` on outbox/inbox. **Not tightened.** Recorded in EVIDENCE.md. Schema `USAGE` for producers: granted to `sf_cmp002_rw` (runtime inherits) **and** `sf_outbox_publisher` as the template requires. Do not add extra outbox grants. |
| 10 | Privilege-boundary tests | See §7.B. Own DML succeeds; wrong-tenant RLS fails; other-component DML fails; `SET ROLE sf_cmp031_rw` (etc.) unavailable; `rolbypassrls=false`; runtime ≠ owner. |

Policies stay `TO sf_app` so membership of `sf_app` is what RLS attaches to. Table privileges come from `sf_cmp002_rw`. A login that is only `sf_app` cannot DML business tables.

**P-001-3 / tenant status:** `UPDATE` on `tenant.status` is granted only to `sf_cmp002_rw`, and a BEFORE UPDATE trigger requires `current_setting('app.privileged_marker', true) = 'TENANT_STATUS'` (set LOCAL inside the privileged tx after authz). Un-suspend from another component is impossible even if grants leaked.

**Maker-checker (Q3):** insert-only proposal table + trigger: insert `PROPOSED` with `requested_by = sf_platform.current_actor_id()`; approve only when `approved_by = current_actor_id()` AND `approved_by <> requested_by`; terminal states immutable.

## 4. Schema / tables (isolation classes)

Schema: `sf_tenant_org`. Owner of objects: `sf_migrator`. Runtime: `sf_t001_rt` ∈ `{sf_app, sf_cmp002_rw}`.

Common TENANT_SCOPED rules: `tenant_id uuid NOT NULL`; ENABLE + FORCE RLS; policy `USING (tenant_id = sf_platform.current_tenant_id()) WITH CHECK (same)`; indexes lead with `tenant_id`; uniqueness includes `tenant_id` except global `tenant.code`. Insert-only tables: GRANT SELECT, INSERT to `sf_cmp002_rw` only (no UPDATE/DELETE).

### File A — `1759500100000_cmp-002-tenant-organisation.sql`

1. **Roles**
   - `sf_migrator` IF NOT EXISTS: `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` (shared; Down does not drop it).
   - `sf_cmp002_rw` as above.
2. **`sf_tenant_org` schema** `AUTHORIZATION sf_migrator`. Comment: isolation owner=CMP-002. `GRANT USAGE ON SCHEMA` to `sf_cmp002_rw` only (plus later File B’s `sf_outbox_publisher`).
3. **`tenant`** TENANT_SCOPED. PK `tenant_id`. `code` UNIQUE global (`^[a-z0-9][a-z0-9-]{1,62}$`), `display_name`, `status` CHECK (`ACTIVE`,`SUSPENDED`), `version` bigint, timestamps, `created_by`. Grants: SELECT, INSERT, UPDATE(`status`,`display_name`,`version`,`updated_at`) to `sf_cmp002_rw`. Status trigger as §3.
4. **`tenant_cell_binding`** TENANT_SCOPED, insert-only. `binding_id` PK, FK `tenant_id` → tenant, `cell_id` CHECK (common.cellId), `isolation_model` CHECK (`POOL`,`BRIDGE`,`SILO`), `valid_from`, `seq`, `reason`, `requested_by`, `created_at`. UNIQUE (`tenant_id`,`seq`), UNIQUE (`tenant_id`,`valid_from`). Current = latest `valid_from <= now()`.
5. **`tenant_placement_proposal`** TENANT_SCOPED, insert-only for sf_cmp002_rw except approve columns. Maker-checker for cell/isolation changes (Q3, test 001-29). Columns: `proposal_id`, `tenant_id`, `proposed_cell_id`, `proposed_isolation_model`, `status` (`PROPOSED`,`APPROVED`,`REJECTED`,`SUPERSEDED`), `reason`, `requested_by`, `approved_by`, `valid_from`, timestamps. Trigger state machine as §3. Unique one open `PROPOSED` per tenant (partial unique index).
6. **`organisation`** TENANT_SCOPED. PK (`tenant_id`,`organisation_id`), `code`, `created_at`, `created_by`; UNIQUE (`tenant_id`,`code`); FK (`tenant_id`) → tenant.
7. **`organisation_version`** TENANT_SCOPED, insert-only. PK (`tenant_id`,`organisation_id`,`version_no`), name, `organisation_type_code`, status (`ACTIVE`,`DISSOLVED`), `valid_from`, `reason`, `created_by`, `created_at`; UNIQUE (`tenant_id`,`organisation_id`,`valid_from`); FK (`tenant_id`,`organisation_id`) → organisation.
8. **`organisation_relation`** TENANT_SCOPED, insert-only. `relation_id` PK, `child_organisation_id`, `parent_organisation_id` NULL = root, `relation_type_code`, `version_no`, `valid_from`, `created_by`, `created_at`; CHECK child ≠ parent; composite FKs to organisation; UNIQUE (`tenant_id`,`child_organisation_id`,`version_no`).
9. **`office`** TENANT_SCOPED. PK (`tenant_id`,`office_id`), `organisation_id`, `code`, `name`, status (`DRAFT`,`ACTIVE`,`INACTIVE`), `version`, `activated_at`, timestamps; FK (`tenant_id`,`organisation_id`) → organisation; UNIQUE (`tenant_id`,`code`). Grants SELECT, INSERT, UPDATE(`status`,`version`,`activated_at`,`name`) to `sf_cmp002_rw`.
10. **`idempotency_record`** TENANT_SCOPED. PK (`tenant_id`,`principal_id`,`endpoint`,`idempotency_key`) matching SF-CON-IDEMPOTENCY plus `response_status int`, `response_body jsonb` (stored replay; `response_ref` points at this row). Grants SELECT, INSERT, DELETE (expiry sweep) to `sf_cmp002_rw`.
11. **`idempotency_record_platform`** PLATFORM_OPERATIONAL. Same without `tenant_id`. ENABLE + FORCE RLS; policy `principal_id = sf_platform.current_actor_id()`. Privileged endpoints with null tenant.

No `prosecdef` functions, no materialised views. Any view would be `security_invoker=true` (none planned). Functions, if any, set `search_path` in `proconfig`.

### File B — `1759500100001_cmp-002-outbox.sql`

`outbox_event` TENANT_SCOPED, `outbox_event_platform` PLATFORM_OPERATIONAL, `inbox_event` TENANT_SCOPED, `inbox_event_platform` PLATFORM_OPERATIONAL — template as-is (including `GRANT INSERT TO sf_app` and publisher grants). Contract test diffs Up body vs rendered template.

## 5. APIs (Eng v1.4 + approved additions)

Plugin `tenantOrganisationPlugin(opts)` with `prefix` (default `/v1`). Bodies/params/query: JSON Schema `additionalProperties: false`, **no `tenant_id` field**. Errors via catalogue + `details[].code` (X-8).

| Interface | Route | Notes |
|---|---|---|
| Query GET /tenants/{id} | `GET /v1/tenants/:id` | `:id` must equal `ctx.tenant_id` else 403 SF-TEN-002 **before** DB; returns tenant + current binding |
| Query GET /organisations | `GET /v1/organisations` | `as_of`, `parent_id`, cursor, `limit` ≤ 200 |
| Command POST /organisations | `POST /v1/organisations` | Idempotency-Key required; org v1 + optional parent relation; `OrganisationChanged` |
| Query GET /offices | `GET /v1/offices` | `organisation_id`, `status`, cursor, limit |
| (Q2) | `POST /v1/admin/tenants` | Privileged create tenant + initial binding; `TenantCreated` |
| Binding / placement propose (P-001-1, Q3) | `POST /v1/admin/tenants/:id/placement-proposals` | Target **only from route**; authz `resource.tenant_id = :id` **before BEGIN**; set_config to target only after allow |
| Binding approve | `POST /v1/admin/placement-proposals/:proposalId/approve` | Different PRIVILEGED_ADMIN + MFA + reason; writes binding + `TenantPlacementChanged` |
| (Q2) | `POST /v1/organisations/:id/versions` | New version and/or parent edge |
| (Q2) | `POST /v1/offices`, `POST /v1/offices/:id/activate` | `OfficeActivated` on activate |

Eng listed `POST /admin/tenant-bindings` is **not** implemented as a body-targeted shortcut (P-001-1 BLOCK). The route-scoped proposal/approve pair replaces it.

**Context:** `resolveContext(request) => Promise<RequestContext \| null>`. Invalid/null → 401 SF-AUTH-001; null `tenant_id` on tenant routes → 401 SF-TEN-001. Header guard: refuse headers matching `/tenant|^x-sf-/i` plus role/actor list (`x-roles`, `x-sf-actor-type`, `x-sf-assurance`, `forwarded` tenant params) with 403 SF-TEN-002 **even when they match context** (Q10 + P-001-2). Resolver never reads tenant headers. Test double maps opaque bearer fixtures only.

**Authz:** `AuthorizationPort` validates I/O against SF-CON-AUTHZ-DECISION. Deny → 403 SF-AUTH-002; throw/timeout → 503 SF-SYS-004 + `PDP_UNAVAILABLE`; malformed output → deny. Local deny if TENANT_SCOPED and subject/resource tenants differ (except the authorised admin target). No DB tx open during resolver/authorizer (001-27).

**Privileged preconditions:** `actor.type === PRIVILEGED_ADMIN` and `auth_assurance === MFA` and body `reason` 1..1000; else 403/400. Tenant roles on `/admin/*` → 403 + DENIED audit.

**Audit (X-4):** `AuditRecorder.append(tx, auditEvent)` writes event type `AuditEventSubmitted` (`data` = exactly one SF-CON-AUDIT-EVENT), topic `sf.audit.ingest.v1`, partition key `audit:<audit_id>`, same transaction as the change. `client_context` is **not** stored (O-3). Denied privileged attempts: short separate tx; platform outbox only for null-tenant callers; rate-limit + counter (P-001-4).

**Idempotency:** required on commands (pattern else 400 SF-SYS-003). Fingerprint = sha256(method + route + canonical JSON). INSERT ON CONFLICT DO NOTHING; replay COMPLETED same fingerprint; different fingerprint → 409 SF-APP-002. TTL **24 h** (X-13). Platform table: admin B cannot replay admin A (001-33).

**DB:** `withContextTx(pool, ctx, fn)`: BEGIN; bind-param `set_config` only; fn; COMMIT/ROLLBACK. No network inside. Repositories throw if called outside it (001-15). No `set_config(..., false)`.

**Events** (envelope v1, snake_case, `partition_key = aggregate_id`, validate then insert same tx):

| Event | Topic | Notes |
|---|---|---|
| `TenantCreated` | `sf.tenant-org.events.v1` | New tenant id, code, cell, model, valid_from |
| `OrganisationChanged` | same | CREATED \| VERSIONED \| RELATION_CHANGED |
| `OfficeActivated` | same | office_id, organisation_id, activated_at |
| `TenantPlacementChanged` | same | Cell **or** isolation-class change (X-5). Eng name `TenantIsolationClassChanged` is an alias comment in component contracts only |
| `AuditEventSubmitted` | `sf.audit.ingest.v1` | Wrapper; data = frozen audit-event |

Component `contracts/topics.json` lists the two topics. CMP-038 registers at stitching. Outbox helper lives in this service, marked `// replaced by packages/outbox at stitching` (X-6). No handled events in W1; inbox tables exist.

**Hierarchy cycles:** 400 SF-SYS-003 + `details[].code = HIERARCHY_CYCLE`. Cross-tenant parent/office: 404 SF-SYS-002, byte-identical to missing (001-11). Depth bomb: statement_timeout / max depth → 400/503, lock released (001-35).

## 6. Files to create (implementation phase only)

```
services/cmp-002-tenant-organisation/
  IMPLEMENTATION-PLAN.md          # this file (Phase 1)
  package.json                    # workspace:* + pinned versions already in lockfile
  tsconfig.json
  vitest.integration.config.ts
  README.md
  contracts/openapi.yaml
  contracts/asyncapi.yaml
  contracts/topics.json
  contracts/events/*.data.schema.json
  src/index.ts, plugin.ts, errors.ts, context.ts, authz.ts, audit.ts, events.ts
  src/db/{tx,outbox,idempotency}.ts
  src/domain/{tenant,organisation,hierarchy,office,binding,proposal}.ts
  src/repositories/*.ts
  src/routes/{tenants,organisations,offices,admin}.ts
  src/schemas/http.ts
  test/unit/*.test.ts
  test/contract/*.test.ts
  test/doubles/{context-resolver,authorizer,clock}.ts
  test/integration/{privilege-boundary,rls-matrix,api-negative,idempotency,
    outbox,privileged,hierarchy,pool-reuse,migration}.int.test.ts
db/migrations/1759500100000_cmp-002-tenant-organisation.sql
db/migrations/1759500100001_cmp-002-outbox.sql
```

Later (still allowed by check_scope): `evidence/SF-M01-001/**`, `orchestrator/handovers/SF-M01-001.yaml`.

Not created: `apps/api` registration, `pnpm-lock.yaml`, frozen `contracts/**`.

## 7. Tests

### 7.A Harness (H1–H4) — mandatory

- Per run: `CREATE ROLE sf_t001_rt LOGIN PASSWORD '<random>' NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp002_rw` and `sf_t001_rt2` same. **Separate `pg.Pool`**. `session_user` = login. Never postgres, never `SET ROLE` from superuser.
- Cross-component login: `sf_t001_other IN ROLE sf_app, sf_cmp048_rw` (create `sf_cmp048_rw` NOLOGIN in the test database only; do not create other components’ tables).
- beforeAll (001-01): `rolsuper=false`, `rolbypassrls=false`, `session_user=current_user`, `pg_has_role(session_user,'sf_app','MEMBER')`, not a member of table owner, not a member of any other `_rw`. Fail the suite (do not skip) on mismatch.
- Pool-reuse: `max: 1`; record `pg_backend_pid()`.
- Fixtures T1/T2 with `CANARY-T2-<uuid>` in every T2 text column.

### 7.B ADR-0006 §10 privilege-boundary (in addition to 001-01..06)

As `sf_t001_rt`: authorised own-tenant DML succeeds. As `sf_t001_other`: SELECT/INSERT/UPDATE/DELETE on every `sf_tenant_org` business table fails (42501). `SET ROLE sf_cmp031_rw` / `sf_cmp048_rw` fails. `rolbypassrls` false. `relowner` ≠ runtime. Static SQL check: neither File A nor B alters attributes/membership of `sf_app` or `sf_outbox_publisher` (001-43).

### 7.C Security-verifier matrix (all PLAN + NEW)

Cases **001-01 through 001-43** from `orchestrator/dispatch/plans-M01-W1/SF-M01-001-negative-tests.md` are copied into the integration suite. Summary:

- Catalogue: FORCE RLS, policies use `current_tenant_id()`, no PUBLIC, no TRUNCATE/TRIGGER/REFERENCES for runtime, no SECURITY DEFINER, insert-only have no UPDATE/DELETE (001-02..05).
- Owner-bypass attempts fail (001-06).
- RLS matrix including `tenant_placement_proposal` (001-07); tenant_id reassignment refused (001-08); leakproof/stats/FK/unique oracles (001-09..12).
- Pool reuse, failed tx context leak, no session-level set_config, SQLi in resolver (001-13..16).
- Forged headers/bodies/cursors/IDs (001-17..24).
- Authz, privileged path, maker-checker concurrency (001-25..31).
- Idempotency, hierarchy, depth bomb, office activate (001-32..36).
- Outbox/audit leakage, logs, error mapping, migration round trip (001-37..43).

Envelope RLS matrix as `sf_app` is executed as the **real login** that is a member of `sf_app`, not by SET ROLE.

### 7.D Contract / unit

- Event data + envelope + audit + error + OpenAPI/AsyncAPI parse; outbox Up == template.
- Hierarchy cycle detector, fingerprint, header guard, privileged preconditions, event builders, error mapping.
- Coverage ≥80% lines on `services/cmp-002-tenant-organisation/src`.

## 8. Dependencies

No new third-party package. Service `package.json` pins versions already present:

- `fastify` 5.12.5, `fastify-plugin` 5.1.0, `pg` 8.23.1
- `@serviceform/contracts` workspace:*, `@serviceform/observability` workspace:*
- dev: `@types/pg` 8.23.1, `typescript` (workspace), vitest provided at root

Contract tests parse YAML with Node or reuse `ajv` already in contracts. Prefer **JSON** OpenAPI/AsyncAPI if a `yaml` dependency would require a lockfile edit.

`node-pg-migrate` 9.0.0 via `pnpm --filter @serviceform/db exec`. No OPA binary.

**Lockfile:** this task will not run `pnpm install` in a way that rewrites `pnpm-lock.yaml`. Residual: CI may need the merger to refresh the lockfile when the new workspace importer lands.

## 9. Evidence (implementation phase)

`evidence/SF-M01-001/`:

- `EVIDENCE.md` — commit SHA, model/effort actually used, commands, results, VTQS inputs, **no CERTIFIED claim**
- `rls-negative-matrix.md` generated from the run
- `event-schema-validation.log`
- `junit/unit.xml`, `junit/integration.xml`
- `coverage-summary.json`
- `scope-check.log`, `gates.log`, `migration-roundtrip.log`, `deps-graph.log`, `lint-typecheck.log`, `secrets-sast.log`
- `orchestrator/handovers/SF-M01-001.yaml`

Acceptance commands (envelope + gates): `pnpm format:check && pnpm lint && pnpm typecheck`; `pnpm test`; component integration suite; `pnpm gates`; `check_scope.py --base origin/main`; `pnpm deps:graph`; gitleaks/semgrep on the diff.

## 10. Open questions closed vs remaining

Closed by PLAN-REVIEW / ADR-0006 / this rebase onto 8a4695d:

| ID | Resolution used |
|---|---|
| Q1 | TENANT_SCOPED self-keyed; privileged create sets `app.tenant_id` to new id; no platform role |
| Q2 | Extra routes approved; P-001-1 replaces body-targeted bindings |
| Q3 | Maker-checker now |
| Q4/X-5 | `TenantPlacementChanged` |
| Q5/X-4 | `AuditEventSubmitted` on own outbox, topic `sf.audit.ingest.v1` |
| Q6/X-3 | `sf.tenant-org.events.v1` |
| Q7/X-2 | `sf_tenant_org` |
| Q8/X-1 | `17595001xxxxx` |
| Q9/X-10 | Plugin `prefix` `/v1`; not mounted in apps/api |
| Q10 | Refuse all client tenant headers |
| Q11/X-13 | 24 h idempotency TTL |
| Q12/X-8 | SF-SYS-003 + `HIERARCHY_CYCLE` |
| Q13 | SF-CON-AUTHZ-DECISION is FROZEN and will be consumed (envelope lock list already includes it on main) |
| Q14 | Scope `--base origin/main` |
| Q15 | GLOBAL reference bodies deferred |
| ADR-0006 | ACCEPTED Option A; role name **`sf_cmp002_rw`** (not `sf_tenant_org_rw`) |

Remaining (do not invent; stop if they become required):

- Geographic containment (CMP-003)
- Officer permission decisions (CMP-048/OPA) — port + fixture only
- Tightening frozen outbox `GRANT INSERT TO sf_app` (needs CCR)
- Creating `sf_migrator` in this component’s migration vs a later platform migration: **this plan uses IF NOT EXISTS in File A** so Wave 1 can satisfy ADR-0006 §5 without editing M00 baseline (read-only). Sibling builders should use the same idiom; Down must not drop `sf_migrator`.

## 11. Stop conditions (will halt implementation)

Any FROZEN contract change; architecture/statutory ambiguity; write outside allowed paths; dependency on another Wave 1 task’s unmerged code; hard-gate failure; need for cross-schema FK; need to edit `pnpm-lock.yaml`, Constitution, or another component.

## 12. Recommended gate status after implementation (not claimed now)

After executed evidence, recommend: Design complete; Develop ready for independent Verify. **Not VERIFIED. Not CERTIFIED.**
