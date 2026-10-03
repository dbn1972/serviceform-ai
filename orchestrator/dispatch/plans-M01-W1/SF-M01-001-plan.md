# SF-M01-001 plan: CMP-002 Tenant & Government Organisation Service (PLAN ONLY)

Builder: serviceform-foundation-builder, route opus (claude-opus-5-5), effort high. Base d1d0965,
branch agent/M01-cmp-002-tenant-organisation-SF-M01-001, worktree /var/tmp/wt-SF-M01-001.
Sources read: envelope (/var/tmp/sf/orchestrator/tasks/SF-M01-001.yaml, authoritative; the worktree
copy is the stale BLOCKED version), DISPATCH-PLAN-M01-W1, AGENTS.md, ARCHITECTURE-CONSTITUTION.md,
CLAUDE-MULTI-AGENT-GUIDE.md s10/s11, MODEL-ROUTING-QUALITY.md s9, TENANCY.md, contracts/shared/**,
contracts-lock.yaml, CONTRACT-REVIEW-001, migrations 1759482000000 + 1759490000000, db/README,
migration_lint.py, check_scope.py, apps/api host, Eng v1.4 CMP-002 + INT-011, AWS v1.7 CMP-002,
s13.1-13.4, s14.3, TI v1.0 s4, s7, s8, s9, s16, s18 and the Tenant Isolation Constitution.
No architecture change is proposed. Items in section 7 marked ARCH need a decision before code.

## 1. Impact plan (AGENTS.md task loop step 2)
- Requirements: Eng v1.4 CMP-002 (responsibilities: tenant lifecycle, organisation hierarchy, office
  registry, tenant isolation class + cell placement; failure cases: hierarchy cycle, tenant boundary
  mismatch, cross-tenant office reference); certification focus "no hierarchy cycles or cross-tenant
  office references; cell/isolation changes are effective-dated and audited"; INT-011 (API,
  repository and DB-level cross-tenant denial); AWS v1.7 CMP-002 (configurable organisation types,
  adjacency list + path, tenant placement registry); TI v1.0 s4/s7/s8/s16/s18; Constitution #2, #3,
  #6, #11, #12, #19, #23, #24.
- Domain: Tenant (ACTIVE/SUSPENDED), Organisation (identity + insert-only effective-dated versions,
  organisation_type_code is configurable text, never an enum tied to a State), OrganisationRelation
  (insert-only effective-dated parent/child edges; a move is a new edge version), Office
  (DRAFT -> ACTIVE -> INACTIVE, belongs to one organisation of the same tenant), TenantCellBinding
  (insert-only effective-dated placement: cell_id + isolation model POOL/BRIDGE/SILO per TI s4).
  No geography (CMP-003), no officer permissions (CMP-048/OPA), no identity (CMP-004).
- Data: one new schema `sf_tenant_org` owned by CMP-002 (name is a proposal, Q7), tables in s2.
  No cross-schema FK or query; FKs only inside the schema and always composite with tenant_id.
- APIs/events: s3. Component-owned OpenAPI 3.1 + AsyncAPI + event data JSON Schemas under
  services/cmp-002-tenant-organisation/contracts/. Shared envelopes consumed, never edited.
- Tenancy/authz: tenant only from the server-side RequestContext (SF-CON-REQUEST-CONTEXT) supplied by
  an injected resolver; every DB transaction applies dbSessionSettings(ctx) with
  set_config(k, v, true); FORCE RLS on every tenant table with sf_platform.current_tenant_id();
  every action asks an AuthorizationPort (SF-CON-AUTHZ-DECISION) and fails closed.
- Migration: two forward-only SQL files in db/migrations (s2), each with Up/Down, isolation
  declarations, no destructive statements in Up; round trip tested (down only these two files).
- Tests: unit, contract (schemas, examples, OpenAPI/AsyncAPI), service integration on PostgreSQL 16
  (RLS matrix, API negative, idempotency, outbox, hierarchy, migration round trip). s4, s8.
- Observability: Fastify request.log (pino via @serviceform/observability redaction) with
  correlation_id, tenant_id, actor_type, route, outcome; no names/PII in logs; ETag on reads
  (Cache-Control: private, no shared cache; Redis hierarchy cache deferred, no new infra).
  Spans/metrics wiring is CMP-047 (W2); code uses only Fastify hooks so it attaches later.
- Rollback: code is an unregistered plugin until CMP-036 mounts it, so code rollback = revert
  merge. DB: Down sections drop only sf_tenant_org objects (DROP SCHEMA sf_tenant_org CASCADE after
  revoking grants); tested in the round trip. Data created in a shared env would be lost on down,
  so production rollback is forward-fix only (stated in EVIDENCE.md).

## 2. Tables (schema sf_tenant_org, owner=CMP-002)
Common to every TENANT_SCOPED table: `tenant_id uuid NOT NULL`, ENABLE + FORCE ROW LEVEL SECURITY,
policy `<t>_tenant ON sf_tenant_org.<t> TO sf_app USING (tenant_id = sf_platform.current_tenant_id())
WITH CHECK (tenant_id = sf_platform.current_tenant_id())`, indexes lead with tenant_id, uniqueness
includes tenant_id. Insert-only tables get only GRANT SELECT, INSERT to sf_app (UPDATE/DELETE
refused by privilege, so past versions cannot be mutated). sf_app never owns tables.

File A: `db/migrations/1759500100000_cmp-002-tenant-organisation.sql` (timestamp band: Q8)
1. `tenant` TENANT_SCOPED (the row's own tenant). tenant_id uuid PK, code text NOT NULL UNIQUE
   (CHECK ^[a-z0-9][a-z0-9-]{1,62}$), display_name text NOT NULL, status text CHECK (ACTIVE,
   SUSPENDED), version bigint NOT NULL DEFAULT 1, created_at, created_by uuid, updated_at.
   Grants SELECT, INSERT, UPDATE(status, display_name, version, updated_at). Q1 (ARCH).
2. `tenant_cell_binding` TENANT_SCOPED, insert-only. binding_id uuid PK, tenant_id FK -> tenant,
   cell_id text CHECK (^cell-[a-z0-9-]{1,40}$, same as common.cellId), isolation_model text CHECK
   (POOL, BRIDGE, SILO), valid_from timestamptz NOT NULL, seq bigint NOT NULL, reason text NOT NULL,
   requested_by uuid NOT NULL, created_at; UNIQUE (tenant_id, seq), UNIQUE (tenant_id, valid_from).
   Current binding = latest valid_from <= now(). Two-person approval: Q3 (ARCH).
3. `organisation` TENANT_SCOPED. (tenant_id, organisation_id) PK, code text NOT NULL,
   created_at, created_by; UNIQUE (tenant_id, code); FK (tenant_id) -> tenant.
4. `organisation_version` TENANT_SCOPED, insert-only (extra table: Eng lists "organisation"; the
   split keeps identity FK targets stable while versions stay immutable). (tenant_id,
   organisation_id, version_no) PK, name, organisation_type_code (^[A-Z][A-Z0-9_]{1,63}$),
   status (ACTIVE, DISSOLVED), valid_from NOT NULL, reason, created_by, created_at;
   UNIQUE (tenant_id, organisation_id, valid_from); FK (tenant_id, organisation_id) -> organisation.
5. `organisation_relation` TENANT_SCOPED, insert-only. relation_id PK, tenant_id,
   child_organisation_id, parent_organisation_id NULL (NULL = root from valid_from), relation_type_code,
   version_no, valid_from, created_by, created_at; CHECK child <> parent; composite FKs
   (tenant_id, child/parent) -> organisation (cross-tenant parent impossible at DB level);
   UNIQUE (tenant_id, child_organisation_id, version_no). Cycle check in the service under a
   per-tenant transaction lock (SELECT ... FOR UPDATE on the tenant row) with a recursive CTE over
   edges effective at valid_from and after. Closure/materialised path deferred (AWS says "when
   large tree queries need it"); recursive CTE indexed on (tenant_id, child_organisation_id, valid_from).
6. `office` TENANT_SCOPED. (tenant_id, office_id) PK, organisation_id, code, name, status (DRAFT,
   ACTIVE, INACTIVE), version bigint (optimistic lock), activated_at, created_at, created_by;
   FK (tenant_id, organisation_id) -> organisation (no cross-tenant office reference);
   UNIQUE (tenant_id, code). Grants SELECT, INSERT, UPDATE(status, version, activated_at, name).
7. `idempotency_record` TENANT_SCOPED (SF-CON-IDEMPOTENCY fields): tenant_id, principal_id,
   endpoint, idempotency_key, request_fingerprint (sha256:...), status, response_ref, created_at,
   expires_at, plus response_status int and response_body jsonb (the stored original response;
   response_ref = `sf_tenant_org.idempotency_record:<id>`). PK (tenant_id, principal_id, endpoint,
   idempotency_key). Grants SELECT, INSERT, DELETE (expiry sweep).
8. `idempotency_record_platform` PLATFORM_OPERATIONAL (null-tenant privileged endpoints): same
   columns without tenant_id; ENABLE + FORCE RLS anyway with policy `principal_id =
   sf_platform.current_actor_id()` so one admin cannot read another's stored responses.
9. Grants: USAGE on schema to sf_app; nothing to PUBLIC. Down: revoke, DROP SCHEMA CASCADE.

File B: `db/migrations/1759500100001_cmp-002-outbox.sql`: outbox_event (TENANT_SCOPED),
outbox_event_platform (PLATFORM_OPERATIONAL), inbox_event (TENANT_SCOPED), inbox_event_platform
(PLATFORM_OPERATIONAL) copied byte-for-byte from contracts/shared/sql/outbox.template.sql with only
`{schema}` -> sf_tenant_org and `{cmp}` -> CMP-002 substituted (policies already use
sf_platform.current_tenant_id()). A test diffs the file's Up body against the template after
substitution. Down drops the four tables and revokes publisher grants.

## 3. APIs and events (Eng v1.4 CMP-002)
Routes are a Fastify plugin `tenantOrganisationPlugin(opts)` with no prefix; the host (CMP-036, W2)
mounts it (Q9). Every body/param/query has a JSON Schema with additionalProperties:false and no
tenant_id field. Errors use SF-CON-ERROR-RESPONSE with catalogue codes; a plugin-scoped error
handler maps a local `Cmp002Error(code)` built on errorEntry() from @serviceform/contracts.
| Eng v1.4 interface | Route | Notes |
|---|---|---|
| Query GET /tenants/{id} | GET /tenants/:id | id must equal ctx.tenant_id else 403 SF-TEN-002 before any DB read; returns tenant + current binding |
| Query GET /organisations | GET /organisations?as_of&parent_id&cursor&limit | effective-dated tree slice, cursor pagination, limit <= 200 |
| Command POST /organisations | POST /organisations | Idempotency-Key required; creates organisation v1 (+ relation if parent_id); emits OrganisationChanged |
| Query GET /offices | GET /offices?organisation_id&status&cursor&limit | |
| Command POST /admin/tenant-bindings | POST /admin/tenant-bindings | privileged; new effective-dated binding; emits TenantIsolationClassChanged when model changes (Q4) |
| (not listed, needed for TenantCreated) | POST /admin/tenants | privileged; creates tenant + initial binding; emits TenantCreated. Additive, Q2 |
| (not listed, needed for hierarchy versioning) | POST /organisations/:id/versions | new version and/or new parent edge; emits OrganisationChanged. Q2 |
| (not listed, needed for OfficeActivated) | POST /offices, POST /offices/:id/activate | emits OfficeActivated on activate. Q2 |
Events (SF-CON-EVENT-ENVELOPE v1, snake_case, schema_version 1, partition_key = aggregate_id, one
outbox row inserted in the same transaction as the state change after validate('event-envelope')):
- TenantCreated (aggregate Tenant; tenant_id = new tenant; cell_id = assigned cell) data {tenant_id,
  code, cell_id, isolation_model, valid_from}.
- OrganisationChanged (aggregate Organisation; aggregate_version = version_no) data {organisation_id,
  change: CREATED|VERSIONED|RELATION_CHANGED, version_no, valid_from, parent_organisation_id|null,
  organisation_type_code}.
- OfficeActivated (aggregate Office) data {office_id, organisation_id, activated_at}.
- TenantIsolationClassChanged (aggregate Tenant; aggregate_version = binding seq) data {binding_id,
  from_model, to_model, from_cell_id, to_cell_id, valid_from, reason}.
All tenant-owned -> sf_tenant_org.outbox_event. Topics proposed `sf.tenant-org.<event>.v1` (must
exist in the CMP-038 topic registry: Q6). Handled events: none (Eng lists "Emits / handles" generically;
CMP-002 consumes nothing in W1); inbox tables exist per template.
Tenant context: plugin option `resolveContext(request) => Promise<RequestContext | null>` (production
adapter = CMP-036/CMP-004 in W2). Result is validated against SF-CON-REQUEST-CONTEXT; null/invalid ->
401 SF-AUTH-001; null tenant_id on a tenant route -> 401 SF-TEN-001. An onRequest hook refuses any
request carrying a tenant-identifying header (x-tenant-id, x-sf-tenant-id, tenant-id, x-tenant;
regex /^(x-)?(sf-)?tenant(-id)?$/i) with 403 SF-TEN-002, even if it matches the context (AWS s13.1
allows hints "only when independently authorized"; v1 refuses: Q10). The test double resolver maps
opaque bearer fixtures to contexts and never reads tenant headers.
Authorization: plugin option `authorizer: AuthorizationPort { decide(input: AuthzDecisionInput):
Promise<AuthzDecisionOutput> }` (SF-CON-AUTHZ-DECISION; production = CMP-048 OPA client, W2). CMP-002
builds the input (subject from ctx, resource {resource_type, tenant_id, organisation_id}, action code
e.g. TENANT_CREATE, TENANT_BINDING_CHANGE, ORGANISATION_CREATE/READ, OFFICE_ACTIVATE/READ) and only
enforces allow/deny; it never decides roles itself. Error/timeout -> deny (403 SF-AUTH-002 for deny,
503 SF-SYS-004 for authorizer unavailable, no state change). Test double `ContractAuthorizer`
validates input and output against the frozen schema and applies a fixture allow-table.
Privileged path (/admin/*): local precondition before authz: actor.type === PRIVILEGED_ADMIN and
auth_assurance === MFA and a `reason` in the body (1..1000 chars); else 403 SF-AUTH-002. The
privileged transaction derives the new tenant id server-side (gen_random_uuid in code), sets
app.tenant_id to it with set_config(...,true) inside that transaction only (Q1), inserts tenant +
binding + TenantCreated + audit row, commits. Audit: an SF-CON-AUDIT-EVENT (action_class PRIVILEGED,
reason, result SUCCESS, classification TENANT_SCOPED, before_ref/after_ref = version refs, no
payload copy) validated with validate('audit-event') and written to the outbox in the same
transaction (AWS v1.7 CMP-031 "critical state changes also write transactional audit/outbox record";
SF-M01-003 ingests audit "through the frozen outbox/event contracts"). Wrapper event type and topic
are not frozen: Q5. Denied privileged attempts (tenant roles, no MFA, authz deny) write a DENIED
audit row in a separate short transaction under the caller's context (platform outbox if the caller
has no tenant) and return 403. Port `AuditRecorder.append(tx, auditEvent)` hides the transport so the
Q5 answer changes one adapter. Tenant-scoped admin writes (POST /organisations etc.) emit WRITE audit
the same way.
Idempotency: commands require Idempotency-Key (SF-CON-IDEMPOTENCY pattern, else 400 SF-SYS-003).
Fingerprint = sha256 of method + route + canonical JSON body. In the command transaction: INSERT
record ON CONFLICT DO NOTHING; a concurrent twin blocks on the PK and then sees the committed row.
Existing + same fingerprint + COMPLETED -> replay stored status/body (no new row, no new event);
different fingerprint -> 409 SF-APP-002. Record is written COMPLETED with response in the same
transaction as the state change, so a rolled-back command leaves no record. TTL 24 h (Q11).
DB access: `withContextTx(pool, ctx, fn)`: BEGIN; set_config for each dbSessionSettings(ctx) entry
(local=true); fn; COMMIT/ROLLBACK; no network call inside (authz and resolver run before BEGIN).

## 4. Negative tests (proposed to the security verifier, who writes the final set first, s9)
RLS matrix (integration, real login role `sf_m01_001_rt` IN ROLE sf_app, not superuser):
for each of tenant, tenant_cell_binding, organisation, organisation_version, organisation_relation,
office, idempotency_record, outbox_event, inbox_event x {SELECT, INSERT, UPDATE, DELETE} x
{own tenant, other tenant, unset context, '' context from a reused pooled session}:
- other tenant: SELECT 0 rows; INSERT refused (WITH CHECK); UPDATE/DELETE 0 rows or permission denied.
- unset and '' context: SELECT 0 rows with no error; all writes refused.
- own tenant on insert-only tables: UPDATE/DELETE permission denied (immutability).
- outbox_event: sf_app SELECT/UPDATE/DELETE denied; insert with envelope tenant != row tenant refused.
- idempotency_record_platform: actor A cannot read actor B rows; unset actor sees nothing.
- catalogue checks: relrowsecurity and relforcerowsecurity true on all TENANT_SCOPED tables;
  sf_app and sf_m01_001_rt have rolbypassrls false; no table owned by sf_app.
API/service level (fastify.inject against real DB):
- wrong tenant: GET /tenants/{otherId} 403 SF-TEN-002, body has no tenant data; GET /organisations
  and /offices never return other-tenant rows (seeded T1/T2 fixtures).
- POST /organisations with parent_id of another tenant -> 404 SF-SYS-002 (indistinguishable from
  missing); office for other-tenant organisation -> 404; no row, no event.
- forged header x-tenant-id (other tenant, same tenant, mixed case) -> 403 SF-TEN-002, no DB call.
- tenant_id in body or query -> 400 SF-SYS-003 (schema), never used.
- no context / invalid context (fails request-context schema) -> 401 SF-AUTH-001; null tenant on
  tenant route -> 401 SF-TEN-001.
- authz deny -> 403 SF-AUTH-002 + DENIED audit; authorizer throws/times out -> fail closed, no write.
- privileged: tenant OFFICER/role on POST /admin/tenants and /admin/tenant-bindings -> 403 + DENIED
  audit; PRIVILEGED_ADMIN without MFA -> 403; missing reason -> 400; success writes tenant, binding,
  TenantCreated and PRIVILEGED audit in one transaction (fault injection after audit insert rolls
  everything back).
- idempotency: same key + same body x2 -> 1 row, 1 outbox event, identical response; same key
  different body -> 409 SF-APP-002; 10 parallel identical requests -> 1 row; same key by another
  principal or tenant -> independent; malformed/missing key -> 400.
- duplicate events: second insert of the same event_id into outbox refused (UNIQUE); inbox
  (consumer_group, event_id) conflict detected as already-applied; replayed command emits no
  second event.
- invalid envelope (forced bad data) -> validation throws before insert, transaction rolled back.
- hierarchy: self-parent, 2-cycle, deep N-cycle, cycle formed only at a future valid_from, two
  concurrent moves that together form a cycle (lock serialises, one refused) -> 400 SF-SYS-003
  detail HIERARCHY_CYCLE (Q12); past versions unchanged after a move; as_of query returns old tree.
- office: activate twice -> one OfficeActivated (idempotent state), stale version -> conflict.
- pooled session reuse: same pg connection runs T1 tx, then tx without context -> 0 rows, no error;
  then T2 tx sees only T2.
- migration: up, down 2, up again; migration_lint clean; outbox file equals template.

## 5. Files to create/modify (all inside allowed_write_paths unless noted)
services/cmp-002-tenant-organisation/ (allowed: services/cmp-002-tenant-organisation/**):
- package.json, tsconfig.json, vitest.integration.config.ts, README.md (component scope + rollback)
- contracts/openapi.yaml, contracts/asyncapi.yaml,
  contracts/events/{tenant-created,organisation-changed,office-activated,tenant-isolation-class-changed}.data.schema.json
- src/index.ts (plugin export), src/plugin.ts, src/errors.ts, src/context.ts (resolver port,
  header guard), src/authz.ts (AuthorizationPort), src/audit.ts (AuditRecorder port + outbox
  adapter), src/db/tx.ts (withContextTx), src/db/outbox.ts, src/db/idempotency.ts,
  src/domain/{tenant,organisation,hierarchy,office,binding}.ts, src/repositories/{tenant,
  organisation,office,binding}.repo.ts, src/routes/{tenants,organisations,offices,admin}.ts,
  src/schemas/http.ts, src/events.ts
- test/unit/*.test.ts (hierarchy cycle detection, fingerprint, header guard, error mapping, event
  builders, privileged precondition), test/contract/*.test.ts (event data + envelope + audit + error
  + OpenAPI/AsyncAPI parse), test/doubles/{context-resolver,authorizer,clock}.ts,
  test/integration/{rls-matrix,api-negative,idempotency,outbox,privileged,hierarchy,pool-reuse,
  migration}.int.test.ts, test/integration/helpers.ts
db/migrations/1759500100000_cmp-002-tenant-organisation.sql, db/migrations/1759500100001_cmp-002-outbox.sql
(allowed: db/migrations/*_cmp-002-*.sql)
pnpm-lock.yaml (allowed, only via pnpm install for the new workspace importer)
evidence/SF-M01-001/** and orchestrator/handovers/SF-M01-001.yaml (implicitly allowed by
check_scope.py for every task)
Not touched: contracts/**, packages/**, apps/**, db/test/**, db/package.json, root configs, .github.

## 6. Dependencies
No new third-party package. The service package declares only versions already in the lockfile:
fastify 5.12.5, fastify-plugin 5.1.0, pg 8.23.1, @serviceform/contracts workspace:*,
@serviceform/observability workspace:*; dev: @types/pg 8.23.1. The only candidate addition is
`yaml` 2.9.1 (already in the lockfile transitively) as a devDependency to parse openapi.yaml /
asyncapi.yaml in contract tests; if the orchestrator prefers zero additions, both files are written
as JSON (openapi.json, asyncapi.json) instead. node-pg-migrate
9.0.0 is invoked through `pnpm --filter @serviceform/db exec`, not added. No OPA binary use (authz
is a port with a contract-validated double).

## 7. Open questions, ambiguities, foreseen stop conditions
Q1 ARCH/tenant-boundary: class of `tenant` and `tenant_cell_binding`. Plan: TENANT_SCOPED keyed by
   the tenant itself, and the privileged creation transaction sets app.tenant_id to the new
   server-generated id. Alternative is PLATFORM_OPERATIONAL with a dedicated role. Either is a
   tenant-boundary decision; also means platform operators cannot read tenant rows (TI #15). Needs
   security verifier/orchestrator ruling before code.
Q2 API surface: Eng v1.4 lists no command for tenant creation, organisation versioning or office
   activation, yet requires TenantCreated, versioned hierarchy and OfficeActivated. Plan adds
   POST /admin/tenants, POST /organisations/{id}/versions, POST /offices, POST /offices/{id}/activate
   as component-owned additive APIs. Confirm, or say POST /admin/tenant-bindings should create tenants.
Q3 ARCH/security: AWS v1.7 CMP-002 requires "two-person approval for sensitive placement/authority
   changes"; the envelope does not. Not chosen: either implement maker-checker (PROPOSED -> APPROVED
   by a different PRIVILEGED_ADMIN) for tenant-bindings now, or record it as a deferred gap.
Q4 Spec conflict: Eng v1.4 event TenantIsolationClassChanged vs AWS v1.7 TenantPlacementChanged. A
   cell move with the same isolation model: emit TenantIsolationClassChanged anyway, emit nothing, or
   add TenantPlacementChanged? Precedence decision (ADR-0002 style), not mine.
Q5 Cross-task contract not frozen: how producers hand audit events to CMP-031 (outbox wrapper
   event_type, topic, aggregate) and the CMP-038 topic registry names (Q6). Plan uses a port with a
   provisional `AuditEventRecorded` outbox row; needs integration-stitcher agreement with
   SF-M01-003/004, otherwise this is "dependency on another wave task's unmerged code" (stop).
Q6 Topic names for the four events (proposed sf.tenant-org.<event>.v1).
Q7 Schema naming convention for component schemas (proposed sf_tenant_org); no convention exists.
Q8 Migration timestamp bands for wave 1 to avoid --check-order conflicts at merge (proposed
   1759500100000-099 for CMP-002). Also: roles are cluster-global on the shared PostgreSQL; the round
   trip will only roll back the two CMP-002 files, never the shared baseline.
Q9 Route prefix: Eng paths are unprefixed; services/README says /v1/<component>. Host decides (W2).
Q10 AWS s13.1 permits client tenant headers as "hints when independently authorized"; the envelope
   says refuse. Plan refuses all tenant headers. Confirm.
Q11 Idempotency retention period is not specified ("bounded"); proposed 24 h.
Q12 Error catalogue has no hierarchy-cycle or generic conflict code. Plan uses SF-SYS-003 (400) with
   detail code HIERARCHY_CYCLE and SF-SYS-002 for cross-tenant references; a dedicated SF-TEN code
   would need a Contract Change Request (stop if required).
Q13 Envelope contract_locks omit SF-CON-AUTHZ-DECISION, which the authorizer port consumes (FROZEN
   v1). Please add it, or tell me to use a local port type.
Q14 Envelope check uses `check_scope.py --base 684b443`; from that base the diff includes the
   d1d0965 contract-freeze commits (contracts/**), which would fail the scope gate. Use --base d1d0965.
Q15 "National reference bodies" are not tenant-scoped (AWS v1.7); out of scope for W1 and not
   modelled (no NULL tenant as global, TI #8). Needs a GLOBAL design later.
Foreseen stop conditions: Q1/Q3/Q4 unresolved (ARCH); Q5 if audit transport cannot be agreed
through frozen contracts; Q12 if a new error code is demanded; any need for geography (CMP-003) or
role logic (CMP-048) during hierarchy/office work.

## 8. Evidence (evidence/SF-M01-001/)
EVIDENCE.md (commit SHA, model claude-opus-5-5, effort high, commands, results, VTQS inputs, no
self-certification); rls-negative-matrix.md (table x operation x tenant case, generated from the
test run); event-schema-validation.log (every emitted envelope + data schema + audit event validated);
junit/unit.xml, junit/integration.xml; coverage-summary.json (>=80% lines on services/cmp-002*/src);
scope-check.log; gates.log (migration_lint, contracts_lock_gate, hardcoding, agent_rules,
codeowners); migration-roundtrip.log; deps-graph.log; lint-typecheck.log; secrets-sast.log
(gitleaks/semgrep, or a recorded "tool not installed" gap); orchestrator/handovers/SF-M01-001.yaml.
Estimated tests: ~45 unit/contract, ~120 integration cases (RLS matrix ~144 generated cells counted
as parametrised cases).
