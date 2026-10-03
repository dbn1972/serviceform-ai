# SF-M01-003 plan: CMP-031 Audit & Evidence Ledger (PLAN phase, read-only)

Builder: serviceform-foundation-builder, claude-opus-5-5, effort high. Base d1d0965, branch
`agent/M01-cmp-031-audit-ledger-SF-M01-003`. Sources read: AGENTS.md, ARCHITECTURE-CONSTITUTION.md,
CLAUDE-MULTI-AGENT-GUIDE.md, envelope SF-M01-003.yaml, DISPATCH-PLAN-M01-W1 s4/s5, CONTRACT-REVIEW-001,
contracts/shared (audit-event, event-envelope, request-context, db-session-context, common,
error-catalogue, outbox.template.sql), migrations 1759482000000 and 1759490000000, scripts/gates
(migration_lint, check_scope), Eng v1.4 CMP-031, AWS v1.7 CMP-031 + s14.3/s14.4, TI v1.0 s8.1, s16-17, s19, constitution.
No code is written until the orchestrator approves this plan and the security verifier has delivered
the tenant-negative/deny tests (MODEL-ROUTING-QUALITY s9); I implement against those tests.

## 1. Impact plan (AGENTS.md task loop step 2)

| Area | Impact |
|---|---|
| IDs | M01; CMP-031; INT-011 (tenant isolation chain); requirements: Eng v1.4 CMP-031 (purpose, tenant model, NFR, interfaces, failure behaviour, AI gate "append-only/tamper-evident, no secrets/full payloads, material actions traceable"); AWS v1.7 CMP-031 + s14.3 (minimum contract) + s14.4 (retention, not implemented here); TI v1.0 #8, #15, #16, s16, s19. |
| Domain | Append-only ledger of `AuditEvent` (SF-CON-AUDIT-EVENT, unchanged) per tenant chain plus one platform chain. Ledger metadata added outside the event: `chain_seq`, `recorded_at`, `prev_hash`, `row_hash`. No state machine; no update or delete path exists. |
| Data | New schema `cmp031_audit` (name is an open question, Q9). Tenant tables FORCE RLS via `sf_platform.current_tenant_id()`; platform tables separate (TI #8: null tenant_id is never an informal global marker). Time-partitioned by `recorded_at`. Outbox/inbox copied unchanged from the template. |
| APIs/events | `POST /internal/audit-events`, `GET /audit`, `GET /audit/{resourceType}/{id}`; consumes `AuditEventSubmitted` (component-owned AsyncAPI) from producers' outboxes; emits `AuditRecorded` via own outbox. |
| Tenancy/authz | Tenant only from server-side RequestContext (HTTP) or the validated envelope (consumer), applied with `set_config(..., true)` via `dbSessionSettings()`. Body `tenant_id` must equal context tenant or SF-TEN-002. Authorization (who may query audit, privileged cross-tenant read) through an injected `AuthzPort` speaking SF-CON-AUTHZ-DECISION; default port denies. No OPA/CMP-048 import. |
| Migration | Two forward migrations after 1759490000000 with full Down sections; round-trip tested. |
| Tests | Unit, contract (ajv against frozen schemas), service integration on PG16 (`sf_m01_003`), tenant-negative matrix, tamper, concurrency, failure-path (sink unavailable), migration round trip. |
| Observability | `@serviceform/observability` logger (redacted); log only audit_id, tenant_id, action, result, trace_id; never `reason`, refs or client_context. Metrics: ingest count by result, duplicate count, PII rejections, chain-verify failures, ingest lag (recorded_at - occurred_at). |
| Rollback | Code: revert branch (no other component imports it). DB: Down migrations drop the `cmp031_audit` schema (outbox migration first). Before any non-dev rollback, export ledger rows; dropping audit data in a real environment needs owner approval (statutory record) and is not automatic. |

### Ingestion design decision (both paths, one write routine)
- **Primary path: consumed events via the frozen outbox/inbox contract.** AWS v1.7: "critical state changes also
  write transactional audit/outbox record" and "asynchronous ingestion with durable buffer"; Constitution #11/#23 forbid
  writing CMP-031 tables from another component and forbid network calls inside the producer's transaction. The producer
  inserts an `AuditEventSubmitted` envelope into **its own** `outbox_event` in the same transaction as its state change
  (audit and change commit or roll back together). CMP-038 publishes; CMP-031's consumer (`cmp-031-audit-ingest` group)
  records `inbox_event` + ledger row in one transaction. Sink unavailable = row stays PENDING and is retried by the
  publisher (template rule 3); delivery is at-least-once, dedupe by inbox + `audit_id` gives exactly-once storage.
- **Secondary path: synchronous `POST /internal/audit-events`** (Eng v1.4 command) for callers with no transaction of
  their own (denied requests at the edge, read audits, platform jobs). Failure returns an error to the caller; the
  audit-client never drops silently, and for PRIVILEGED actions the helper makes the caller's action fail closed.
- Both paths call one `LedgerWriter.append()` so chain, dedupe, PII guard and validation are identical.
- Partition key for ingest envelopes is `audit:<audit_id>`, not the tenant, so a DEAD_LETTERED audit envelope (template
  rule 4) cannot block every later audit of that tenant; chain order is ingest order, so per-key ordering is not needed.
- Transport binding (Kafka/MSK topic subscription) belongs to CMP-038, which is unmerged. CMP-031 exposes a
  transport-agnostic `handleEnvelope(envelope)`; tests drive it with a contract-validated test-double publisher.

### Hash chain and concurrency
- `audit_chain_head(tenant_id PK, last_seq, last_hash, last_recorded_at)`. Writer, in one short transaction:
  `INSERT head ON CONFLICT DO NOTHING` (genesis: seq 0, 32 zero bytes) -> `SELECT ... FOR UPDATE` on the head row ->
  dedupe check on `audit_event_key` (after the lock, READ COMMITTED sees the winner's commit) -> `seq = last_seq+1`,
  `recorded_at = greatest(date_trunc('milliseconds', clock_timestamp()), last_recorded_at)` (monotonic per chain, ms
  so the hash is reproducible) -> `row_hash = sha256(canonical({v:1, tenant_id, chain_seq, recorded_at, audit_id,
  event, prev_hash}))` -> insert key row, ledger row, `AuditRecorded` outbox row, update head -> commit.
- The row lock serialises writers of one tenant only; tenants proceed in parallel. Lock held for microseconds, no I/O.
- Canonical JSON: sorted keys, no whitespace, UTF-8, implemented locally (the event has only strings, nulls, objects).
  Hashing in TypeScript with `node:crypto`; no new dependency.
- `verifyChain(scope)` (library + CLI): keyset scan by seq; detects modified row (hash mismatch), deleted row (seq gap),
  reorder/relink (prev_hash mismatch), key/ledger mismatch, truncated tail (head.last_seq/last_hash != last row).
  Limitation stated in evidence: an actor able to rewrite rows **and** the head can re-hash the chain; external
  anchoring (periodic head signing to S3 Object Lock/KMS) is the defence and is gap G-11 (Q1), not built here.

### Append-only enforcement for sf_app
1. Grants: sf_app gets `SELECT, INSERT` only on ledger and key tables; no UPDATE, DELETE, TRUNCATE.
2. RLS: only `FOR SELECT` and `FOR INSERT` policies; no UPDATE/DELETE policy exists.
3. Triggers: `BEFORE UPDATE OR DELETE ... FOR EACH ROW` on the partitioned parents (cloned to partitions) and
   `BEFORE TRUNCATE` statement triggers on parents and every partition, raising SQLSTATE `P0001` "audit ledger is
   append-only"; these stop even the owner unless a superuser disables them (the tamper test does exactly that).
4. Partitions: ENABLE+FORCE RLS, no policies, no grants -> sf_app cannot address a partition directly, bypassing parent policies.

### Platform records and privileged reads
- `tenant_id: null` events go to `audit_event_platform` (single platform chain), only when the request/envelope
  context itself has no tenant (platform actor). RLS on platform tables: policy `sf_platform.current_tenant_id() IS NULL`
  so a tenant-context transaction can neither read nor write platform audit.
- Privileged cross-tenant read (platform actor, target tenant T): (1) AuthzPort must allow action
  `AUDIT_CROSS_TENANT_READ` with reason + purpose (schema requires `reason` for PRIVILEGED); (2) tx1 (no tenant) appends a
  PRIVILEGED record to the platform chain and commits, fail closed; (3) tx2 sets `app.tenant_id = T` server-side, appends
  the same access record to T's chain (tenant can see who read its audit), then runs the query. No BYPASSRLS, no
  RLS-free role. If tx2 fails, the platform record stands as the attempt. Every GET on audit is itself audited (READ class).

### PII allow-list guard (Eng: "does not become a raw PII log")
1. Allow-list = SF-CON-AUDIT-EVENT (`additionalProperties: false` at top level and in `client_context`), validated
   with `@serviceform/contracts` `validate('audit-event', ...)`. Unknown keys are rejected, never stripped and stored.
2. Free-text fields (`reason`, `resource_id`, `before_ref`, `after_ref`, `client_context.device_id`) pass value
   detectors: Aadhaar (12 digits + Verhoeff), VID (16 digits), PAN, e-mail, Indian mobile, card number (Luhn).
   A hit rejects the event (HTTP 400 SF-SYS-003; consumer: dead-letter via retry exhaustion, see Q6). Error details name
   the JSON path and detector, never the value.
3. Ledger stores only the validated object; logs never contain the free-text fields.

## 2. Tables (migrations after 1759490000000)

`db/migrations/1759500003000_cmp-031-audit-ledger.sql` (ledger) and
`db/migrations/1759500003100_cmp-031-outbox-inbox.sql` (template rendered with `{schema}=cmp031_audit`,
`{cmp}=CMP-031`, byte-for-byte otherwise; a test diffs the rendered template against the file).
Every table has a `-- sf:isolation cmp031_audit.<t> <CLASS> owner=CMP-031` line. All RLS uses
`sf_platform.current_tenant_id()`. `GRANT USAGE ON SCHEMA cmp031_audit TO sf_app`.

| Table | Class | Key columns | Partitioning | RLS / grants to sf_app |
|---|---|---|---|---|
| `audit_event` | TENANT_SCOPED | `tenant_id uuid NOT NULL`, `chain_seq bigint`, `recorded_at timestamptz`, `audit_id uuid`, `record jsonb` (validated event), generated stored cols `occurred_at, cell_id, actor_type, actor_id, action, action_class, resource_type, resource_id, correlation_id, trace_id, result, classification`; `prev_hash bytea`, `row_hash bytea` (CHECK octet_length = 32); CHECK `record->>'tenant_id' = tenant_id::text`; PK `(tenant_id, chain_seq, recorded_at)` | RANGE(`recorded_at`) monthly | ENABLE+FORCE; `SELECT USING tenant_id = current_tenant_id()`; `INSERT WITH CHECK` same. GRANT SELECT, INSERT. Indexes `(tenant_id, recorded_at, chain_seq)`, `(tenant_id, resource_type, resource_id, recorded_at)`, `(tenant_id, correlation_id)`, `(tenant_id, actor_id, recorded_at)`. |
| `audit_event_key` | TENANT_SCOPED | `tenant_id uuid NOT NULL`, `audit_id uuid`, `chain_seq`, `recorded_at`, `content_hash bytea`; PK `(tenant_id, audit_id)`, UNIQUE `(tenant_id, chain_seq)` | none (global uniqueness that a partitioned table cannot give) | ENABLE+FORCE; SELECT/INSERT policies on tenant. GRANT SELECT, INSERT. |
| `audit_chain_head` | TENANT_SCOPED | `tenant_id uuid NOT NULL` PK, `last_seq`, `last_hash`, `last_recorded_at` | none | ENABLE+FORCE; ALL policy USING/WITH CHECK tenant. GRANT SELECT, INSERT, UPDATE(last_seq,last_hash,last_recorded_at). |
| `audit_event_platform` | PLATFORM_OPERATIONAL | as `audit_event` without `tenant_id`; CHECK `jsonb_typeof(record->'tenant_id') = 'null'` | RANGE(`recorded_at`) monthly | ENABLE+FORCE; SELECT/INSERT policy `current_tenant_id() IS NULL`. GRANT SELECT, INSERT. |
| `audit_event_platform_key` | PLATFORM_OPERATIONAL | `audit_id` PK, `chain_seq` UNIQUE, `recorded_at`, `content_hash` | none | as above. |
| `audit_chain_head_platform` | PLATFORM_OPERATIONAL | `id smallint PK CHECK (id = 1)`, `last_seq`, `last_hash`, `last_recorded_at` | none | as above + UPDATE(cols). |
| `outbox_event`, `outbox_event_platform`, `inbox_event`, `inbox_event_platform` | per template | unchanged | none | unchanged template policies and grants. |

- Partitions: `audit_event_yYYYYmMM` / `audit_event_platform_yYYYYmMM` created by migration for 2026-10 .. 2027-12
  through owner-only function `cmp031_audit.create_month_partitions(from date, months int)` (adds FORCE RLS and the
  TRUNCATE trigger; not granted to sf_app). No DEFAULT partition: a row outside the window fails closed (outbox retries,
  nothing lost) and raises the ingest-failure metric. Who schedules partition creation is Q4.
- Not created: `audit_export_job` (Eng authoritative data) because export writes to S3 (CMP-032, W2) and has no
  acceptance test in this envelope (Q5). No retention, archival or partition drop (CMP-049/M08 stop condition).
- Down sections: drop triggers/functions/tables then `DROP SCHEMA cmp031_audit` (lint checks Up only).

## 3. APIs, events, audit-client (Eng v1.4 CMP-031 mapping)

| Eng v1.4 interface | Implementation | Notes |
|---|---|---|
| Command `POST /internal/audit-events` | Body = AuditEvent. 201 `{audit_id, chain_seq, recorded_at}`; same id + same content -> 200 same body; same id + different content -> 409 SF-APP-002; schema/PII fail -> 400 SF-SYS-003; body tenant != context -> 403 SF-TEN-002; no context -> 401 SF-TEN-001; `occurred_at` > now + skew (default 300 s, config) -> 400 SF-SYS-003 (clock inconsistency); DB down -> 503 SF-SYS-004. Internal only: actor_type SYSTEM/INTEGRATION + authz allow. | |
| Query `GET /audit` | Filters `from,to` (required, max 31 days), `actor_id, action, action_class, resource_type, result, correlation_id`; keyset cursor on `(recorded_at, chain_seq)`; `limit` <= 200. Items `{event: AuditEvent, ledger: {chain_seq, recorded_at, row_hash}}` so `event` validates against SF-CON-AUDIT-EVENT. Privileged form adds `target_tenant_id` + `reason` (s1 flow). | AWS: "query only through privileged audit API" |
| Query `GET /audit/{resourceType}/{id}` | Same item shape, `resourceType` pattern from common `resourceType`. | |
| Event handled `AuditEventSubmitted` v1 | Envelope SF-CON-EVENT-ENVELOPE, `aggregate_type=AuditEvent`, `aggregate_id=audit_id`, `aggregate_version=0`, `data` = AuditEvent; consumer checks `data.tenant_id == envelope.tenant_id`, `data.correlation_id == envelope.correlation_id`, actor match. Name is Q2. | component-owned AsyncAPI |
| Event emitted `AuditRecorded` v1 | Own outbox, same tx. `data = {audit_id, chain_seq, recorded_at, action, action_class, resource_type, result}` (no reason/refs). Eng says `AuditRecorded`, AWS says `AuditRecordCreated` (Q2). | for CMP-045/CMP-049 |
| Export for investigation | Deferred (Q5). | |
| Verify (not an Eng interface) | `verifyChain` library + `src/cli/verify-chain.ts`; no HTTP endpoint unless approved (Q7). | |

Errors use the frozen catalogue only; responses follow SF-CON-ERROR-RESPONSE. Fastify plugin
`cmp031AuditLedgerPlugin(opts: {pool, resolveRequestContext, authz, logger, clock})` under `/v1/audit` per
services/README. Registering it in `apps/api` is outside my write scope (apps/** read-only) -> integration stitcher.

**packages/audit-client** (`@serviceform/audit-client`, deps: `@serviceform/contracts` only):
- `buildAuditEvent(ctx: RequestContext, input)` - fills tenant_id, cell_id, actor, organisation/office, correlation_id,
  trace_id from the server context (never from caller input), new `audit_id`; validates against SF-CON-AUDIT-EVENT and
  runs the same PII value detectors (shared module `pii-guard.ts` lives in the client; the service imports the package).
- `toSubmittedEnvelope(event)` - SF-CON-EVENT-ENVELOPE `AuditEventSubmitted`, validated.
- `toOutboxRow(envelope, topic)` - column values for the producer's own outbox (`outbox_event` or `_platform` by tenant),
  validated against SF-CON-OUTBOX record schema. It does not open connections or write SQL; producers insert through
  `packages/outbox` (CMP-038) once merged (Q3).
- `HttpAuditSink` - `POST /internal/audit-events` via built-in `fetch`, bounded retry with jitter on 503/network using the
  same `audit_id` (idempotent), throws `AuditSinkUnavailableError` when exhausted; `requireAudit(action, fn)` refuses a
  PRIVILEGED action whose audit write failed.
- Canonical JSON + `hashEvent()` exported for the service and verify CLI.

## 4. Negative test list (integration on PG16 unless marked unit)

Append-only: N1 sf_app UPDATE `audit_event` -> 42501. N2 sf_app DELETE -> 42501. N3 sf_app TRUNCATE parent and a
partition -> 42501. N4 owner UPDATE/DELETE/TRUNCATE -> P0001 trigger. N5 sf_app SELECT/INSERT directly on a partition ->
42501. N6 same four for `audit_event_key` and platform tables. N7 sf_app cannot UPDATE head columns other than the three
granted or DELETE head rows.
Tamper: T1 superuser disables trigger, edits `record` of seq k -> verify reports seq k hash mismatch (log to
tamper-detection.log). T2 delete seq k -> gap. T3 swap two rows' hashes -> prev_hash mismatch. T4 delete tail with head
untouched -> head mismatch. T5 edit generated-column source via record -> detected. T6 clean chain of 1,000 rows -> OK.
T7 50 concurrent writers same tenant -> seq 1..50 contiguous, verify OK; two tenants concurrently -> independent chains.
Wrong tenant / unset context: W1 tenant A context reads B's rows via GET /audit and GET by resource -> empty, no 403
leak of existence. W2 A inserts row with tenant_id B -> RLS violation 42501. W3 body tenant B with context A -> 403
SF-TEN-002, nothing stored. W4 no app.tenant_id -> SELECT returns 0 rows, INSERT fails (fail closed). W5 reused pooled
session with `''` tenant -> no error, 0 rows (CR-01 regression). W6 tenant context cannot read/write platform tables.
W7 platform context cannot read tenant tables. W8 envelope with `data.tenant_id != envelope.tenant_id` -> rejected.
W9 client-supplied `tenant_id` query param ignored for non-privileged actor. W10 privileged cross-tenant read without
authz allow -> 403 SF-AUTH-002, platform attempt record written; with allow but no reason -> 400. W11 privileged read
writes one platform record and one target-tenant record before results; if platform audit insert fails -> read refused.
Duplicate: D1 same audit_id twice via POST -> one row, 200 on second. D2 same id different content -> 409 SF-APP-002.
D3 same envelope delivered twice (lease expiry) -> inbox conflict, one row. D4 two concurrent submissions same id -> one row.
PII (unit + integration): P1 extra top-level field (e.g. `aadhaar_number`) -> 400, nothing stored. P2 extra field in
`client_context` -> 400. P3 Aadhaar/PAN/e-mail/mobile/card in reason/resource_id/refs -> 400, error has path not value.
P4 log capture shows no reason/ref text. P5 reason missing for DECISION/OVERRIDE/PRIVILEGED -> 400.
Sink unavailable / failure path: S1 producer tx writes state + audit outbox row; consumer DB unavailable -> publisher
double reschedules (attempts++), row PENDING; after recovery exactly one ledger row; zero lost across 100 events with
injected 30% failures. S2 producer tx rolls back -> no audit envelope (no phantom audit). S3 HttpAuditSink 503 x3 then
200 -> one row; 503 always -> AuditSinkUnavailableError, `requireAudit` blocks the privileged action. S4 occurred_at far
future -> rejected; past (delayed outbox) accepted with lag metric. S5 recorded_at outside partition window -> insert fails,
nothing partial (key/head/outbox rolled back). S6 unknown `schema_version` on envelope -> explicit rejection.
Migration: M1 up/down/up round trip; M2 rendered outbox template equals migration section; M3 migration_lint passes;
M4 sf_app has no BYPASSRLS and no UPDATE/DELETE grants (catalog query).

## 5. Files to create or modify (all checked against allowed_write_paths)

`services/cmp-031-audit-ledger/**` (allowed): `package.json`, `tsconfig.json`, `vitest.integration.config.ts`,
`README.md`, `contracts/openapi.yaml`, `contracts/asyncapi.yaml`,
`src/index.ts`, `src/plugin.ts`, `src/routes/{post-audit-event,get-audit,get-audit-by-resource}.ts`,
`src/domain/{ledger-writer,chain,verify-chain,clock-guard,errors,query-filters}.ts`,
`src/consumer/handle-envelope.ts`, `src/repo/{tx,ledger-repo,query-repo,outbox-repo}.ts`,
`src/ports/{authz-port,request-context-port}.ts`, `src/cli/verify-chain.ts`, `src/config.ts`,
`test/unit/*.test.ts`, `test/contract/*.test.ts`, `test/integration/*.int.test.ts`
(append-only, tamper, rls-negative, duplicates, pii, sink-unavailable, concurrency, migration, privileged-read),
`test/support/{db,test-double-publisher,producer-schema,fixtures}.ts` (synthetic UUIDs only, no PII).
`packages/audit-client/**` (allowed): `package.json`, `tsconfig.json`, `README.md`,
`src/{index,build-event,envelope,outbox-row,http-sink,require-audit,pii-guard,canonical-json,errors}.ts`, `test/*.test.ts`.
`db/migrations/1759500003000_cmp-031-audit-ledger.sql`, `db/migrations/1759500003100_cmp-031-outbox-inbox.sql`
(match `db/migrations/*_cmp-031-*.sql`). `pnpm-lock.yaml` via `pnpm install` only (workspace links).
Implicit per check_scope.py: `evidence/SF-M01-003/**` (EVIDENCE.md, tamper-detection.log, rls-negative-matrix.md,
junit/*.xml, coverage-summary.json, scope-check.log, gates.log) and `orchestrator/handovers/SF-M01-003.yaml`.
Not modified: contracts/**, packages/contracts/**, packages/observability/**, apps/api/**, db/test/**, db/package.json,
root configs, other components. Root `vitest.config.ts` already includes `services/*/test/**`.

## 6. New third-party dependencies

None. Service uses versions already in the lockfile: `fastify 5.12.5`, `fastify-plugin 5.1.0`, `pg 8.23.1`,
`@types/pg 8.23.1` (dev), plus workspace `@serviceform/contracts`, `@serviceform/observability`,
`@serviceform/audit-client`. Hashing `node:crypto`; HTTP built-in `fetch`; UUID `crypto.randomUUID()`.
Migrations run through the existing `@serviceform/db` scripts (node-pg-migrate 9.0.0). No pg_partman or other extension.

## 7. Open questions and foreseen stop conditions

Q1 (G-11, STOP if required) WORM/anchoring: AWS v1.7 names "S3 Object Lock where policy requires" and "hash
chaining/batch signing optional". The in-DB chain detects edits but not a full rewrite by a superuser. Periodic
head anchoring to Object Lock/KMS is an infrastructure decision; not built, recorded as residual risk.
Q2 Event names: Eng v1.4 `AuditRecorded` vs AWS v1.7 `AuditRecordCreated`; the ingest event (`AuditEventSubmitted`)
and its topic are not named in any spec, and the topic registry is CMP-038's. Need the Contract Guardian to rule
(ADR-0002 gave AWS precedence for envelope fields only).
Q3 Overlap with CMP-038: producers need a shared outbox-insert library (`packages/outbox`). audit-client only builds
validated rows; confirm that is the right split so the two tasks do not duplicate the writer.
Q4 Partition maintenance: sf_app cannot create partitions; who runs `create_month_partitions` ahead of 2027-12
(ops job, CMP-055 scheduler, deploy step)? Fail closed beyond the window is my default.
Q5 `audit_export_job`/export for investigation needs S3 (CMP-032, W2) and has no acceptance test: defer to a later task?
Q6 PII rejection on the consumer path: a rejected envelope cannot succeed on retry. Dead-lettering holds only its own
key (`audit:<id>`), but the producer's audit is then missing until an operator acts. Acceptable, or quarantine table?
Also the error code (SF-SYS-003 vs SF-FORM-002) and detector false positives on numeric resource ids.
Q7 Security boundary (STOP if the security verifier says so): privileged cross-tenant audit read sets the target
tenant server-side after an AuthzPort allow; TI #16 wants an explicit grant capability (CMP-048, not built). Without it
only the deny path + audited attempt is real. Also: should platform audit have a dedicated DB role instead of sf_app?
Q8 `client_context.source_ip`: "only where policy requires and privacy allows" has no policy source; default is to
reject source_ip unless a config flag enables it? Statutory/privacy ambiguity, owner decision.
Q9 Schema naming convention (`cmp031_audit`) and migration timestamp slots across wave-1 to avoid check-order clashes.
Q10 TI s19 says audit records carry "purpose"; the frozen audit-event schema has none. Needs a CCR if required.
Q11 Clock skew tolerance 300 s is a guardian-style default, not from the specs.
Stop conditions foreseen: any frozen contract change (Q2/Q10), WORM decision (Q1), boundary change (Q7),
raw PII storage, retention/archival (CMP-049), need for CMP-038 code, any write outside the paths in s5.
