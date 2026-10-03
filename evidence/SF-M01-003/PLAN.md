# SF-M01-003 implementation plan: CMP-031 Audit and Evidence Ledger

Status: **IMPLEMENTATION_READY** (Phase 2). Recommended gate: VERIFY candidate for human/CI. Agents do not self-certify. No Wave 2. No merge.

| Field | Value |
|---|---|
| Task | SF-M01-003 |
| Component | CMP-031 Audit & Evidence Ledger |
| Integration | INT-011 (tenant isolation enforcement chain; this layer = ledger RLS + privilege boundary) |
| Builder | serviceform-foundation-builder |
| Branch | `agent/M01-cmp-031-audit-ledger-SF-M01-003` |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` |
| Envelope | `orchestrator/tasks/SF-M01-003.yaml` (ADR-0006 ACCEPTED Option A) |
| Gate | Design. Agents do not self-certify. No Wave 2. No merge. |

**Stop until orchestrator plan approval.** After approval: implement against this plan and the mandatory negative tests; do not start Wave 2.

### Binding documents (read, not edited)

- `ARCHITECTURE-CONSTITUTION.md` (#6, #11, #21, #23, #24, #26, #28)
- `docs/adr/ADR-0006-per-component-write-roles.md` (ACCEPTED Option A + ten conditions)
- `orchestrator/dispatch/PLAN-REVIEW-M01-W1.md`
- `orchestrator/dispatch/plans-M01-W1/SECURITY-PRECHECK-M01-W1.md` (P-003-1..5, X-1/X-2)
- `orchestrator/dispatch/plans-M01-W1/SF-M01-003-plan.md` (prior builder draft; this file supersedes it)
- `orchestrator/dispatch/plans-M01-W1/SF-M01-003-negative-tests.md` (all 003-01..003-31 mandatory)
- Frozen: SF-CON-AUDIT-EVENT, SF-CON-OUTBOX, SF-CON-DB-SESSION-CONTEXT, SF-CON-EVENT-ENVELOPE, SF-CON-REQUEST-CONTEXT, SF-CON-ERROR-RESPONSE, SF-CON-ERROR-CATALOGUE, SF-CON-AUTHZ-DECISION, SF-CON-ISOLATION-DECLARATION, SF-CON-COMMON, SF-CON-IDEMPOTENCY

### Write-path limits

Allowed: `services/cmp-031-audit-ledger/**`, `packages/audit-client/**`, `db/migrations/*_cmp-031-*.sql`, plus implicit `evidence/SF-M01-003/**` and `orchestrator/handovers/SF-M01-003.yaml`.

Forbidden: `pnpm-lock.yaml` (restore if `pnpm install` dirties it), `contracts/**`, Constitution, other components, `apps/**`, `db/test/**`, `packages/contracts/**`, frozen outbox template. Do not import unmerged SF-M01-004 code.

---

## 1. Impact plan (AGENTS.md step 2)

| Area | Impact |
|---|---|
| IDs | M01; CMP-031; INT-011; Eng v1.4 CMP-031; AWS v1.7 CMP-031 + s14.3 (minimum event) + s14.4 (retention **not** built); TI v1.0 s6–s8, s8.1, s16, s19; ADR-0006 Option A |
| Domain | Append-only ledger of `AuditEvent` (SF-CON-AUDIT-EVENT unchanged). Ledger metadata outside the event: `chain_seq`, `recorded_at`, `prev_hash`, `row_hash`. No update/delete API. Head state-machine trigger (seq strictly +1, hash linkage) in addition to roles. |
| Data | Schema `sf_audit` (PLAN-REVIEW X-2). Tenant tables FORCE RLS via `sf_platform.current_tenant_id()`. Platform tables separate (null tenant is never an informal global marker). Monthly RANGE partitions on `recorded_at`. Outbox/inbox copied **byte-for-byte** from the frozen template (ADR-0006 condition 9). |
| Privilege | NOLOGIN `sf_cmp031_rw`. Runtime LOGIN `IN ROLE sf_app, sf_cmp031_rw` only. No SUPERUSER/BYPASSRLS. Not table/schema owner (`sf_migrator` or migration role). `sf_app` has **no** generic DML or SELECT on CMP-031 authoritative tables. PUBLIC revoked. Cross-component SQL DENY. Outbox grants stay as template. |
| APIs/events | `POST /internal/audit-events`, `GET /audit`, `GET /audit/{resourceType}/{id}` under plugin prefix `/v1`. Consumes `AuditEventSubmitted` on topic `sf.audit.ingest.v1`. Emits `AuditRecordCreated` (Eng alias `AuditRecorded` in a comment) on `sf.audit.events.v1`. |
| Tenancy/authz | Tenant only from server `RequestContext` or validated envelope; `dbSessionSettings()` + `set_config(..., true)`. Body tenant must match context or SF-TEN-002. `AuthzPort` (SF-CON-AUTHZ-DECISION); default deny. No OPA/CMP-048 import. Privileged cross-tenant **read: deny-only in W1** (Q7) with audited attempt. |
| Migration | Two SQL files in band `17595003xxxxx`, after `1759490000000`, full Down sections, round-trip tested. |
| Tests | Unit, contract, PG16 service integration, tenant-negative matrix, privilege-boundary, tamper, concurrency, PII, sink-unavailable, migration. Harness: real LOGIN roles, never `SET ROLE` from superuser (X-12 / ADR-0006 consequence). |
| Observability | `@serviceform/observability`. Logs: `audit_id`, `tenant_id`, `action`, `result`, `trace_id` only. Never `reason`, refs, `client_context`. Metrics: ingest by result, duplicates, PII rejections, chain-verify failures, ingest lag, dropped `client_context`. |
| Rollback | Code: revert branch. DB: Down drops `sf_audit` (ledger first, then outbox migration). Production drop of audit rows needs owner approval (statutory); not automatic. |

### Ingestion (two paths, one writer)

1. **Primary:** producer inserts `AuditEventSubmitted` into **its own** outbox, topic `sf.audit.ingest.v1`, partition key `audit:<audit_id>`, same transaction as the state change (`packages/audit-client` builds values, **never SQL**). CMP-038 publishes later. CMP-031 consumer group `cmp-031-audit-ingest` writes `inbox_event` + ledger in one transaction. Sink down = PENDING retry; at-least-once + inbox/`audit_id` dedupe.
2. **Secondary:** `POST /internal/audit-events` for callers with no producer transaction (edge denies, reads, jobs). `HttpAuditSink` retries 503; `requireAudit` fail-closes PRIVILEGED actions.
3. Both call `LedgerWriter.append()`. Transport is `handleEnvelope(envelope)`; tests use a contract-validated double (no Kafka, no SF-M01-004 import).

### Hash chain

Per-tenant `audit_chain_head` plus one platform head. Short transaction: insert genesis head if missing → `SELECT … FOR UPDATE` → dedupe on key → `seq = last_seq+1` → monotonic `recorded_at` (ms) → `row_hash = sha256(canonical JSON v1)` → insert key + ledger + `AuditRecordCreated` outbox → update head. `node:crypto` only. `verifyChain` detects hash mismatch, seq gap, prev_hash mismatch, key/ledger mismatch, truncated tail. Residual: superuser who rewrites rows **and** head can rehash (G-11; not built).

### Append-only

- `sf_cmp031_rw`: INSERT on ledger/key; UPDATE only on head columns `last_seq, last_hash, last_recorded_at`. **No** UPDATE/DELETE/TRUNCATE on ledger.
- `sf_app`: **no** grants on authoritative ledger tables.
- RLS: SELECT/INSERT policies only (`TO sf_app`).
- Triggers: `BEFORE UPDATE OR DELETE` row + `BEFORE TRUNCATE` on parent and every partition → SQLSTATE `P0001`. Evidence must **not** claim these stop the table owner (P-003-5); owner can disable triggers. Runtime is not owner (003-04).
- Partitions: ENABLE+FORCE RLS, no policies, no grants → direct partition DML denied.

### Platform records and privileged reads (P-003-1, Q7)

- Null-tenant events → `audit_event_platform` only when context/envelope has no tenant.
- `sf_cmp031_rw`: INSERT on platform ledger; SELECT/UPDATE on platform head/key as needed to chain. **No SELECT** on `audit_event_platform` for `sf_app`.
- Platform SELECT policy is **not** “current_tenant_id() IS NULL” for all of `sf_app` (that was fail-open). W1 query of platform rows is deny-only except verify CLI as operations/owner connection (H2).
- Privileged cross-tenant read: AuthzPort allow + reason required in design, but **W1 always 403** if `target_tenant_id` present (003-18); still write a platform attempt record when the caller is a platform actor. No `set_config` of the target. No BYPASSRLS.

### PII (Q6, Q8)

1. Allow-list = SF-CON-AUDIT-EVENT (`additionalProperties: false`); reject extras, never strip-and-store.
2. Detectors on `reason`, `before_ref`, `after_ref` only (not ids): Aadhaar/VID/PAN/email/mobile/card including evasion cases in 003-25. HTTP 400 SF-SYS-003 detail `PII_FIELD_REJECTED`; pointer names path, never value.
3. `client_context` accepted, **dropped, not stored** (O-3); metric counted; stored record still validates SF-CON-AUDIT-EVENT.
4. Consumer PII reject → dead-letter that envelope only (`audit:<id>`), not tenant-wide stall.

---

## 2. ADR-0006 privilege model (normative for this task)

Canonical role **`sf_cmp031_rw`** (PLAN-REVIEW `sf_audit_rw` superseded).

| Condition | CMP-031 application |
|---|---|
| 1 No generic DML on `sf_app` | Ledger/key/head DML and sequences granted only to `sf_cmp031_rw`. `sf_app` gets no INSERT/UPDATE/DELETE/SELECT on those tables. |
| 2 NOLOGIN `_rw` | Guarded `DO $$ … pg_roles … CREATE ROLE sf_cmp031_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` (PostgreSQL has no `CREATE ROLE IF NOT EXISTS`; INHERIT default so the runtime login receives its grants). Role cannot login. |
| 3 Runtime membership | Component LOGIN: `IN ROLE sf_app, sf_cmp031_rw` only. Tests create `sf_t003_writer` that way and `sf_t003_rt` as `IN ROLE sf_app` only (peer component). |
| 4 No SUPERUSER/BYPASSRLS | Catalogue assert on `sf_cmp031_rw`, both test logins, and `sf_app`. |
| 5 Not table owner | Schema `sf_audit` and tables owned by shared `sf_migrator` (idempotent `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sf_migrator') THEN CREATE ROLE … NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`). Runtime `pg_has_role(session_user, relowner, 'MEMBER') = false`. |
| 6 FORCE RLS | All TENANT_SCOPED tables ENABLE + FORCE; policies `TO sf_app` using `sf_platform.current_tenant_id()`. Grants do not replace RLS. Platform tables also ENABLE+FORCE (P-003-1). |
| 7 Cross-component SQL DENY | No GRANT to `sf_cmp002_rw` / `037` / `038` / `048` / peer logins. Peer `sf_t003_rt` SELECT/INSERT/UPDATE/DELETE on `sf_audit.*` → 42501 (except frozen outbox INSERT residual). |
| 8 PUBLIC revoked | `REVOKE ALL ON SCHEMA sf_audit FROM PUBLIC`; revoke on every table/sequence; no `ALTER DEFAULT PRIVILEGES … GRANT TO PUBLIC` or to `sf_app` for DML. |
| 9 Frozen outbox | Second migration is the template with `{schema}=sf_audit`, `{cmp}=CMP-031` only. Test diffs against `contracts/shared/sql/outbox.template.sql`. Residual: template still `GRANT INSERT … TO sf_app` on outbox/inbox — recorded in EVIDENCE.md, not changed. |
| 10 Privilege-boundary suite | Own DML as writer succeeds; wrong-tenant RLS fail; peer SQL fail; `SET ROLE` / membership of other `_rw` unavailable; `rolbypassrls` false; runtime not owner. Evidence: `evidence/SF-M01-003/privilege-boundary.log`. Hard gate `component_privilege_boundary` 100%. |

`CREATE ROLE` for sibling `_rw` names in tests (so membership-deny can be asserted) uses the same guarded `DO $$ … pg_roles …` form and does not grant them anything on `sf_audit`.

---

## 3. Schema and tables

Migrations (PLAN-REVIEW X-1 band):

- `db/migrations/1759500300000_cmp-031-audit-ledger.sql` — roles, schema, ledger, partitions, triggers, privilege grants
- `db/migrations/1759500301000_cmp-031-outbox-inbox.sql` — frozen template only

`-- sf:isolation sf_audit.<table> <CLASS> owner=CMP-031` on every `CREATE TABLE`. Isolation declarations also emitted as JSON in `services/cmp-031-audit-ledger/contracts/isolation.json` (component-owned; not a frozen contract edit).

| Table | Isolation | RLS | Grants (authoritative) | Notes |
|---|---|---|---|---|
| `sf_audit.audit_event` | TENANT_SCOPED | ENABLE+FORCE; SELECT/INSERT `TO sf_app` `tenant_id = current_tenant_id()` | `sf_cmp031_rw`: SELECT, INSERT. No UPDATE/DELETE/TRUNCATE | RANGE(`recorded_at`) monthly; PK `(tenant_id, chain_seq, recorded_at)`; `record jsonb`; generated cols from event; `prev_hash`/`row_hash` bytea(32); CHECK `record->>'tenant_id' = tenant_id::text` |
| `sf_audit.audit_event_key` | TENANT_SCOPED | same | SELECT, INSERT to `_rw` | PK `(tenant_id, audit_id)`; UNIQUE `(tenant_id, chain_seq)` |
| `sf_audit.audit_chain_head` | TENANT_SCOPED | ALL USING/WITH CHECK tenant | SELECT, INSERT, UPDATE(`last_seq,last_hash,last_recorded_at`) to `_rw` | Head trigger: new last_seq = old+1 and last_hash equals new row hash |
| `sf_audit.audit_event_platform` | PLATFORM_OPERATIONAL | ENABLE+FORCE; INSERT WITH CHECK `current_tenant_id() IS NULL`; **no SELECT policy for sf_app** | INSERT (+ needed writer SELECT on head/key only) to `_rw` | CHECK `jsonb_typeof(record->'tenant_id') = 'null'` |
| `sf_audit.audit_event_platform_key` | PLATFORM_OPERATIONAL | INSERT/SELECT for writer path as required; no tenant sf_app SELECT of platform facts | `_rw` only | |
| `sf_audit.audit_chain_head_platform` | PLATFORM_OPERATIONAL | as head | SELECT/INSERT/UPDATE(cols) `_rw` | PK `id=1` |
| `outbox_event`, `outbox_event_platform`, `inbox_event`, `inbox_event_platform` | per template | per template | **unchanged template grants** (`sf_app` INSERT, publisher SELECT/UPDATE/DELETE) | Residual vs condition 1; CCR later |

Partitions: `audit_event_yYYYYmMM` / `audit_event_platform_yYYYYmMM` for 24 months from 2026-10 plus `sf_audit.ensure_partitions()` / `create_month_partitions` **owner-only** (no EXECUTE for `sf_app` or `_rw`). No DEFAULT partition: out-of-window insert fails, tx rolls back, producer outbox stays PENDING (003-10). Indexes: `(tenant_id, recorded_at, chain_seq)`, resource, correlation, actor.

Not created: `audit_export_job` (Q5 / CMP-032 W2). No retention/drop (CMP-049 stop).

Down: drop triggers/functions/tables/schema; drop `sf_cmp031_rw` only if no remaining grants (safe if this schema is the only grantor). Do not drop `sf_migrator` if other components may share it — leave role; document.

---

## 4. APIs and events (Eng v1.4 mapping)

Plugin `cmp031AuditLedgerPlugin({ pool, resolveRequestContext, authz, logger, clock, prefix })`. Default prefix `/v1`. **Not registered in `apps/api`** (X-10; CMP-036 W2).

| Eng v1.4 | Implementation |
|---|---|
| Command `POST /internal/audit-events` | Body = AuditEvent. Bind actor/cell/correlation to context (P-003-4 / 003-19); INTEGRATION relay only with purpose, own tenant. 201 `{audit_id, chain_seq, recorded_at}`; same id+content 200; same id+different content 409 SF-APP-002; schema/PII 400 SF-SYS-003; tenant mismatch 403 SF-TEN-002; missing context 401 SF-TEN-001; future `occurred_at` > now+300s 400; DB down 503 SF-SYS-004. Internal: SYSTEM/INTEGRATION + authz. `\u0000` → 400 not 500. |
| Query `GET /audit` | Required `from,to` max 31 days; filters actor/action/class/resource/result/correlation; keyset `(recorded_at, chain_seq)`; limit ≤ 200. Items `{ event: AuditEvent, ledger: { chain_seq, recorded_at, row_hash } }`. `target_tenant_id` → 403 in W1 (003-18) + attempt audit. Every GET itself audited (READ). |
| Query `GET /audit/{resourceType}/{id}` | Same item shape. Existence oracle: T2 resource under T1 looks like unknown id (empty, not 403). |
| Handles `AuditEventSubmitted` v1 | Envelope SF-CON-EVENT-ENVELOPE; `data` = exactly one AuditEvent; topic `sf.audit.ingest.v1`; `aggregate_type=AuditEvent`; `aggregate_id=audit_id`; `schema_version=1`. Reject mismatches (003-21). Platform-null only from allowlisted `sf-source` (P-003-3). |
| Emits `AuditRecordCreated` v1 | Alias comment: Eng `AuditRecorded`. Own outbox, same tx as ledger write. `data` = `{audit_id, chain_seq, recorded_at, action, action_class, resource_type, result}` — no reason/refs. Topic `sf.audit.events.v1`. |
| Export | Deferred W2. |
| Verify | Library + `src/cli/verify-chain.ts`; no HTTP unless later approved. |

Errors: frozen catalogue only; bodies SF-CON-ERROR-RESPONSE. X-8 details e.g. `PII_FIELD_REJECTED`, `CLOCK_SKEW`. Component OpenAPI/AsyncAPI/topics.json under `services/cmp-031-audit-ledger/contracts/`.

### `packages/audit-client` (`@serviceform/audit-client`)

Deps: `@serviceform/contracts` only (no `pg`, no service import the other way except service → client).

- `buildAuditEvent(ctx, input)` — tenant/cell/actor/correlation/trace from context; new `audit_id`; validate + PII detectors.
- `toSubmittedEnvelope` / `toOutboxRow` — validated column values; producers insert via their helper (`// replaced by packages/outbox at stitching`).
- `HttpAuditSink` — `fetch`, jittered retry on 503, `AuditSinkUnavailableError`; `requireAudit` fail-closed for PRIVILEGED.
- Canonical JSON + `hashEvent`. Null-tenant events refused when ctx has a tenant (P-003-3).

---

## 5. Files to create (after approval only)

`services/cmp-031-audit-ledger/`: `package.json`, `tsconfig.json`, `vitest.integration.config.ts`, `README.md`, `contracts/{openapi.yaml,asyncapi.yaml,topics.json,isolation.json}`, `src/index.ts`, `src/plugin.ts`, `src/config.ts`, `src/routes/{post-audit-event,get-audit,get-audit-by-resource}.ts`, `src/domain/{ledger-writer,chain,verify-chain,clock-guard,errors,query-filters}.ts`, `src/consumer/handle-envelope.ts`, `src/repo/{tx,ledger-repo,query-repo,outbox-repo}.ts`, `src/ports/{authz-port,request-context-port}.ts`, `src/cli/verify-chain.ts`, `test/unit/*.test.ts`, `test/contract/*.test.ts`, `test/integration/*.int.test.ts`, `test/support/{db,roles,publisher,producer-schema,fixtures}.ts`.

`packages/audit-client/`: `package.json`, `tsconfig.json`, `README.md`, `src/{index,build-event,envelope,outbox-row,http-sink,require-audit,pii-guard,canonical-json,errors}.ts`, `test/*.test.ts`.

Migrations as §3. After approval, copy this plan to `evidence/SF-M01-003/PLAN.md` as the first implementation commit (PLAN-REVIEW condition 1). Handover last: `orchestrator/handovers/SF-M01-003.yaml`.

---

## 6. Negative, deny, isolation, and privilege tests

**Harness (H1–H3):** per-run LOGIN `sf_t003_rt` (`IN ROLE sf_app`, NOSUPERUSER NOBYPASSRLS) and `sf_t003_writer` (`IN ROLE sf_app, sf_cmp031_rw`). Separate pools. Never postgres. Never `SET ROLE` from superuser. Assert not table-owner member. Tamper T-series may use owner/superuser only to simulate storage attacker. Pool reuse `max:1` + `pg_backend_pid()`.

Mandatory cases from `SF-M01-003-negative-tests.md` (003-01..003-31) **plus** envelope ADR-0006 suite (003-PB):

| ID | Gate | Assertion |
|---|---|---|
| 003-01 | UCS | H1 identity |
| 003-02 | UCS | N1–N7 append-only as rt / owner trigger |
| 003-03 | UCS/CTL | Partitions FORCE RLS, no grants, no EXECUTE ensure_partitions |
| 003-04 | UCS | Owner-bypass as rt refused; no prosecdef; runtime not owner |
| 003-05 | UCS | Forged append as `sf_t003_rt`: 42501 on ledger INSERT and head UPDATE (**must pass** with `sf_cmp031_rw`) |
| 003-06 | UCS | Head rewind refused by trigger even as writer |
| 003-07..10 | UCS | Tamper T1–T7, canonicalisation, backdating, partition window / no loss |
| 003-11..16 | RLS/CTL | W1–W9, platform leak 003-12, full matrix → `rls-negative-matrix.md`, leak funcs, existence oracle, consumer pool reuse |
| 003-17..18 | UCS/CTL | Privileged read deny path + no set_config of target |
| 003-19..23 | UCS/FCC | Actor binding, platform forgery, envelope rejects, duplicates |
| 003-24..28 | UCS/CTL | PII, evasion, dropped client_context, canary logs, query injection |
| 003-29..31 | LOST/FCC | Sink unavailable zero-loss, PII DLQ key isolation, migration + template equality |
| **003-PB-01** | privilege | Writer authorized INSERT+head update succeeds; verify OK |
| **003-PB-02** | privilege | Writer wrong-tenant INSERT/SELECT fail closed (RLS) |
| **003-PB-03** | privilege | `sf_t003_rt` SELECT/INSERT/UPDATE/DELETE on ledger/key/head/platform → 42501 |
| **003-PB-04** | privilege | Writer `pg_has_role(..., 'sf_cmp002_rw'/'037'/'038'/'048', 'MEMBER')` false; `SET ROLE` those names fail |
| **003-PB-05** | privilege | `rolbypassrls`/`rolsuper` false on writer, rt, `sf_cmp031_rw`, `sf_app` |
| **003-PB-06** | privilege | Writer is not `relowner`; `has_schema_privilege(..., 'CREATE')` false on `sf_audit` |
| **003-PB-07** | privilege | `has_table_privilege('public', ...)` false; no PUBLIC grants in `information_schema.role_table_grants` for `sf_audit` |
| **003-PB-08** | privilege | Outbox template residual: rt **can** INSERT `outbox_event` under tenant RLS (frozen); recorded as residual, not “fixed” |

Log 003-PB-* to `evidence/SF-M01-003/privilege-boundary.log`. Tamper to `tamper-detection.log`.

---

## 7. Third-party dependencies

**None new.** Pin to lockfile versions already on main: `fastify 5.12.5`, `fastify-plugin 5.1.0`, `pg 8.23.1`, `@types/pg 8.23.1` (dev). Workspace: `@serviceform/contracts`, `@serviceform/observability`, `@serviceform/audit-client`. Hash `node:crypto`; HTTP `fetch`; UUID `crypto.randomUUID()`. Migrations via existing `@serviceform/db` / node-pg-migrate 9.0.0. No pg_partman.

`pnpm-lock.yaml` is read-only. If install dirties it, restore before commit; orchestrator reconciles lockfile later.

---

## 8. Rollback

- Application: revert this branch; nothing registers the plugin in `apps/api`.
- Database: `migrate:down` two files; `sf_audit` gone. Do not drop `sf_migrator` if shared.
- Statutory: do not auto-drop ledger data in a non-dev environment without owner approval.
- Privilege residual if ADR were reversed: not applicable (ACCEPTED). Outbox `sf_app` INSERT residual remains until a CCR.

---

## 9. Evidence (implementation phase; not this commit)

`evidence/SF-M01-003/{PLAN.md,EVIDENCE.md,privilege-boundary.log,tamper-detection.log,rls-negative-matrix.md,junit/*.xml,coverage-summary.json,scope-check.log,gates.log}`. Coverage ≥80% lines on new src. Scope: `python scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-003.yaml --base origin/main`.

Recommended gate after executed evidence: **VERIFY candidate** for human/CI — **not CERTIFIED**.

---

## 10. Open items (do not block W1; already ruled)

| ID | Ruling applied |
|---|---|
| Q1 G-11 WORM | In-DB chain only; residual in EVIDENCE.md |
| Q2 event names | `AuditRecordCreated`; ingest `AuditEventSubmitted` / `sf.audit.ingest.v1` |
| Q3 outbox library | audit-client builds rows; no SF-M01-004 import |
| Q4 partitions | 24 months + `ensure_partitions()`; fail closed outside window |
| Q5 export | Deferred W2 |
| Q6 PII DLQ | Per-id dead-letter; SF-SYS-003 `PII_FIELD_REJECTED`; scan free-text only |
| Q7 cross-tenant read | Deny-only + audited attempt |
| Q8 client_context | Drop, do not store (O-3) |
| Q9 names | Schema `sf_audit`; role `sf_cmp031_rw`; timestamps `17595003*` |
| Q10 purpose field | No CCR now (O-4) |
| Q11 clock skew | 300 s configurable (X-13) |

### Stop conditions (halt and report)

Frozen contract change; ADR-0006 condition 1–10 violation; editing outbox grants; raw PII storage; retention/WORM; write outside allowed paths; need for unmerged CMP-038 code; `pnpm-lock.yaml` required; hard-gate failure.

---

**PLAN_READY.** Awaiting orchestrator approval before any implementation.
