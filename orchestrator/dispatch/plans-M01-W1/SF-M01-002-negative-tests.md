# SF-M01-002 (CMP-048) mandatory negative, deny and isolation tests

Author: security and tenant isolation verifier (Opus, xhigh), 3 Oct 2026. Written before code (MODEL-ROUTING-QUALITY s9).
Inputs: SF-M01-002-plan.md, envelope, PLAN-REVIEW-M01-W1.md (read: Q1 record revision, Q2 grants pushed to the local OPA
Data API under `sf_runtime`, Q3 grant tenant = subject = resource tenant, Q10 503 on PDP failure), contracts, migrations,
infra/local/docker-compose.yml (OPA runs `--addr=0.0.0.0:8181` with no authentication).
**PLAN** = in builder plan s6 (ids R/P/S/D cited); **NEW** = added by verifier. Gates: CTL cross_tenant_leakage, RLS
rls_required_negative_tests, OPA opa_required_negative_tests, FCC frozen_contract_conformance, UCS unresolved_critical_security.

## H. Harness rules
- H1. DB cases connect as a per-run login role `sf_t002_rt LOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app` through
  its own pool; never as postgres, never `SET ROLE` from a superuser session (X-12). beforeAll asserts rolsuper=false,
  rolbypassrls=false, session_user=current_user, not a member of any sf_security table owner.
- H2. Integration OPA is the real OPA 1.21.1 binary, started by the test with the **same flags as the deployable profile**
  (authentication and authorization enabled, see 002-15). A stub HTTP server is used only for P-series fault cases.
- H3. Every deny test has a paired positive control in the same file so a deny is never vacuous.

## A. Database (sf_security)
- **002-01** NEW RLS/UCS. H1 identity assertions. Exp: true; otherwise the suite fails, not skips.
- **002-02** PLAN D1-D3 RLS/CTL. privileged_access_record, idempotency_record, inbox_event x S/I/U/D x {own, other, unset,
  '' on a reused `max:1` pool backend}. Exp: other/unset/'' 0 rows without error; inserts refused; no DELETE grant.
- **002-03** PLAN D8/D9 RLS. Outbox insert with another tenant refused; sf_app cannot SELECT/UPDATE/DELETE outbox tables;
  inbox wrong tenant invisible; DDL equals rendered template.
- **002-04** NEW RLS/UCS. Catalogue: FORCE RLS on tenant tables; policies `TO sf_app` with current_tenant_id() in qual and
  with_check; no policy TO public; sf_app holds no TRUNCATE/TRIGGER/REFERENCES and no CREATE on sf_security; PUBLIC holds
  nothing; zero `prosecdef` functions (trigger functions included); views (if any) `security_invoker=true`; no matviews.
- **002-05** NEW UCS. Owner-bypass attempts as rt: `ALTER TABLE ... DISABLE TRIGGER <immutability trigger>`, `SET
  session_replication_role=replica`, `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY`, `DROP POLICY`, `SET ROLE <owner>`.
  Exp: all 42501/must-be-owner; immutability still enforced afterwards.
- **002-06** NEW UCS/CTL. Grant minting by raw SQL as rt in T1: INSERT a row with status APPROVED and a forged
  approved_by; INSERT REQUESTED then UPDATE to APPROVED with approved_by = requested_by, = grantee, or != current_actor_id();
  transitions REVOKED->APPROVED, EXPIRED->APPROVED, REJECTED->APPROVED, APPROVED->REQUESTED. Exp: every one refused by a
  trigger/constraint. Then run the grant publisher: a row created by raw SQL never appears in OPA `sf_runtime` data.
- **002-07** PLAN D4-D7. Self-approval refused; expires_at <= starts_at refused; grantee/scope/window immutable;
  security_policy_metadata content immutable; maker == checker refused.
- **002-08** NEW UCS. security_policy_metadata: UPDATE status FAILED->ACTIVE, VALIDATED->ACTIVE with test_report_sha256
  null, second ACTIVE revision for the same bundle_name, SUPERSEDED->ACTIVE. Exp: refused (trigger or partial unique index).
- **002-09** PLAN D10 CTL. With the PEP bypassed (direct repository call under T1 context) T2 rows are still invisible.
- **002-10** NEW UCS. Race: approve and revoke the same grant concurrently (20 iterations). Exp: never APPROVED after
  REVOKED; loser gets a version conflict; OPA data after both = no active grant.

## B. Rego policy (opa test, >= 90% coverage, opa check --strict, opa fmt)
- **002-11** PLAN R1-R14 OPA. All listed deny cases with positive controls.
- **002-12** NEW OPA/CTL. Tenant lookup confusion: subject T1 holds ROLE_A only in `data.sf.tenants[T2]`, resource T1 -> deny;
  subject T1, resource T2, role present in both -> deny TENANT_MISMATCH; tenant ids differing only in hex case -> deny;
  resource.tenant_id null with classification TENANT_SCOPED or classification absent -> deny; classification GLOBAL with a
  write action -> deny unless the catalogue marks the action GLOBAL-writable (none in W1).
- **002-13** NEW OPA. Undefined-safety: for each helper rule run with the input field it reads absent, null, wrong type
  (string vs array), and empty array. Exp: deny every time. Mutation check: deleting the body of tenant, privileged,
  delegation or jurisdiction rule makes at least one test fail (script output in opa-test-results.txt).
- **002-14** NEW OPA/CTL. Break-glass grant misuse: grant for T2 used by a T1 subject on a T1 resource; grant of U1 used by
  U2; grant present in data but expires_at < request_time (revocation push lost); grant whose action scope is a prefix of
  the requested action; grant with approved_by = grantee in data. Exp: deny each. request_time comes only from the server
  clock: a client `Date` or `x-request-time` header does not change environment.request_time (PEP spy).
- **002-15** NEW UCS/CTL. OPA API surface (blocking flaw P-002-1): with the deployable flags, unauthenticated
  `PUT /v1/data/sf_runtime/privileged_grants/...`, `PUT /v1/data/sf/tenants/...`, `PATCH /v1/data`, `PUT /v1/policies/x`,
  `DELETE /v1/data/sf` -> 401/403; the PEP token may only `POST /v1/data/sf/authz/decision`; the grant-publisher token may
  only write under `/v1/data/sf_runtime`; nobody may write policies. Positive control: decision allowed with PEP token.
- **002-16** NEW UCS. Static: no `.json` under policy/opa contains tenant ids, user ids or `sf_runtime`; `opa build` bundle
  roots are exactly `sf`, `system/log`; no Rego file is generated from tenant input; Rego never calls `http.send`.
- **002-17** NEW UCS. OPA-side decision log with console sink captured: user_id, owner_id, delegation ids, justification
  canary and workflow ids absent; decision_id, policy_revision present.

## C. PEP / Fastify plugin
- **002-18** PLAN P1-P11 UCS. As listed (no principal 401 without OPA call, resolver null 401, forged x-tenant-id 403,
  undeclared route fails boot, ECONNREFUSED 503, timeout deny, 500/non-JSON/`{}`/missing fields/`allow:"true"`/extra
  fields deny, circuit open zero calls, invalid input no call, unknown action deny, 1000-decision log canary).
- **002-19** NEW CTL. Local tenant pre-check (fix P-002-4): stub OPA returns `allow:true` for subject T1 / resource T2
  TENANT_SCOPED. Exp: deny TENANT_MISMATCH 403 SF-TEN-002, handler not run, stub not called.
- **002-20** NEW UCS. Response smuggling: valid allow JSON with `content-type: text/html`; `result` as array; two JSON
  documents concatenated; 50 MB body; allow:true arriving 1 ms after timeout; HTTP 200 with `result.allow=true` and
  `policy_revision` mismatching the loaded bundle revision. Exp: deny each; memory bounded (response size cap).
- **002-21** NEW UCS. Redirect/SSRF: stub answers 302/307 to another host. Exp: not followed (`redirect:'error'`), deny.
  SF_OPA_URL with userinfo, non-http scheme or empty: plugin refuses to register.
- **002-22** NEW UCS. 50 concurrent requests while the breaker is half-open: exactly one probe reaches OPA, the rest deny.
- **002-23** NEW UCS. Boot-time coverage: route added in an encapsulated child plugin, via `app.route` after `ready()`
  attempt, auto HEAD route, a route with both sfPublic and sfAuthz, and a 404 handler. Exp: undeclared route fails boot;
  sfPublic+sfAuthz fails boot; sfPublic routes receive no tenant context and no DB settings.
- **002-24** NEW CTL. Forged identity inputs on 100 randomised requests: headers `x-sf-roles`, `x-sf-assurance: MFA`,
  `x-delegation-id`, `x-actor-type`, `X-Tenant-Id`, body `subject`/`roles` fields, query `tenant_id`. Exp: OPA input (spy)
  is identical to the no-forgery request; forged tenant header still 403 SF-TEN-002.
- **002-25** NEW CTL. Context immutability: handler does `request.sfContext.tenant_id=T2`, `roles.push('ADMIN')`,
  `jurisdiction_ids[0]=X`. Exp: throws (deep freeze; Object.freeze is shallow) and the next authorize() uses the original.
- **002-26** NEW UCS. Verifier/resolver throw, hang past timeout, or return a context with extra fields. Exp: 401/503,
  never 500 with stack, never default context.

## D. Secrets and KMS
- **002-27** PLAN S1-S6 UCS. Redaction via JSON/String/template/inspect/pino/thrown error; provider error omits value;
  wrong-tenant AAD fails; tampered iv/tag/ciphertext fails; unknown key fails; rotation beyond maxStale fails closed.
- **002-28** NEW UCS. LocalSecretsProvider path traversal: names `../../etc/passwd`, `/etc/shadow`, `a/../../b`, NUL byte,
  symlink to outside the mount; env names with `=`/lowercase. Exp: refused. LocalSecretsProvider and LocalKms refuse to
  construct when SF_ENVIRONMENT is UAT, PREPROD, PRODUCTION, empty or unset.
- **002-29** NEW UCS/CTL. KMS: envelope key_ref swapped to another key of the same version, context key order changed
  (still decrypts: canonical AAD), extra context key added (fails), T1 ciphertext decrypted with T2 context (fails, error
  without plaintext); 100,000 encryptions produce no repeated IV per key.
- **002-30** NEW UCS. SecretValue through `error.cause`, AggregateError, `structuredClone`, spread `{...s}`,
  `Object.entries`, `Buffer.from(s)`, `console.log`, pino child bindings, `util.format('%o')`. Exp: no canary; reveal after
  dispose throws. Final scan of all captured logs and evidence/SF-M01-002/** for the canary.

## E. Events, audit, leakage
- **002-31** PLAN D11-D14 FCC. OPA deny: no row/outbox change; idempotent command: one record, one event; migration round
  trip; envelopes valid; invalid envelope never inserted.
- **002-32** NEW CTL. Forged-header SecurityIncidentDetected goes to the ctx tenant's outbox (or platform when ctx tenant
  null), never to the tenant named in the header; event data holds no header value.
- **002-33** NEW UCS. request/approve/revoke/post-review each write exactly one AuditEventSubmitted (X-4) in the same tx
  (forced rollback removes both); grant push to OPA happens only after commit and is never attempted for a rolled-back tx.
- **002-34** NEW UCS. Revocation push failure (OPA down at revoke): revoke command reports failure/incident and retries
  until read-back confirms removal; meanwhile 002-14 expiry still denies after expires_at.
- **002-35** NEW UCS. Metric labels and span attributes: no user_id, tenant-specific role data or justification;
  decision log allowlist test with a payload containing every forbidden field.

Totals: 35 cases, 27 NEW, 8 PLAN.
