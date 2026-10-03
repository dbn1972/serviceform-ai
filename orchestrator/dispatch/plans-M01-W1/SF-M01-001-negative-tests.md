# SF-M01-001 (CMP-002) mandatory negative, deny and isolation tests

Author: security and tenant isolation verifier (Opus, xhigh), 3 Oct 2026. Written before code (MODEL-ROUTING-QUALITY s9).
Inputs: SF-M01-001-plan.md, envelope, PLAN-REVIEW-M01-W1.md (read: rulings X-1..X-14, Q1 TENANT_SCOPED tenant, Q3
maker-checker, X-5 `TenantPlacementChanged`), migrations 1759482000000/1759490000000, outbox.template.sql, db/test harness.
Status column: **PLAN** = already in the builder's plan s4 (kept mandatory, sharpened); **NEW** = added by the verifier.
Gates: CTL = cross_tenant_leakage, RLS = rls_required_negative_tests, FCC = frozen_contract_conformance,
UCS = unresolved_critical_security. Every case is mandatory; a skipped case is a failed gate.

## H. Harness rules (apply to every DB case)
- H1. Create per run `CREATE ROLE sf_t001_rt LOGIN PASSWORD '<random>' NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app`
  and a second login `sf_t001_rt2 IN ROLE sf_app`. Connect a **separate pg.Pool with these credentials**. Never run a
  tenant case as `postgres`, and never via `SET [LOCAL] ROLE sf_app` from a superuser session (the db/test harness pattern
  is not acceptable here, X-12): `session_user` must equal the login role.
- H2. beforeAll asserts on the runtime connection: `rolsuper=false`, `rolbypassrls=false`, `session_user=current_user`,
  `pg_has_role(session_user,'sf_app','MEMBER')`, and for every sf_tenant_org table `pg_has_role(session_user, relowner,
  'MEMBER')=false`. If any check fails the suite fails (not skips).
- H3. Pool-reuse cases use `max: 1` so the same backend is reused; record `pg_backend_pid()` to prove reuse.
- H4. Fixtures T1/T2 with distinctive canary values (`CANARY-T2-<uuid>`) in every text column of T2.

## A. Catalogue and privilege boundary
- **001-01** NEW RLS/UCS. Pre: migrated DB. Act: H2 identity checks. Exp: all true as stated; suite aborts otherwise.
- **001-02** PLAN RLS. Act: catalogue query. Exp: every TENANT_SCOPED table in sf_tenant_org has relrowsecurity and
  relforcerowsecurity true; sf_app, sf_t001_rt have rolbypassrls false; no table owned by sf_app or any sf_app member.
- **001-03** NEW RLS. Act: read `pg_policies` for sf_tenant_org. Exp: each policy for sf_app has `roles={sf_app}`, both
  `qual` and `with_check` contain `sf_platform.current_tenant_id()` (platform idempotency: `current_actor_id()`); no
  policy `TO public`; no policy whose qual is `true` except the template `outbox_event_publisher` (roles=sf_outbox_publisher).
- **001-04** NEW RLS/UCS. Act: `has_table_privilege`/`has_schema_privilege` for sf_app and PUBLIC. Exp: sf_app holds no
  TRUNCATE (TRUNCATE ignores RLS), TRIGGER or REFERENCES on any table; no CREATE on sf_tenant_org or sf_platform; PUBLIC
  holds nothing on schema, tables or functions; insert-only tables have no UPDATE/DELETE for sf_app.
- **001-05** NEW UCS. Act: catalogue. Exp: zero `prosecdef` functions in sf_tenant_org; zero materialised views; any view
  has `security_invoker=true` (an owner-run view bypasses RLS); every function has `search_path` in `proconfig`.
- **001-06** NEW RLS/UCS. Owner-bypass attempts as sf_t001_rt: `ALTER TABLE sf_tenant_org.office DISABLE ROW LEVEL
  SECURITY`, `... NO FORCE ROW LEVEL SECURITY`, `DROP POLICY`, `ALTER POLICY ... USING (true)`, `SET ROLE <owner>`,
  `SET session_replication_role = replica`, `CREATE FUNCTION sf_tenant_org.f()`, `ALTER TABLE ... OWNER TO sf_app`,
  `GRANT SELECT ... TO PUBLIC`. Exp: every statement fails (42501 / must be owner); row visibility unchanged afterwards.

## B. RLS matrix (sf_t001_rt, real DB)
- **001-07** PLAN RLS/CTL. Tables tenant, tenant_cell_binding, organisation, organisation_version, organisation_relation,
  office, idempotency_record, the maker-checker proposal table (Q3), inbox_event x SELECT/INSERT/UPDATE/DELETE x {own,
  other tenant, unset, `''` on reused session}. Exp: other/unset/'' SELECT 0 rows with no error; INSERT refused
  (42501 RLS); UPDATE/DELETE 0 rows or 42501; insert-only tables UPDATE/DELETE 42501 even for own tenant. Matrix written
  to rls-negative-matrix.md generated from the run (no hand-edited cells).
- **001-08** NEW RLS/CTL. Pre: T1 context, own office row. Act: `UPDATE office SET tenant_id=T2`, `UPDATE tenant SET
  tenant_id=T2`, `INSERT ... SELECT` copying a T1 row with tenant_id T2. Exp: refused (WITH CHECK or column privilege);
  T2 sees nothing new.
- **001-09** NEW CTL. Security-barrier ordering: as rt under T1 `CREATE FUNCTION pg_temp.leak(t text) RETURNS bool
  LANGUAGE plpgsql AS 'BEGIN RAISE NOTICE ''%'', t; RETURN true; END'`; run `SELECT * FROM organisation_version WHERE
  pg_temp.leak(name)` and `WHERE 1/(CASE WHEN name LIKE 'CANARY-T2%' THEN 0 ELSE 1 END)=1`. Exp: notices contain only T1
  values; no division-by-zero error (RLS quals evaluated before non-leakproof user quals).
- **001-10** NEW CTL. Pre: owner runs ANALYZE. Act: rt `SELECT * FROM pg_stats WHERE schemaname='sf_tenant_org'`. Exp: no
  row for RLS tables, no T2 canary in most_common_vals/histogram_bounds.
- **001-11** NEW CTL. FK oracle. Act: catalogue: every FK on a TENANT_SCOPED table includes tenant_id in conkey/confkey.
  API: office for a T2 organisation id, organisation with T2 parent_id, version for T2 organisation. Exp: response
  byte-identical (except correlation_id) to the same call with a random uuid (404 SF-SYS-002); no row, no event.
- **001-12** NEW CTL. Unique-constraint oracle. Act: under T1 create organisation and office with codes already used in T2.
  Exp: succeeds (uniqueness scoped by tenant_id); the only global unique (`tenant.code`) is reachable only on the privileged
  path and its 409 body names no tenant id or display name.

## C. Pooled session and context injection
- **001-13** PLAN RLS. Same backend: T1 tx, then tx with no context, then T2 tx. Exp: 0 rows without error, then T2 only.
- **001-14** NEW RLS/CTL. Same backend: T1 tx fails after set_config (forced constraint error), client released; next
  request has no context, then T2. Exp: `current_setting('app.tenant_id', true)` is '' or NULL, no T1 row visible.
- **001-15** NEW RLS. Static + runtime: no `set_config(..., false)`, no `SET app.` without LOCAL, no repository query
  through `pool.query` outside `withContextTx` (a repository called outside it throws before SQL).
- **001-16** NEW UCS. Resolver returns tenant_id `x' OR 1=1--`, `11111111-1111-4111-8111-111111111111';RESET ROLE;--`,
  uppercase uuid, nil uuid. Exp: invalid ones 401 SF-AUTH-001/SF-TEN-001 before BEGIN; set_config receives bind params
  only (static check: no string interpolation into set_config or SET).

## D. Forged tenant headers, bodies, identifiers
- **001-17** PLAN CTL. `x-tenant-id` (T2, T1, mixed case) on every route. Exp: 403 SF-TEN-002, no DB call.
- **001-18** NEW CTL. Headers outside the plan's regex: `x-tenant_id`, `x-sf-tenant-code`, `x-forwarded-tenant`,
  `forwarded: for=x;tenant=T2`, `x-org-id`, `x-sf-actor-type: PRIVILEGED_ADMIN`, `x-roles`, `x-sf-assurance: MFA`,
  duplicated `x-tenant-id` (array). Plus property test: 200 random header names containing tenant|org|actor|role|cell with
  T2 values. Exp: whether refused or not, responses, DB rows, outbox envelopes and audit events carry only the ctx tenant
  and actor; authorizer input (spy) unchanged.
- **001-19** PLAN CTL. `tenant_id` in body or query. Exp: 400 SF-SYS-003, never used.
- **001-20** NEW CTL/UCS. Bodies `{"__proto__":{"tenant_id":T2}}`, `{"constructor":{"prototype":{"tenant_id":T2}}}`,
  key `"tenant_id"`, duplicate JSON keys, `parent_id` as array/object. Exp: 400; `({}).tenant_id === undefined` after.
- **001-21** NEW CTL/UCS. SQL injection through identifiers: `GET /tenants/T1'%20OR%201=1--`, `/organisations?as_of=
  2026-01-01';DROP SCHEMA sf_tenant_org;--`, `parent_id=../`, `status=ACTIVE' OR '1'='1`, `limit=-1|0|201|1e9`. Exp: 400;
  schema intact; no SQL text in body.
- **001-22** NEW CTL. Cursor tampering: replay a T2 cursor under T1; decode and edit cursor to point at a T2 org; random
  base64. Exp: 400 or T1-only page; cursor carries no trusted tenant id (MAC or opaque).
- **001-23** PLAN CTL. GET /tenants/{T2} 403 SF-TEN-002 before DB read, no T2 data; list routes never return T2 rows.
- **001-24** PLAN UCS. No/invalid context 401 SF-AUTH-001; null tenant on tenant route 401 SF-TEN-001.

## E. Authorization, privileged path, maker-checker
- **001-25** PLAN UCS. Authz deny 403 SF-AUTH-002 + DENIED audit; authorizer throws or times out: 503 SF-SYS-004, no write.
- **001-26** NEW UCS. Authorizer returns `{allow:"true"}`, missing reason_code, extra field, `allow:true` without
  policy_revision. Exp: deny, no write. Spy: every AuthzDecisionInput has resource.tenant_id = ctx tenant (or the
  authorised target on admin routes) and validates against SF-CON-AUTHZ-DECISION (X-11).
- **001-27** NEW UCS. During the authorizer and resolver calls no DB transaction is open for the request (pg_stat_activity
  shows no `idle in transaction` for the app's application_name).
- **001-28** PLAN UCS. Tenant OFFICER on /admin/* 403 + DENIED audit; PRIVILEGED_ADMIN without MFA 403; missing reason
  400; fault after audit insert rolls back tenant, binding, event and audit together.
- **001-29** NEW UCS (ruling Q3). Proposal by admin A then approval by A: 403; approval by B without MFA: 403; concurrent
  approvals by B and C: exactly one binding row and one TenantPlacementChanged; approve a superseded proposal: conflict;
  proposal and approval each write a PRIVILEGED audit with reason; proposal rows are insert-only for sf_app.
- **001-30** NEW CTL/UCS. Admin target tenant: target comes only from the route/proposal and is authorised with
  resource.tenant_id = target before BEGIN; unauthorised target: 403 and set_config never called with it (spy on SQL);
  PRIVILEGED_ADMIN with null ctx tenant calling GET /organisations: 401 SF-TEN-001, no rows.
- **001-31** NEW UCS. Two concurrent POST /admin/tenants with the same code and different keys: one tenant, one 409, no
  orphan binding, event or audit row.

## F. Idempotency, hierarchy, races
- **001-32** PLAN FCC. Same key + same body x2: 1 row, 1 event, same response; different body 409 SF-APP-002; 10 parallel
  identical: 1 row; missing/malformed key 400.
- **001-33** NEW CTL. Principal P2 (same tenant) reusing P1's key, and P1 under T2 reusing its T1 key: independent
  processing, never P1's/T1's stored body. Platform idempotency: admin B cannot replay admin A's stored response.
- **001-34** PLAN. Self-parent, 2-cycle, N-cycle, future-dated cycle, two concurrent moves forming a cycle: one refused
  (SF-SYS-003 + HIERARCHY_CYCLE); past versions unchanged; as_of returns old tree.
- **001-35** NEW UCS. Depth bomb: 5,000-deep chain and a move under it. Exp: bounded (statement_timeout or depth limit),
  explicit 400/503, lock released, no pool exhaustion.
- **001-36** PLAN. Office activate twice: one OfficeActivated; stale version: conflict.

## G. Outbox, audit and leakage
- **001-37** PLAN FCC. Duplicate event_id refused; invalid envelope throws before insert, tx rolled back; outbox and inbox
  DDL equal to the rendered template.
- **001-38** NEW CTL/FCC. Every emitted envelope: tenant_id = ctx tenant (privileged create: the new tenant), actor = ctx
  actor, cell_id = ctx cell. As rt: INSERT outbox_event with tenant T2 under T1 refused; SELECT/UPDATE/DELETE on
  outbox_event and outbox_event_platform 42501; platform table row with non-null envelope tenant refused by CHECK.
- **001-39** NEW UCS. After the whole suite, rows in outbox_event_platform are exactly the expected list (denied attempts of
  null-tenant callers only); no tenant route writes a platform event.
- **001-40** NEW UCS. Log canary: capture pino output, error bodies, span attributes and metric labels for the full suite.
  Exp: no CANARY value, display name, reason text, Authorization header or bearer fixture appears; logs carry only ids.
- **001-41** NEW UCS. Forced unique, FK, check and RLS (42501) errors map to catalogue codes; body has no SQL, constraint,
  table or schema name, other-tenant id or stack.
- **001-42** PLAN. Migration up, down 2, up; migration_lint clean.
- **001-43** NEW UCS. After down: no residual grants or policies on dropped objects; re-up succeeds; neither file alters
  attributes or memberships of sf_app or sf_outbox_publisher (static check of the SQL).

Totals: 43 cases, 29 NEW, 14 PLAN.
