# SF-M01-002 implementation plan: CMP-048 Security Platform

| Field | Value |
|---|---|
| Task | SF-M01-002 |
| Module | M01 |
| Component | CMP-048 Security Platform |
| Integration | INT-011 (tenant isolation chain; this task owns the OPA/PEP + privileged-access layer) |
| Phase | **PLAN ONLY** — no implementation in this PR |
| Branch | `agent/M01-cmp-048-security-platform-SF-M01-002` |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` |
| Builder | serviceform-foundation-builder |
| Model / effort | claude-opus-5-5, high (as routed; this plan records the assigned route) |
| Verifiers (later) | serviceform-security-verifier (opus, xhigh); serviceform-evidence-verifier (opus, high) |
| Gate recommendation | not claimed; PLAN_READY pending orchestrator approval |

Sources read: envelope `orchestrator/tasks/SF-M01-002.yaml` at base (ADR-0006 ACCEPTED), `docs/adr/ADR-0006-per-component-write-roles.md` (Option A + ten MUST conditions), PLAN-REVIEW-M01-W1, SECURITY-PRECHECK-M01-W1, prior dispatch plan `SF-M01-002-plan.md`, verifier `SF-M01-002-negative-tests.md` (002-01..002-35), AGENTS.md, Constitution #6/#7/#11/#21/#23/#24/#28/#34, MODEL-ROUTING-QUALITY s9, frozen contracts listed below, M00 migrations `1759482000000` + `1759490000000`, `outbox.template.sql`, `packages/contracts` (`dbSessionSettings`, validators, error catalogue), `packages/observability` redaction/logger, `policy/opa/README.md` (empty M00 root), `services/README.md`, `db/test` harness (X-12: must **not** copy `SET LOCAL ROLE` from superuser), `migration_lint.py`, `check_scope.py`, `.dependency-cruiser.cjs`, `pnpm-workspace.yaml` (`packages/*`, `services/*` already globbed).

This plan **supersedes** the pre-ADR-0006 dispatch plan wherever it granted DML to `sf_app` or named `sf_security_rw`. Canonical privilege role is **`sf_cmp048_rw`**.

---

## 0. Write-path and freeze limits

Allowed writes (implementation, after approval):

- `services/cmp-048-security-platform/**`
- `packages/security/**`
- `policy/opa/**`
- `db/migrations/*_cmp-048-*.sql`

Implicit via `check_scope.py`: `evidence/SF-M01-002/**`, `orchestrator/handovers/SF-M01-002.yaml`.

**Will not write:** `pnpm-lock.yaml` (read-only; restore if `pnpm install` dirties it; lockfile reconciliation is orchestrator-owned), `contracts/**`, Constitution, other components, `apps/**`, `infra/**`, `db/test/**`, `db/package.json`, root manifests, `scripts/gates/**`, other wave-1 service trees.

Frozen contracts consumed (read-only, no edits): SF-CON-COMMON, SF-CON-REQUEST-CONTEXT, SF-CON-ERROR-RESPONSE, SF-CON-ERROR-CATALOGUE, SF-CON-EVENT-ENVELOPE, SF-CON-IDEMPOTENCY, SF-CON-AUDIT-EVENT, SF-CON-ISOLATION-DECLARATION, SF-CON-DB-SESSION-CONTEXT, SF-CON-OUTBOX, SF-CON-AUTHZ-DECISION.

Identity/tokens (CMP-004) are out of scope. Statutory rules (GoRules/CMP-008) are not encoded in Rego.

---

## 1. Impact plan (AGENTS.md loop step 2)

| Area | Impact |
|---|---|
| Domain | CMP-048 owns PEP + governed OPA bundle, secrets/KMS ports, privileged-access records, security-policy revision metadata, SecurityIncidentDetected. Does not own tenant/org master data (CMP-002), identity (CMP-004), audit ledger (CMP-031), event bus library (CMP-038), statutory eligibility (CMP-008). |
| Data | Schema `sf_security` owned by `sf_migrator` (never by runtime). Tables in §3. Isolation classes declared. TENANT_SCOPED tables ENABLE+FORCE RLS. DML to `sf_cmp048_rw` only (except frozen outbox/inbox grants copied verbatim). |
| APIs | Eng v1.4 “internal security/policy interfaces”. Fastify plugins: `@serviceform/security` (context + PEP) and `services/cmp-048-security-platform` command plugin with `prefix` (PLAN-REVIEW X-10). Nothing registered in `apps/api` (W2 / CMP-036). |
| Events | `SecurityPolicyPublished` → `outbox_event_platform` (`tenant_id` null). `SecurityIncidentDetected` → tenant `outbox_event` or platform table. `AuditEventSubmitted` on `sf.audit.ingest.v1` in the same transaction (PLAN-REVIEW X-4). Envelopes validated against SF-CON-EVENT-ENVELOPE before INSERT. |
| Tenancy / authz | Context from verified principal + server resolver only. Client tenant/role headers refused (403 SF-TEN-002). Deny-by-default, fail-closed. Local TENANT_SCOPED tenant pre-check (P-002-4 / 002-19) before OPA. RLS via `sf_platform.current_tenant_id()`. Session settings: `dbSessionSettings()` + `set_config(..., true)` inside the transaction. Runtime LOGIN: `IN ROLE sf_app, sf_cmp048_rw` only; NOSUPERUSER NOBYPASSRLS; not table owner. |
| Migration | `db/migrations/1759500200000_cmp-048-security-platform.sql` (PLAN-REVIEW band `17595002xxxxx`, after `1759490000000`, `_cmp-048-` infix). Down drops only `sf_security` objects and `sf_cmp048_rw` if unused; does not drop shared `sf_migrator`. |
| Tests | Verifier 002-01..002-35 (mandatory) + ADR-0006 privilege-boundary suite + envelope acceptance. Real LOGIN pools (never `SET ROLE` from superuser). Real OPA 1.21.1 in integration with authentication/authorization flags (P-002-1; **not** by editing `infra/**`). |
| Observability | Span `sf.authz.decide`; metrics `sf_authz_decisions_total`, `sf_authz_decision_duration_ms`, `sf_pdp_failures_total`, `sf_pdp_circuit_open`. Allowlist decision log then `redactDeep`. No PII/secrets/justification in labels. p99 local-decision latency in evidence (not a gate). |
| Rollback | Revert commit; migrate down drops `sf_security`. `packages/security` has no production consumers yet. OPA files are inert unless loaded. No data backfill. |

---

## 2. ADR-0006 Option A (MUST for this task)

Owner-accepted 3 Oct 2026. Frozen contracts unchanged. Constitution #23 enforced at GRANT/REVOKE.

| # | Condition | CMP-048 plan |
|---|---|---|
| 1 | `sf_app` holds **no generic DML** on component-authoritative tables | `GRANT INSERT/UPDATE/DELETE` (and sequence use) on `privileged_access_record`, `security_policy_metadata`, `idempotency_record`, `idempotency_record_platform` go to **`sf_cmp048_rw` only**. No SELECT/INSERT/UPDATE/DELETE on those tables to `sf_app`. RLS policies remain `TO sf_app`. |
| 2 | Privilege role is **NOLOGIN** | `CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;` (INHERIT on the **login** that joins the group; the group itself NOLOGIN). |
| 3 | Runtime LOGIN inherits **only** `sf_app` and own `_rw` | Test/runtime role `sf_cmp048_rt` (name in tests): `LOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp048_rw`. Must **not** be granted `sf_cmp002_rw`, `sf_cmp031_rw`, `sf_cmp037_rw`, `sf_cmp038_rw`. |
| 4 | No SUPERUSER / BYPASSRLS | Asserted on `sf_cmp048_rw`, `sf_app`, and the runtime LOGIN (`rolsuper`/`rolbypassrls` false). Migration never grants BYPASSRLS (`migration_lint` already forbids the token). |
| 5 | Runtime is **not** table/schema owner | `CREATE ROLE sf_migrator … NOLOGIN` if missing (shared deployment identity, not a runtime login). `ALTER SCHEMA sf_security OWNER TO sf_migrator`; all tables/sequences/functions in the schema owned by `sf_migrator`. Runtime login is never a member of `sf_migrator`. |
| 6 | TENANT_SCOPED **FORCE RLS** | `ENABLE` + `FORCE ROW LEVEL SECURITY`; policies use `tenant_id = sf_platform.current_tenant_id()` only (not raw `current_setting('app.tenant_id')`). Grants do not replace RLS. |
| 7 | Cross-component SQL default **DENY** | No GRANT of SELECT/INSERT/UPDATE/DELETE on CMP-048 authoritative tables to any other `sf_cmpNNN_rw` or to a sibling login. No cross-schema FKs or queries. Integration via contracts/events/PEP only. |
| 8 | PUBLIC revoked; no default-privilege leak | `REVOKE ALL ON SCHEMA sf_security FROM PUBLIC`; `REVOKE ALL ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA sf_security FROM PUBLIC`; `ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_security REVOKE ALL ON TABLES, SEQUENCES, FUNCTIONS FROM PUBLIC, sf_app`. |
| 9 | **SF-CON-OUTBOX frozen** | Copy `contracts/shared/sql/outbox.template.sql` **byte-for-byte** after `{schema}`=`sf_security`, `{cmp}`=`CMP-048`. Do **not** retarget outbox/inbox grants to `sf_cmp048_rw`. Residual: any `sf_app` member can INSERT tenant outbox / SELECT+INSERT inbox as the template says. Record in handover; tightening needs a CCR. Unit test diffs the migration block to the rendered template. |
| 10 | Executable privilege-boundary tests | See §6.B. Evidence: `evidence/SF-M01-002/privilege-boundary.log`. Hard gate `component_privilege_boundary` (100%). |

State-machine triggers remain required in **addition** to roles (P-002-2, P-002-6): break-glass status machine and policy-activation machine cannot be bypassed by raw SQL from the CMP-048 runtime login.

### Outbox residual (explicit)

ADR-0006 condition 9 forbids changing template grants. Therefore privilege-boundary tests **do not** require deny of `INSERT` on `sf_security.outbox_event` from a generic `sf_app` login. They **do** require deny of all DML/SELECT on `privileged_access_record`, `security_policy_metadata`, and both idempotency tables from a login that is only `IN ROLE sf_app` (simulating another component).

---

## 3. Schema / table list with isolation classes

Schema: `sf_security` (PLAN-REVIEW X-2). Comment includes owner=CMP-048.

Migration file: `db/migrations/1759500200000_cmp-048-security-platform.sql`.

Every `CREATE TABLE` preceded by `-- sf:isolation <schema.table> <CLASS> owner=CMP-048`.

| Table | Isolation | RLS | Privileges (authoritative) | Notes |
|---|---|---|---|---|
| `privileged_access_record` | TENANT_SCOPED | ENABLE+FORCE; policy `TO sf_app` USING/WITH CHECK `tenant_id = sf_platform.current_tenant_id()` | `sf_cmp048_rw`: SELECT, INSERT, UPDATE(status, approved_*, revoked_*, post_review_*, version). **No DELETE.** | Break-glass / support. CHECKs: `expires_at > starts_at`; `approved_by <> grantee_user_id`; status/approval consistency. Trigger: insert only `REQUESTED` with `requested_by = sf_platform.current_actor_id()`; approve only `REQUESTED→APPROVED` with `approved_by = current_actor_id()` ≠ requested_by ≠ grantee; terminal states final; grantee/scope/window immutable. Max duration in command config, not a SQL constant. Expiry at decision time (Rego + `expires_at`). No cross-tenant sweeper (TI-010). |
| `security_policy_metadata` | PLATFORM_OPERATIONAL | none (lint: not TENANT_SCOPED) | `sf_cmp048_rw`: SELECT, INSERT, UPDATE(status, activated_at, failure_code, approved_by) | Governed bundle revisions. UNIQUE(bundle_name, revision). Partial unique: one ACTIVE per bundle_name. Content columns immutable. Trigger: VALIDATED→ACTIVE only with `approved_by <> published_by` and `test_report_sha256` present; no FAILED/SUPERSEDED→ACTIVE. PLAN-REVIEW Q5: no tenant-scoped policy metadata in W1. |
| `idempotency_record` | TENANT_SCOPED | ENABLE+FORCE; same tenant policy | `sf_cmp048_rw`: SELECT, INSERT, UPDATE(status, response_ref) | SF-CON-IDEMPOTENCY fields; PK `(tenant_id, principal_id, endpoint, idempotency_key)`; `tenant_id uuid NOT NULL` (lint). |
| `idempotency_record_platform` | PLATFORM_OPERATIONAL | none | `sf_cmp048_rw`: SELECT, INSERT, UPDATE(status, response_ref) | Platform commands (policy register/activate) cannot use a TENANT_SCOPED table with NOT NULL `tenant_id`. Same logical fields with `tenant_id` omitted/null-equivalent; PK without tenant. |
| `outbox_event` | TENANT_SCOPED | per template | **template**: INSERT to `sf_app`; publisher grants unchanged | Copied verbatim. |
| `outbox_event_platform` | PLATFORM_OPERATIONAL | per template | template | Copied verbatim. |
| `inbox_event` | TENANT_SCOPED | per template | template SELECT, INSERT to `sf_app` | Copied verbatim. CMP-048 consumes no events in M01; tables exist for contract completeness. |
| `inbox_event_platform` | PLATFORM_OPERATIONAL | per template | template | Copied verbatim. |

`GRANT USAGE ON SCHEMA sf_security TO sf_app, sf_cmp048_rw, sf_outbox_publisher` — USAGE only; table DML as above. Template already grants USAGE to `sf_outbox_publisher`.

Trigger functions: `SECURITY INVOKER`, not `SECURITY DEFINER` (002-04). `REVOKE ALL … FROM PUBLIC`; `GRANT EXECUTE TO sf_cmp048_rw`. No views/matviews in W1.

---

## 4. APIs and events mapped to Eng v1.4

Eng v1.4 CMP-048: policy enforcement integration, secrets/KMS abstraction, privileged access. Interfaces described as internal security/policy interfaces (no public citizen API).

### 4.1 `packages/security` (`@serviceform/security`)

Module APIs (TypeScript; Fastify plugin):

| Symbol | Contract |
|---|---|
| `VerifiedPrincipal` + `PrincipalVerifier` | Injected. CMP-004 later; W1 tests use a stub. **No token issue/validate.** |
| `ContextResolver` | Server-side tenant/roles/jurisdictions/org/office/delegation. No default impl; plugin throws if missing. |
| `sfSecurity` Fastify plugin | `config.sfAuthz = { action, resource(req) }` or `config.sfPublic = true` on every route or **boot fails**. `sfPublic` + `sfAuthz` fails boot. |
| `authorize()` | Builds `AuthzDecisionInput` from frozen `request.sfContext` + caller resource; `environment.request_time` = **server clock only**. Validates input; invalid → deny `INPUT_INVALID`, no OPA. TENANT_SCOPED + subject/resource tenant mismatch → deny `TENANT_MISMATCH` **without** calling OPA (002-19). |
| `OpaPdpClient` | `POST {opaUrl}/v1/data/sf/authz/decision`, Node 22 `fetch`, `redirect:'error'`, response size cap, `AbortSignal.timeout` default 100 ms (X-13). Circuit: 5 failures / 5 s open / one half-open probe. Validates `authz-decision-output`. Only literal `allow === true` allows. Failures → deny `PDP_*` / `POLICY_UNDEFINED`. |
| HTTP mapping | No principal: 401 SF-AUTH-001. Bad/missing context: 401 SF-TEN-001. Cross-tenant / forged header: 403 SF-TEN-002. Authz deny: 403 SF-AUTH-002. PDP failure: **503 SF-SYS-004** + details code (PLAN-REVIEW Q10 / X-8). |
| `SecretsProvider` / `LocalSecretsProvider` | `SecretRef` only (Constitution #34). `SecretValue` redacts `toString`/`toJSON`/`inspect`/`toPrimitive`; `reveal()` only; `dispose()` zero-fills. Refuse UAT/PREPROD/PRODUCTION/empty `SF_ENVIRONMENT`. Path allowlist + realpath containment (002-28). |
| `KmsProvider` / `LocalKms` | AES-256-GCM DEK wrap; AAD includes `tenant_id` when tenant-owned; Ed25519 sign/verify for future bundle signing. AWS SDK adapters **out of scope** (Q12). |
| `AuditSink` | `emit(AuditEvent)` validated vs SF-CON-AUDIT-EVENT. CMP-031 client is a parallel task; W1 uses a contract-valid in-memory double plus the service’s own outbox writer for `AuditEventSubmitted`. |

### 4.2 Service command plugin (not mounted in `apps/api`)

Prefix option, Eng-style paths under `/v1` when a host passes `prefix: '/v1/security'`:

| Command | Path | Authz action (catalogue) | Effect |
|---|---|---|---|
| Request privileged access | `POST /privileged-access` | `PRIVILEGED_ACCESS_REQUEST` | INSERT REQUESTED; audit; no OPA Data API push |
| Approve | `POST /privileged-access/:id/approve` | `PRIVILEGED_ACCESS_APPROVE` | State machine; **after commit** push grant to OPA `sf_runtime` with grant-publisher token only |
| Revoke | `POST /privileged-access/:id/revoke` | `PRIVILEGED_ACCESS_REVOKE` | Terminal; retry Data API delete until read-back; incident on failure (002-34) |
| Post-review | `POST /privileged-access/:id/review` | `PRIVILEGED_ACCESS_REVIEW` | Records review outcome |
| Register policy revision | `POST /policy-revisions` | `SECURITY_POLICY_REGISTER` | INSERT VALIDATED metadata (content hashed; no bundle bytes in DB) |
| Activate | `POST /policy-revisions/:id/activate` | `SECURITY_POLICY_ACTIVATE` | Maker ≠ checker; one ACTIVE; emit `SecurityPolicyPublished` |
| Report incident | `POST /incidents` | `SECURITY_INCIDENT_REPORT` | `SecurityIncidentDetected` |

Idempotency-Key: same key + same fingerprint replays; different fingerprint → 409 SF-APP-002.

### 4.3 Events

| Event type | Topic (X-3) | Outbox table | `data` (component schema under `services/cmp-048-security-platform/contracts/`) |
|---|---|---|---|
| `SecurityPolicyPublished` | `sf.security.events.v1` | platform | bundle_name, revision, content_sha256, activated_at; **no** bundle bytes |
| `SecurityIncidentDetected` | `sf.security.events.v1` | tenant or platform | incident_code, reason_code, decision_id optional; **no** header values, justification, or PII |
| `AuditEventSubmitted` | `sf.audit.ingest.v1` | tenant or platform | `data` = one SF-CON-AUDIT-EVENT object (X-4) |

`services/cmp-048-security-platform/contracts/topics.json` lists topics/types. CMP-038 registers at stitching. Outbox helper lives in this service, marked `// replaced by packages/outbox at stitching` (X-6).

---

## 5. OPA bundle (`policy/opa`)

Layout:

- `README.md` (update M00 stub)
- `.manifest` roots exactly `sf`, `system/log` (plus `system` for authz policy files that are **not** tenant data)
- `sf/meta/data.json` `{ "policy_revision": "..." }`
- `sf/common/data.json` governed catalogue: actions + action_class, resource types, jurisdiction scope modes, reason codes. **No tenant ids.**
- `sf/authz/decision.rego` package `sf.authz`; `default allow := false`
- helpers: tenant, role, jurisdiction, delegation, privileged, workflow
- `*_test.rego` + fixtures in test files only (not loaded by `opa run` directory mode)
- `system/log/mask.rego` (+ tests)
- `system/authz/authz.rego` for OPA `--authorization=basic`: PEP token → POST decision only; grant-publisher token → write `/v1/data/sf_runtime/**` only; nobody writes `/v1/policies`; unauthenticated deny (002-15)

Tenant data **never committed**. Shape `data.sf.tenants[tenant_id]` as previously specified; JSON Schema in `services/cmp-048-security-platform/contracts/`. Runtime grants: `data.sf_runtime.privileged_grants[...]` **outside** bundle roots (PLAN-REVIEW Q2).

Rule order (TI s9): input present → action in catalogue → tenant match → tenant data present → role → org/office → service scope → jurisdiction → delegation window → workflow consistency → privileged gate. Time only from `environment.request_time`.

No `http.send`. No statutory facts. Synthetic ROLE_A / JUR_ROOT only.

`opa check --strict`, `opa fmt --fail`, `opa test -v --coverage` ≥90%, `opa build -b policy/opa --revision <sha>`. Evidence: `opa-test-results.txt`.

**infra/local/docker-compose.yml is read-only.** Envelope stop: do not edit compose. Integration tests spawn OPA 1.21.1 with `--authentication=token --authorization=basic` and the system.authz policy. Tokens from env via SecretsProvider, never committed. Residual: stock compose remains unauthenticated until guardian/orchestrator updates infra.

---

## 6. Negative / deny / privilege-boundary tests

Security verifier file is binding (MODEL-ROUTING-QUALITY s9). Implementation **after** orchestrator plan approval must include **all** of 002-01..002-35 plus ADR-0006 cases below. Every deny has a positive control.

### 6.A Verifier cases (summary)

Harness H1–H3: real LOGIN `sf_t002_rt` **and** CMP-048 runtime `sf_cmp048_rt IN ROLE sf_app, sf_cmp048_rw`; never postgres; never `SET ROLE` from superuser; `session_user = current_user`; not a member of `sf_migrator` / table owner.

- DB/RLS: 002-01..002-10 (including grant-minting trigger, policy activation, race, PEP-bypassed RLS).
- Rego: 002-11..002-17 (R1–R14, tenant confusion, undefined-safety, break-glass misuse, OPA API surface, static bundle, masked decision log).
- PEP: 002-18..002-26 (P1–P11 + smuggling, SSRF/redirect, half-open, boot coverage, forged headers, deep freeze, verifier faults).
- Secrets/KMS: 002-27..002-30.
- Events/audit: 002-31..002-35.

`db/test/rls-harness.int.test.ts` pattern (`SET LOCAL ROLE sf_app` from the migrator connection) is **forbidden** for this suite (SECURITY-PRECHECK X-2).

### 6.B ADR-0006 privilege-boundary suite (new; hard gate)

Connect as `sf_cmp048_rt` unless noted. Log file: `evidence/SF-M01-002/privilege-boundary.log`.

| ID | Act | Expect |
|---|---|---|
| PB-01 | Catalogue: `sf_cmp048_rw` is NOLOGIN, NOSUPERUSER, NOBYPASSRLS | true |
| PB-02 | Runtime: `pg_has_role(session_user,'sf_app')` and `sf_cmp048_rw`; not member of `sf_cmp002_rw`, `sf_cmp031_rw`, `sf_cmp037_rw`, `sf_cmp038_rw`, `sf_migrator` | true |
| PB-03 | `rolsuper`/`rolbypassrls` false for runtime, `sf_app`, `sf_cmp048_rw` | true |
| PB-04 | `pg_class.relowner` of every `sf_security` table/sequence ≠ runtime; owner = `sf_migrator` | true |
| PB-05 | Own authorized DML: INSERT REQUESTED privileged_access_record under T1; SELECT it back | succeeds |
| PB-06 | Wrong tenant SELECT/INSERT/UPDATE on tenant tables (T2 / unset / `''` on reused max:1 backend) | 0 rows or WITH CHECK fail; no leak |
| PB-07 | Login `sf_other_rt IN ROLE sf_app` **only** (peer component): SELECT/INSERT/UPDATE/DELETE on privileged_access_record, security_policy_metadata, both idempotency tables | **42501** |
| PB-08 | Same peer: `SET ROLE sf_cmp048_rw` | fails (not a member) |
| PB-09 | CMP-048 runtime: `SET ROLE sf_cmp002_rw` / `sf_cmp031_rw` / `sf_cmp037_rw` / `sf_cmp038_rw` (roles created NOLOGIN in the **test** harness if absent; **not** granted in our migration) | fails |
| PB-10 | `GRANT sf_cmp031_rw TO sf_cmp048_rt` as runtime | 42501 |
| PB-11 | Peer INSERT into `privileged_access_record` with T1 context | 42501 (not RLS-pass; missing GRANT) |
| PB-12 | PUBLIC: `has_schema_privilege('public', 'sf_security', 'USAGE')` false; no table/sequence/function privileges for PUBLIC | true |
| PB-13 | `sf_app` has no INSERT/UPDATE/DELETE on the four authoritative non-outbox tables (`has_table_privilege`) | true |
| PB-14 | Outbox section equals rendered frozen template (condition 9) | byte match after placeholder substitution |
| PB-15 | Runtime cannot `ALTER TABLE … OWNER`, `DISABLE TRIGGER`, `NO FORCE ROW LEVEL SECURITY`, `DROP POLICY` | 42501 / must-be-owner |

Peer tables of other components may not exist on this branch. PB-07/PB-11 use **our** tables with a peer login; PB-09 creates sibling `_rw` roles in the test database only.

---

## 7. Files to create (post-approval only)

`packages/security/**`: package.json, tsconfig.json, src (plugin, principal, pep, secrets, kms, audit-sink, errors, index), tests listed in the prior dispatch plan plus privilege-boundary unit helpers where applicable.

`services/cmp-048-security-platform/**`: package.json, tsconfig.json, vitest.integration.config.ts, contracts (events, tenant-policy-data, privileged-grant-data, topics.json), src (db/tx, outbox-writer, idempotency, privileged-access, policy-metadata, incidents), scripts/opa-test.sh, unit + integration tests covering §6.

`policy/opa/**`: §5.

`db/migrations/1759500200000_cmp-048-security-platform.sql`.

After implementation (not this PR): `evidence/SF-M01-002/**` including `PLAN.md` copy with rulings, `privilege-boundary.log`, `opa-test-results.txt`, `fail-closed.log`, `deny-matrix.md`, `EVIDENCE.md`, junit, coverage, scope-check, gates; `orchestrator/handovers/SF-M01-002.yaml`.

This plan file is the only implementation-tree write in Phase 1.

---

## 8. Third-party dependencies

**No new third-party libraries.** `packages/security/package.json` and the service package will declare **already-locked** versions:

| Package | Version | Role |
|---|---|---|
| fastify | 5.12.5 | peer/dev (plugin) |
| fastify-plugin | 5.1.0 | plugin wrap |
| pg | 8.23.1 | service DB |
| @types/pg | 8.23.1 | types |
| @opentelemetry/api | 1.9.1 | spans/metrics |
| @serviceform/contracts | workspace:* | frozen validators + `dbSessionSettings` |
| @serviceform/observability | workspace:* | logger + redactDeep |
| @serviceform/security | workspace:* | service → package (allowed; reverse forbidden by depcruise) |

HTTP to OPA: Node 22 `fetch`. Crypto: `node:crypto`. OPA 1.21.1: external binary (compose image / PATH), not npm.

If adding workspace `package.json` files requires a lockfile hash change, **do not commit `pnpm-lock.yaml`**. Stop and request orchestrator lockfile reconciliation (`pnpm install` then frozen-lockfile + tests). Local `pnpm install` dirtiness is restored before commit.

---

## 9. Rollback

1. `git revert` the implementation commit(s) on this branch (orchestrator merges; this agent does not merge).
2. `pnpm db:migrate:down` (one step) drops `sf_security` objects and `sf_cmp048_rw` if no remaining members; leave `sf_migrator` if other components started using it.
3. OPA bundle files removed with the revert; running OPA processes must be restarted by operators.
4. No backfill, no shared-contract change, no `apps/api` unmount needed (never mounted).

---

## 10. Open items, residuals, stop conditions

Resolved by PLAN-REVIEW / envelope (do not re-open unless a CCR is needed):

- Q1: record `policy_revision`; do not choose pin vs latest (ADR-0005 remains owner O-1).
- Q2: post-commit Data API under `sf_runtime`; grant tenant = subject = resource tenant.
- Q4/Q5/Q8/Q12: s20.12 entities, tenant policy metadata, bundle signing/server, AWS KMS — deferred.
- Q10: 503 SF-SYS-004 on PDP failure.
- P-002-1: authenticated OPA from **this task’s test harness**, not `infra/**`.
- P-002-2..7: adopted (triggers, revoke retry, local tenant pre-check, deep freeze, policy activation, local secrets env lock).

Residuals to record in handover (not UCS if tests pass):

- Frozen outbox/inbox grants still target `sf_app` (ADR-0006 #9).
- Compose OPA remains unauthenticated until infra owners change it.
- CI may lack `opa test` / service integration jobs (PLAN-REVIEW X-14); produce local evidence.
- Lockfile not updated in this component PR.
- Multi-pod grant distribution consistency is an M02 gap.
- `sf_migrator` created IF NOT EXISTS from this migration (shared name required by ADR; no LOGIN).

**Stop and report (do not choose):** frozen contract change; statutory rule in Rego; token issuer; pin-vs-latest required as a product choice; write outside allowed paths; unmerged sibling code needed; ADR-0006 condition 1–10 violated; lockfile must be committed; compose file must be edited; hard-gate failure.

Not self-certified. After implementation, recommend GATE_READY only with executed evidence for human/CI approval.

---

## 11. Phase 1 vs later

| Now | After orchestrator PLAN approval | Never this agent |
|---|---|---|
| This document | Code, tests, migration, OPA, evidence, handover | Merge, Wave 2, CERTIFIED, `apps/api` mount, `infra/**`, `contracts/**`, `pnpm-lock.yaml` |
