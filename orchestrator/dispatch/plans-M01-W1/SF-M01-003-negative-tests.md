# SF-M01-003 (CMP-031) mandatory negative, deny and isolation tests

Author: security and tenant isolation verifier (Opus, xhigh), 3 Oct 2026. Written before code (MODEL-ROUTING-QUALITY s9).
Inputs: SF-M01-003-plan.md, envelope, PLAN-REVIEW-M01-W1.md (read: schema `sf_audit`, X-4 `AuditEventSubmitted` on
`sf.audit.ingest.v1`, X-5 `AuditRecordCreated`, Q4 ensure_partitions, Q6 PII dead-letter `PII_FIELD_REJECTED`, Q7 deny path
only for cross-tenant read, Q8 client_context dropped), contracts, migrations, outbox template.
**PLAN** = in builder plan s4 (ids N/T/W/D/P/S/M cited); **NEW** = added by verifier. Gates: CTL cross_tenant_leakage, RLS
rls_required_negative_tests, FCC frozen_contract_conformance, UCS unresolved_critical_security,
LOST lost_committed_applications (zero lost audit records in failure tests).

## H. Harness rules
- H1. Per-run login roles: `sf_t003_rt LOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app` (generic component) and, if
  the orchestrator accepts fix P-003-2, `sf_t003_writer` in the CMP-031 writer role. Separate pools; never postgres, never
  `SET ROLE` from a superuser session (X-12). beforeAll: rolsuper/rolbypassrls false, session_user=current_user, not a
  member of the sf_audit table owner (`pg_has_role(session_user, relowner, 'MEMBER')=false`).
- H2. Only the tamper cases (T-series) use the owner/superuser connection, and only to simulate an attacker with
  storage access; they never assert isolation.
- H3. Pool-reuse cases use `max:1` and record pg_backend_pid().

## A. Append-only and owner bypass
- **003-01** NEW RLS/UCS. H1 identity assertions. Exp: true or the suite fails.
- **003-02** PLAN N1-N7 UCS. rt UPDATE/DELETE/TRUNCATE on audit_event (parent and a partition), key and platform tables:
  42501; owner UPDATE/DELETE/TRUNCATE: P0001 trigger; rt cannot UPDATE head columns beyond the three or DELETE head rows.
- **003-03** NEW UCS/CTL. Partitions: after `ensure_partitions()` adds months, every partition (old and new) has
  relrowsecurity and relforcerowsecurity, the UPDATE/DELETE and TRUNCATE triggers, and zero grants; rt SELECT/INSERT
  directly on each partition: 42501; rt `ALTER TABLE ... ATTACH/DETACH PARTITION`: 42501; rt cannot EXECUTE
  ensure_partitions or create_month_partitions. (Partitions created by function escape migration_lint; this is the control.)
- **003-04** NEW UCS. Owner-bypass attempts as rt: `ALTER TABLE sf_audit.audit_event DISABLE TRIGGER ALL`,
  `SET session_replication_role = replica` then UPDATE, `DROP TRIGGER`, `CREATE OR REPLACE FUNCTION` of the trigger
  function, `SET ROLE <owner>`. Exp: all refused. Catalogue: no `prosecdef` function in sf_audit, trigger functions have a
  fixed search_path, no views or all `security_invoker=true`, sf_app has no TRUNCATE/TRIGGER/REFERENCES/CREATE.
  EVIDENCE.md must say the table owner can disable triggers (the plan's "stop even the owner" is wrong) and that no
  runtime role is or can become the owner.
- **003-05** NEW UCS. Forged append through the shared sf_app grant (fix P-003-2): rt (a non-CMP-031 component login)
  reads head, computes a correct row_hash, INSERTs a ledger row + key row and UPDATEs the head. Exp: 42501 on INSERT and
  UPDATE (grants held only by the CMP-031 writer role). If the orchestrator rejects the fix, this case stays as a recorded
  UCS residual with the test marked expected-fail and named in the handover.
- **003-06** NEW UCS. Head rewind as the writer role: UPDATE head to last_seq-1, to a different last_hash, or with
  last_recorded_at in the past. Exp: refused by a trigger (seq strictly +1 and last_hash = row_hash of the new row's key).

## B. Tamper evidence and chain races
- **003-07** PLAN T1-T7 UCS. Modified record, deleted row (gap), swapped hashes, truncated tail, edited source of a
  generated column: each detected with the seq named; clean 1,000-row chain OK; 50 concurrent writers same tenant give
  seq 1..50 contiguous; two tenants independent.
- **003-08** NEW UCS. Canonicalisation: 1,000 random events including emoji, combining characters (NFC vs NFD stored as
  sent), escaped vs literal `/`, key order permutations: verify recomputes from the jsonb read back and matches. `\u0000` in
  any string: 400 SF-SYS-003, not 500.
- **003-09** NEW UCS. Backdating: event with occurred_at 30 days ago is accepted but gets recorded_at = server time,
  seq = head+1; verify order by seq is monotonic in recorded_at; occurred_at beyond +300 s skew rejected.
- **003-10** NEW UCS. Partition window: recorded_at outside created partitions fails; no key, head or outbox row persists
  (one tx); outbox row of the producer stays PENDING and succeeds after ensure_partitions (no loss).

## C. Tenant isolation and platform tables
- **003-11** PLAN W1-W9 RLS/CTL. A reads B via GET /audit and GET by resource: empty, no 403 existence leak; A inserts
  tenant_id B: 42501; body tenant B with ctx A: 403 SF-TEN-002; unset: 0 rows / insert fails; '' reused session: 0 rows;
  tenant ctx cannot read/write platform tables; platform ctx cannot read tenant tables; data.tenant_id != envelope tenant:
  rejected; tenant_id query param ignored.
- **003-12** NEW CTL/UCS. Unset-context platform leak (fix P-003-1): rt with no tenant set, and with '' on a reused backend,
  SELECT audit_event_platform. Exp: 0 rows or 42501. Under the current design this returns every platform record; the
  test is written to fail until fixed.
- **003-13** NEW CTL. Full RLS matrix as rt for audit_event, audit_event_key, audit_chain_head, inbox_event x S/I/U/D x
  {own, other, unset, ''}; generated into rls-negative-matrix.md.
- **003-14** NEW CTL. Security-barrier ordering: rt under T1 `SELECT ... FROM audit_event WHERE pg_temp.leak(action)` and
  `WHERE 1/(CASE WHEN resource_id LIKE 'CANARY-T2%' THEN 0 ELSE 1 END)=1`: notices only T1, no error. After ANALYZE,
  pg_stats shows no sf_audit RLS table rows to rt.
- **003-15** NEW CTL. Existence oracle: T1 POSTs an audit_id already used by T2: 201 stored for T1 (PK includes tenant), not
  409; GET /audit/{type}/{T2 resource id} under T1 equals the response for a random id.
- **003-16** NEW CTL. Pool reuse in the consumer: one backend handles T1 envelope, T2 envelope, platform envelope, T1 again.
  Exp: each handler sees `current_tenant_id()` equal to its envelope (NULL for platform); each chain gets only its rows.

## D. Privileged cross-tenant read (ruling Q7: deny path only in W1)
- **003-17** PLAN W10/W11 UCS. Without authz allow: 403 SF-AUTH-002 and a platform attempt record; allow without reason:
  400; platform audit insert failure: read refused.
- **003-18** NEW CTL/UCS. With a stub AuthzPort that returns allow, any request carrying target_tenant_id still gets 403
  (no CMP-048 grant capability in W1); SQL spy shows set_config was never called with the target; attempt recorded.

## E. Ingestion integrity and forged attribution
- **003-19** NEW UCS. Actor binding on POST /internal/audit-events (fix P-003-4): a USER/OFFICER ctx submitting actor_id,
  actor_type, cell_id or correlation_id different from its ctx: 403; only the approved INTEGRATION relay actor with its
  purpose code may submit on behalf, and only for its own tenant.
- **003-20** NEW UCS. Platform-chain forgery (fix P-003-3): an AuditEventSubmitted with tenant_id null and actor_type
  PRIVILEGED_ADMIN arriving from a producer source not on the platform allowlist (`sf-source` schema), or built by
  audit-client from a ctx that has a tenant. Exp: audit-client throws; consumer rejects to DLQ, nothing stored.
- **003-21** NEW FCC. Consumer rejects: event_type != AuditEventSubmitted, schema_version != 1, aggregate_id != data.audit_id,
  aggregate_type != AuditEvent, data with extra keys, data.correlation_id != envelope correlation_id. Each explicit.
- **003-22** PLAN D1-D4. Same id twice: one row, 200; different content 409 SF-APP-002; redelivery: inbox conflict, one row;
  two concurrent same id: one row.
- **003-23** NEW UCS. Concurrent same id with different content: exactly one 201 and one 409, never two rows; kill
  between ledger insert and commit: retried, one row.

## F. PII guard and leakage
- **003-24** PLAN P1-P5 UCS. Extra top-level and client_context fields rejected; Aadhaar/PAN/e-mail/mobile/card in
  reason/refs rejected with path not value; logs lack reason/ref text; reason required for DECISION/OVERRIDE/PRIVILEGED.
- **003-25** NEW UCS. PII detector evasion in reason/before_ref/after_ref: Aadhaar as `1234 5678 9012`, `1234-5678-9012`,
  fullwidth digits, Devanagari digits, zero-width joiners between digits; e-mail as `a%40b.in`, `a [at] b.in`; lowercase
  PAN. Exp: each rejected (or the gap is listed in EVIDENCE.md with the residual-risk owner). Ids are never scanned (Q6).
- **003-26** NEW UCS. client_context (ruling Q8): sent with source_ip/device_id: accepted, not stored (DB column/record has
  none), metric counted; the stored record still validates against SF-CON-AUDIT-EVENT.
- **003-27** NEW UCS. Canary scan over logs, error bodies, metric labels, span attributes, AuditRecordCreated data, DLQ
  messages and last_error_code: no reason, ref or canary text; logs carry only audit_id, tenant_id, action, result, trace_id.
- **003-28** NEW UCS/CTL. Query injection: `action=X' OR '1'='1`, resource_type `%`/`_` wildcards, path `..%2f`, from>to,
  range > 31 days, limit 0/201/-1/1e9, cursor from T2 or edited to T2's (recorded_at, chain_seq). Exp: 400 or own rows
  only; no column or ORDER BY built from input (static check).

## G. Failure paths and migration
- **003-29** PLAN S1-S6 LOST. Consumer DB down: rows stay PENDING, one ledger row after recovery; 100 events with 30%
  injected failures: zero lost; producer rollback: no audit envelope; HttpAuditSink 503x3 then 200: one row, always 503:
  requireAudit blocks the privileged action; unknown schema_version rejected.
- **003-30** NEW LOST. PII-rejected envelope dead-letters with key `audit:<id>` only: the next audit of the same tenant
  publishes and is stored (no tenant-wide stall).
- **003-31** PLAN M1-M4 FCC. Round trip; outbox section equals rendered template; migration_lint; sf_app has no BYPASSRLS
  and no UPDATE/DELETE on ledger tables.

Totals: 31 cases, 23 NEW, 8 PLAN.
