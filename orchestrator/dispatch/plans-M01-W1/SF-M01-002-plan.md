# SF-M01-002 plan: CMP-048 Security Platform (OPA PEP, secrets/KMS, privileged access)

Builder: serviceform-foundation-builder, route opus (claude-opus-5-5), effort high. Phase: PLAN (no writes
except this file). Worktree /var/tmp/wt-SF-M01-002, base d1d0965. Scope: CMP-048, INT-011.
Sources read: envelope SF-M01-002.yaml, DISPATCH-PLAN-M01-W1 s6, AGENTS.md, Constitution #6/7/11/21/24,
MODEL-ROUTING-QUALITY, contracts/shared (authz-decision, request-context, event-envelope, audit-event,
outbox.template.sql, error-catalogue), 1759490000000 migration, migration_lint.py, check_scope.py,
hardcoding_gate.py, .dependency-cruiser.cjs, Eng v1.4 CMP-048, AWS v1.7 s20.3-20.6/20.12/20.15/20.16,
TI v1.0 s9, s16, TI-010, ARCHITECTURE-VERIFICATION-001 M-03.

## 1. Impact plan (AGENTS.md loop step 2)

| Area | Impact |
|---|---|
| Domain | CMP-048 owns policy enforcement integration (PEP + governed OPA bundle), secrets/KMS abstraction, privileged access records, security policy revision metadata. Not owned: statutory rules (GoRules/CMP-008), tenant RLS boundary (stays in PostgreSQL), identity/tokens (CMP-004, M02), tenant/role/delegation master data (Access Designer/Studio, see Q4). |
| Data | New schema `sf_security`: `privileged_access_record` (TENANT_SCOPED), `security_policy_metadata` (PLATFORM_OPERATIONAL), `idempotency_record` (TENANT_SCOPED, SF-CON-IDEMPOTENCY fields), outbox/inbox x4 copied verbatim from template. |
| APIs | Eng v1.4 lists only "Internal security/policy interfaces". Exposed as TypeScript module APIs: `packages/security` (plugin, PEP, secrets, KMS ports) and service command handlers (request/approve/revoke/review privileged access; register/activate/fail policy revision; report incident). No public HTTP routes; apps/api is read-only so nothing is mounted (Q6). |
| Events | Emits SecurityPolicyPublished (platform, tenant_id null -> `outbox_event_platform`) and SecurityIncidentDetected (tenant -> `outbox_event`, platform -> `outbox_event_platform`). Envelopes validated with `validate('event-envelope', ...)` plus component data schemas before INSERT. Handles none in M01. |
| Tenancy/authz | Request context built only from verified principal + server resolver; client tenant/role headers never read. PEP deny-by-default and fail-closed. RLS via `sf_platform.current_tenant_id()`; session settings via `dbSessionSettings()` + `set_config(...,true)` inside the transaction; runtime role `sf_app` (NOBYPASSRLS). |
| Migration | One additive file `db/migrations/1759500480000_cmp-048-security-platform.sql` (after 1759490000000, passes `--check-order`); down section drops only `sf_security`. |
| Tests | Rego unit tests (`opa test`), unit/contract/failure-path in vitest, service integration suite on PG16 + real local OPA 1.21.1 binary (`OPA_BIN`, default resolved from PATH; never skipped when missing, test fails). Deny matrix s6. |
| Observability | OTel span `sf.authz.decide` with attrs decision_id, policy_revision, reason_code, allow; metrics `sf_authz_decisions_total{allow,reason_code}`, `sf_authz_decision_duration_ms` histogram, `sf_pdp_failures_total{kind}`, `sf_pdp_circuit_open` gauge; redacted decision log (s2.5); OPA-side `system.log.mask`. Uses `@opentelemetry/api` + `@serviceform/observability` logger. |
| Rollback | Revert branch commit; `pnpm db:migrate:down` drops `sf_security` (no other component depends on it in M01). packages/security has no consumers yet. policy/opa additions are inert for other services (local OPA loads them; deny-by-default for unknown inputs). No data migration. |

## 2. packages/security design (`@serviceform/security`)

2.1 Ports (src/principal.ts)
- `VerifiedPrincipal { subject_id: Uuid; actor_type: ActorType; assurance: AuthAssurance; client_id?: string; purpose?: string }`
  produced by an injected `PrincipalVerifier.verify(request): Promise<VerifiedPrincipal | null>` (CMP-004 implements
  later; this task issues/validates no tokens; tests use a stub).
- `ContextResolver.resolve(principal, { cellId }): Promise<Omit<RequestContext,'correlation_id'|'trace_id'> | null>`
  supplies tenant_id, roles, jurisdiction_ids, organisation/office, delegation_id from server-side membership
  (CMP-002/CMP-004 later). No default implementation: plugin registration throws if either port is absent.

2.2 Fastify plugin `sfSecurity` (fastify-plugin, name `sf-security`), options `{ verifier, resolver, pdp, cellId, logger, audit }`
- onRoute: every route must declare `config.sfAuthz = { action, resource(req) }` or `config.sfPublic = true`;
  otherwise registration throws (deny by default at boot, not at runtime).
- onRequest: (a) any client tenant/actor override header (`x-tenant-id`, `x-sf-tenant`, `x-sf-roles`, ...; list in code)
  -> 403 SF-TEN-002, counter + SecurityIncident hook; (b) verify principal, none -> 401 SF-AUTH-001 (public routes
  continue with no context); (c) resolve context, add correlation_id = request.id and trace_id from active span,
  `validate('request-context')`; failure -> 401 SF-TEN-001; (d) `request.sfContext = Object.freeze(ctx)`.
- preHandler for `sfAuthz` routes: `request.authorize(action, resource, workflow_context?)`.
- `authorize()` builds `AuthzDecisionInput` only from `sfContext` (subject) + caller resource; `environment` =
  `{ request_time: server clock, trace_id, client_id }`; validates input against `authz-decision-input`; invalid ->
  deny `INPUT_INVALID` without calling OPA. Resource tenant mismatch is not pre-filtered in TS (OPA decides; RLS
  still enforces).
- Enforcement: allow -> continue; deny -> 403 SF-AUTH-002 (`TENANT_MISMATCH` -> SF-TEN-002); PEP-synthesised
  PDP failure -> 503 SF-SYS-004 (Q10). Handler never runs on deny.

2.3 PEP client `OpaPdpClient` (src/pep/pdp-client.ts)
- `POST {opaUrl}/v1/data/sf/authz/decision` body `{input}` via Node 22 global fetch (no new dep), `AbortSignal.timeout(timeoutMs)`.
  Config: `opaUrl` (env `SF_OPA_URL`, no default host in code), `timeoutMs` default 100, no retry (a retry doubles
  tail latency of a fail-closed path), circuit breaker: open after N=5 consecutive failures for 5 s, half-open 1 probe.
- Result handling: OPA returns `result` = `{allow, reason_code, policy_revision}`; PEP adds `decision_id = randomUUID()`
  and validates with `authz-decision-output`. Any of: network error, timeout, non-200, non-JSON, `result` undefined
  (missing policy/package), extra/missing fields, `allow !== true` literal -> deny with reason
  `PDP_UNAVAILABLE | PDP_TIMEOUT | PDP_ERROR | POLICY_UNDEFINED | PDP_INVALID_RESPONSE`, `policy_revision = "none"`.
  Only `allow === true` from a schema-valid result allows. OPA's own decision_id header/field, if present, is logged
  alongside ours.
- `PdpClient` interface so a future in-process/Wasm PDP can be swapped without changing PEPs.

2.4 Fail-closed semantics: all protected actions fail closed. The only bypass is a route declared `sfPublic`
(s20.6 "explicitly designed public/read-only paths"), which makes no OPA call and gets no tenant context.

2.5 Decision-log redaction (src/pep/decision-log.ts): allowlist, not denylist. Logged: decision_id, opa_decision_id,
trace_id, correlation_id, policy_revision, path `sf/authz/decision`, allow, reason_code, latency_ms, action,
resource_type, resource.tenant_id, classification, subject.actor_type, roles, assurance, delegation present (bool).
Never logged: user_id, owner_id, application/task ids, workflow ids, client payloads, headers. Then passed through
`redactDeep` as defence in depth. OPA-side: `system.log.mask` removes the same fields before any decision-log export.

2.6 Secrets/KMS: see s5. 2.7 `AuditSink` port (`emit(AuditEvent)`), validated against SF-CON-AUDIT-EVENT; CMP-031
client is a parallel task, so tests use a contract-validated in-memory double (same pattern as SF-M01-001) (Q7).

## 3. OPA bundle (policy/opa), governed common policy + tenant data, no per-tenant Rego (s20.4, s20.17)

```
policy/opa/README.md                  (modify: layout, data shapes, how to test/build)
policy/opa/.manifest                  {"revision": "<set by opa build --revision>", "roots": ["sf", "system/log"]}
policy/opa/sf/meta/data.json          {"policy_revision": "..."}  (equality with .manifest revision checked in test)
policy/opa/sf/common/data.json        governed catalogue: actions + action_class (PROTECTED/READ_ONLY/PRIVILEGED),
                                      resource types, jurisdiction scope modes, reason codes. No tenant data.
policy/opa/sf/authz/decision.rego     package sf.authz; `decision` object, default allow := false, first-failing reason
policy/opa/sf/authz/{tenant,role,jurisdiction,delegation,privileged,workflow}.rego   helper rules, same package
policy/opa/sf/authz/*_test.rego       one test file per rule file + fixtures_test.rego (synthetic data)
policy/opa/system/log/mask.rego       decision-log masking; mask_test.rego
```
- Tenant data is never committed. Runtime shape `data.sf.tenants[tenant_id] = { roles{code:{actions,resource_types,
  jurisdiction_scope, organisation_ids|office_ids, service_ids|all_services}}, jurisdiction_ancestors{id:[ids]},
  delegations{id:{delegator_user_id, delegate_user_id, actions, scope, starts_at, ends_at, status, approval_required,
  approved_by}} }` (JSON Schema in services/cmp-048-security-platform/contracts/, not under policy/opa because OPA
  loads every .json there as data). Delivered in bundle-mode by the publishing path (later); in tests via
  `with data.sf.tenants as fixture` (Rego) or Data API PUT to a directory-mode server (integration).
- Break-glass/support grants: `data.sf_runtime.privileged_grants[tenant_id][grantee_user_id]` outside bundle roots
  (Q2). Fixtures live inside `*_test.rego` so `opa run /policy` (compose, directory mode) never loads synthetic data.
- Rule order (TI s9): input present -> action in catalogue -> tenant match (subject.tenant_id == resource.tenant_id,
  both non-null unless classification GLOBAL/PLATFORM_OPERATIONAL) -> tenant data present -> role permits
  action+resource_type -> organisation/office -> service scope -> jurisdiction coverage (ASSIGNED_ONLY/DESCENDANTS/
  TENANT_WIDE/EXPLICIT_LIST via precomputed ancestors) -> delegation valid at `environment.request_time` -> workflow
  consistency (workflow_context.required_action == action, required_role in roles) -> privileged gate (PRIVILEGED_ADMIN
  or PRIVILEGED action class needs active approved grant, approver != grantee, assurance MFA, window contains
  request_time, action/resource in grant scope, grant tenant == resource tenant). Time comes only from
  `environment.request_time`; missing -> deny when a time-dependent rule applies.
- Rego test plan: `opa check --strict policy/opa`, `opa fmt --fail --list policy/opa`, `opa test -v --coverage
  policy/opa` with >= 90% coverage, `opa build -b policy/opa --revision <sha>` succeeds. Every deny case in s6 R-series
  has a test plus a positive control so denies are not vacuous. Output -> evidence/SF-M01-002/opa-test-results.txt.
- No statutory content: only role/scope/delegation/tenant facts. Synthetic codes (ROLE_A, JUR_ROOT...), no State names.

## 4. Tables and migration `db/migrations/1759500480000_cmp-048-security-platform.sql`

- `CREATE SCHEMA sf_security` (`COMMENT 'isolation_class=...; owner=CMP-048'`), `GRANT USAGE ... TO sf_app`.
- `-- sf:isolation sf_security.privileged_access_record TENANT_SCOPED owner=CMP-048`
  id uuid PK, tenant_id uuid NOT NULL, grantee_user_id uuid, grantee_actor_type text, access_kind
  (SUPPORT_CASE|BREAK_GLASS), purpose_code, justification text (<=1000, never logged/evented), support_ticket_ref,
  scope_actions text[], scope_resource_types text[], requested_by, requested_at, approved_by, approved_at, status
  (REQUESTED|APPROVED|REJECTED|REVOKED|EXPIRED), starts_at, expires_at, revoked_by/at, post_review_by/at/outcome,
  version bigint, created_at. CHECKs: expires_at > starts_at; approved_by <> grantee_user_id; status/approval
  consistency. Max duration enforced by command config, not SQL constant. ENABLE + FORCE RLS; policy for sf_app
  USING/WITH CHECK `tenant_id = sf_platform.current_tenant_id()`; GRANT SELECT, INSERT, UPDATE(status, approved_*,
  revoked_*, post_review_*, version); no DELETE. Trigger refusing changes to scope/grantee/window columns.
  Expiry is enforced at decision time (Rego window + `expires_at > now()` in reads); no cross-tenant sweeper (TI-010).
- `-- sf:isolation sf_security.security_policy_metadata PLATFORM_OPERATIONAL owner=CMP-048` (no tenant_id, no RLS per
  lint; governed common bundle revisions are not tenant-owned; Q5). id, bundle_name, revision, content_sha256,
  roots text[], status (VALIDATED|ACTIVE|FAILED|SUPERSEDED), published_by, approved_by (CHECK <>, maker-checker
  s20.6), test_report_sha256, signing_key_ref (reference only), created_at, activated_at, failure_code.
  UNIQUE(bundle_name, revision). Trigger: content columns immutable after insert. GRANT SELECT, INSERT, UPDATE(status,
  activated_at, failure_code) TO sf_app.
- `-- sf:isolation sf_security.idempotency_record TENANT_SCOPED owner=CMP-048` (fields of SF-CON-IDEMPOTENCY,
  PK tenant_id+principal_id+endpoint+idempotency_key), FORCE RLS, same policy form.
- Outbox: template copied byte-for-byte with `{schema}`=sf_security, `{cmp}`=CMP-048 (outbox_event,
  outbox_event_platform, inbox_event, inbox_event_platform). A unit test diffs the migration block against the template.
- Down: DROP of the above and the schema (down section; lint checks only up).

## 5. Secrets/KMS adapter (packages/security/src/secrets, src/kms)

- `SecretRef { provider: string; name: string; version?: string }` (external reference, Constitution #34).
- `SecretValue`: holds bytes privately; `toString`, `toJSON`, `util.inspect.custom`, `Symbol.toPrimitive` return
  `[REDACTED]`; only `reveal(): Uint8Array|string` exposes; `dispose()` zero-fills.
- `SecretsProvider { get(ref): Promise<SecretValue> }`. Errors (`SecretUnavailableError`) carry ref name only.
  Cache with TTL + last-good on rotation failure up to `maxStaleMs`, then fail closed (Eng "Secret rotation failure").
- `LocalSecretsProvider`: reads `SF_SECRET_<NAME>` env vars or a mounted directory path from config (files never
  committed; gitleaks-clean: test keys generated at runtime).
- `KmsProvider { encrypt(keyRef, plaintext, context: Record<string,string>), decrypt(envelope, context),
  sign(keyRef, data), verify(keyRef, data, sig) }`; `context` must include tenant_id when data is tenant-owned (AAD).
- `LocalKms`: node:crypto AES-256-GCM with per-call DEK wrapped by a key-version from LocalSecretsProvider;
  envelope `{key_ref, key_version, iv, tag, wrapped_dek, ciphertext}`; Ed25519 sign/verify (future bundle signing).
  Key versions allow rotation (decrypt old, encrypt newest). AWS Secrets Manager/KMS adapters are out of scope (Q12).

## 6. Negative / deny test list (security verifier may extend before code)

Rego (opa test): R1 empty/absent input -> INPUT_MISSING. R2 unknown action -> UNKNOWN_ACTION. R3 role lacks
action -> ROLE_NOT_PERMITTED; no roles; role permits action but not resource_type. R4 wrong tenant -> TENANT_MISMATCH;
subject tenant null vs tenant resource; resource tenant null with TENANT_SCOPED classification. R5 tenant data absent
-> POLICY_DATA_MISSING. R6 jurisdiction outside assignment; child under ASSIGNED_ONLY; sibling under DESCENDANTS;
resource with no jurisdiction when role is jurisdiction-scoped. R7 organisation/office mismatch. R8 service out of
scope. R9 delegation: unknown id, delegate != subject, ends_at <= request_time (expired), not started, REVOKED,
approval required but unapproved, action not delegated, delegator lacks the action (exceeds authority). R10
request_time missing on time-dependent rule. R11 break-glass: no grant; REQUESTED (unapproved); self-approved; expired;
other tenant's grant; assurance != MFA; action outside grant scope; PRIVILEGED_ADMIN with null subject tenant. R12
workflow_context required_action/role mismatch. R13 output always has allow/reason_code/policy_revision, allow false
by default. R14 mask removes user_id/owner_id/application_id/task_id/workflow ids. Positive control per group.

PEP/plugin (vitest, stub OPA HTTP server): P1 no principal -> 401, OPA not called. P2 resolver null/invalid context
-> 401 SF-TEN-001. P3 forged `x-tenant-id` -> 403 and context unchanged. P4 route without sfAuthz/sfPublic -> boot
fails. P5 OPA down (ECONNREFUSED) -> 503, handler not run. P6 OPA slower than timeout -> deny PDP_TIMEOUT. P7 OPA 500,
non-JSON, `{}` (undefined result = missing policy), missing fields, `allow:"true"`, extra fields -> deny. P8 circuit
open -> deny with zero calls. P9 input failing contract (lowercase action, bad uuid) -> deny, no call. P10 unknown
action through real OPA -> deny. P11 decision log for 1000 decisions with sentinel PII/secret values contains none.
Fault-injection log -> evidence/SF-M01-002/fail-closed.log.

Secrets/KMS: S1 SecretValue via JSON.stringify, String(), template literal, util.inspect, pino logger, thrown error
-> no sentinel. S2 provider failure message omits value. S3 decrypt with other tenant_id context fails. S4 tampered
iv/tag/ciphertext fails. S5 unknown key ref/version fails closed. S6 rotation failure beyond maxStale fails closed.

DB / integration (PG16 as sf_app, real OPA): D1 privileged_access_record wrong-tenant SELECT/INSERT/UPDATE -> 0 rows or
refused; D2 unset tenant -> 0 rows; D3 DELETE refused; D4 self-approval refused; D5 bad window refused; D6 scope/window
immutable; D7 security_policy_metadata content immutable, maker==checker refused; D8 outbox insert with other tenant
refused, sf_app cannot SELECT outbox; D9 inbox wrong tenant; D10 RLS blocks cross-tenant rows with PEP bypassed
(s20.16); D11 OPA deny -> no row/outbox change; D12 repeated idempotency key -> one record, one event; D13 migration
up/down/up round trip; D14 both events validate against SF-CON-EVENT-ENVELOPE and data schemas; invalid envelope
never inserted. L1 p99 latency of 5000 local decisions recorded (evidence only). Summary -> deny-matrix.md.

## 7. Files to create/modify (each checked against allowed_write_paths)

packages/security/** (allowed `packages/security/**`):
package.json, tsconfig.json, src/index.ts, src/principal.ts, src/plugin.ts, src/errors.ts, src/audit-sink.ts,
src/pep/pdp-client.ts, src/pep/circuit-breaker.ts, src/pep/authorize.ts, src/pep/decision-log.ts,
src/secrets/secret-value.ts, src/secrets/secrets-provider.ts, src/secrets/local-secrets-provider.ts,
src/kms/kms-provider.ts, src/kms/local-kms.ts,
test/plugin.test.ts, test/deny-by-default.test.ts, test/pdp-client.fault.test.ts, test/circuit-breaker.test.ts,
test/decision-log-redaction.test.ts, test/secret-value.test.ts, test/local-secrets-provider.test.ts,
test/local-kms.test.ts, test/contract-conformance.test.ts, test/helpers/stub-opa.ts, test/helpers/fakes.ts

services/cmp-048-security-platform/** (allowed `services/cmp-048-security-platform/**`):
package.json, tsconfig.json, vitest.integration.config.ts,
contracts/events/security-policy-published.v1.schema.json, contracts/events/security-incident-detected.v1.schema.json,
contracts/tenant-policy-data.schema.json, contracts/privileged-grant-data.schema.json,
src/index.ts, src/db/tx.ts, src/events/envelopes.ts, src/events/outbox-writer.ts, src/idempotency.ts,
src/privileged-access/model.ts, src/privileged-access/repository.ts, src/privileged-access/commands.ts,
src/privileged-access/grant-publisher.ts, src/policy-metadata/repository.ts, src/policy-metadata/commands.ts,
src/incidents.ts, scripts/opa-test.sh,
test/events.test.ts, test/commands.test.ts, test/outbox-template.test.ts,
test/integration/helpers.ts, test/integration/rls-negative.int.test.ts, test/integration/privileged-access.int.test.ts,
test/integration/policy-metadata.int.test.ts, test/integration/outbox-events.int.test.ts,
test/integration/migration-roundtrip.int.test.ts, test/integration/pep-opa.int.test.ts,
test/integration/opa-bundle.int.test.ts, test/integration/decision-latency.int.test.ts

policy/opa/** (allowed `policy/opa/**`): README.md (modify), .manifest, sf/meta/data.json, sf/common/data.json,
sf/authz/{decision,tenant,role,jurisdiction,delegation,privileged,workflow}.rego,
sf/authz/{decision,tenant,role,jurisdiction,delegation,privileged,workflow,fixtures}_test.rego,
system/log/mask.rego, system/log/mask_test.rego

db/migrations/1759500480000_cmp-048-security-platform.sql (matches `db/migrations/*_cmp-048-*.sql`).
pnpm-lock.yaml: only via `pnpm install` (allowed).
Implicitly allowed by check_scope.py: evidence/SF-M01-002/** (opa-test-results.txt, fail-closed.log, deny-matrix.md,
decision-latency.json, EVIDENCE.md, junit/*.xml, coverage-summary.json, scope-check.log, gates.log) and
orchestrator/handovers/SF-M01-002.yaml. Nothing under contracts/**, apps/**, db/test/**, .github/**, root configs.
Root vitest config already includes packages/*/test and services/*/test; tsconfig.depcruise covers packages/services/src.

## 8. Third-party dependencies

None new. Reused, already in pnpm-lock.yaml at these exact versions: fastify 5.12.5 (peer + dev, types), fastify-plugin
5.1.0, pg 8.23.1, @types/pg 8.23.1, @opentelemetry/api 1.9.1, ajv via @serviceform/contracts (workspace),
pino via @serviceform/observability (workspace). HTTP to OPA uses Node 22 built-in fetch. OPA 1.21.1 is an external
binary (matches infra/local compose), not an npm dependency. Lockfile changes are importer entries only.

## 9. Open questions and foreseen stop conditions

Q1 (M-03 / proposed ADR-0005) Pinned vs effective-latest authorization policy. The design does not choose: PEP
evaluates the active bundle and records `policy_revision` per decision; security_policy_metadata keeps immutable
revisions so either outcome remains possible. A pinned model would need a requested-revision input field in
SF-CON-AUTHZ-DECISION (Contract Change Request) and multi-revision loading. Confirm M01 may proceed without choosing;
if not, STOP (envelope stop condition).
Q2 Break-glass grant distribution. The frozen input has no grant field; s20.4 models break_glass_grant as policy
data. Proposal: CMP-048 pushes approved grants after commit to the local OPA Data API under root `sf_runtime`
(outside bundle roots); revocation latency = push latency; Rego time window caps exposure. Alternative: deliver via
signed bundle only. Security-boundary decision: needs guardian/security verifier approval.
Q3 Privileged cross-tenant context. Who sets request-context tenant_id for a PRIVILEGED_ADMIN acting under a grant
(CMP-004/CMP-002, M02)? This plan requires subject.tenant_id == resource.tenant_id == grant tenant; never a null-tenant
wildcard, never an RLS bypass. Confirm.
Q4 Ownership of s20.12 entities (role_definition, role_permission, delegation_grant, tenant_policy_binding,
authorization_decision_audit) is not assigned to CMP-048 in Eng v1.4. Plan defines only the OPA data document shape
and synthetic fixtures; decision records go to the redacted log only. Who owns them, and in which module?
Q5 security_policy_metadata isolation class: PLATFORM_OPERATIONAL for governed bundle revisions. Is a TENANT_SCOPED
record of tenant policy-data versions also required in CMP-048 now (the envelope says "RLS where tenant-scoped")?
Q6 Component-owned contracts (event data schemas, tenant-data schema) are drafted under services/cmp-048/contracts
because contracts/** is read-only; guardian to freeze/relocate. Topic names (`security.policy`, `security.incident`)
need CMP-038 registry confirmation. Whether any internal HTTP route is required in M01 (none planned).
Q7 Audit of privileged actions goes through an AuditSink port with a contract-validated double; CMP-031 wiring later.
Q8 Bundle signing, bundle server and activation monitoring are deferred (no bundle service locally; signing keys
would come through KmsProvider). Acceptable for M01?
Q9 CI (.github, read-only) runs neither `opa test` nor service integration suites; orchestrator must add them.
Q10 HTTP mapping of PDP failure: proposed 503 SF-SYS-004 (decision still allow=false) vs 403 SF-AUTH-002.
Q11 Migration timestamp 1759500480000 must stay ordered against other wave-1 migrations under `--check-order`.
Q12 AWS Secrets Manager/KMS adapters would add @aws-sdk dependencies; deferred.

Foreseen stops: any need to change contracts/shared (CCR); Rego needing statutory facts; a tenant-boundary change from
Q2/Q3; needing CMP-002/004/031/038 code; any write outside s7; hard-gate failure (BLOCKED_CRITICAL_GATE).
Not self-certified: evidence and recommended gate status only.
