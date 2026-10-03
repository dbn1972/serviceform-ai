# SF-M01-004 (CMP-038) mandatory negative, deny and isolation tests

Author: security and tenant isolation verifier (Opus, xhigh), 3 Oct 2026. Written before code (MODEL-ROUTING-QUALITY s9).
Inputs: SF-M01-004-plan.md, envelope, PLAN-REVIEW-M01-W1.md (read: Q1 local Kafka 4.1.0 approved, Q2 **no new grant** to
sf_outbox_publisher and registry snapshot shipped in packages/outbox, Q3 retry unregistered, Q5 discard = DELETE after DLQ
with audit), outbox.template.sql, migration 1759490000000, CONTRACT-REVIEW-001 D-02/D-03/D-04.
**PLAN** = in builder plan s6 (ids U/I/K cited); **NEW** = added by verifier. These files go under
`services/cmp-038-event-bus/test/integration/security/` as the plan states. Gates: CTL cross_tenant_leakage, RLS
rls_required_negative_tests, FCC frozen_contract_conformance, UCS unresolved_critical_security, LOST lost_committed_applications.

## H. Harness rules
- H1. Two per-run login roles, each with its own pool: `sf_t004_app LOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app`
  (producer/consumer) and `sf_t004_pub LOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_outbox_publisher` (relay). No case
  runs as postgres or through `SET ROLE` from a superuser session (X-12); the relay's guard must see a real session_user.
- H2. Fixture schemas `sf_t004_a`, `sf_t004_b` rendered from the template by the owner, each with a business table
  `orders(tenant_id, secret_note)` holding canaries and no publisher grant.
- H3. Lost-event invariant used by every fault case: for each committed producer tx, exactly one envelope with its
  event_id is consumed (inbox), and per partition_key the consumed seq order equals the outbox seq order.

## A. Publisher role: exact privilege boundary (D-02)
- **004-01** NEW UCS. As sf_t004_pub: rolsuper=false, rolbypassrls=false, rolcreaterole=false, rolcreatedb=false;
  `pg_has_role(session_user,'sf_app','MEMBER')` and `'USAGE'` false; not member of any table owner.
- **004-02** NEW UCS/FCC. Catalogue diff over all schemas: privileges reachable by sf_t004_pub equal exactly: per
  outbox_event/outbox_event_platform SELECT, DELETE, UPDATE(status, attempts, next_attempt_at, lease_owner,
  lease_expires_at, last_error_code, published_at); USAGE on component schemas and sf_platform; EXECUTE on the three
  accessors. Any extra privilege (including on sf_event_bus.topic/event_schema/consumer_checkpoint, ruling Q2) fails.
- **004-03** NEW UCS/CTL. Runtime denials as pub: INSERT into outbox_event and outbox_event_platform; UPDATE of envelope,
  tenant_id, topic, event_id, partition_key, event_type, created_at; SELECT/INSERT on inbox_event(_platform); SELECT on
  `orders`; `set_config('app.tenant_id', T1, true)` then SELECT `orders`; TRUNCATE outbox; CREATE in any schema;
  `SET ROLE sf_app`; `LOCK TABLE orders`; SELECT sf_event_bus registry tables. Exp: every one 42501.
- **004-04** NEW UCS. Policy check: on tenant outbox tables the only policies are the template's (`*_tenant_insert` TO
  sf_app, `*_publisher` TO sf_outbox_publisher); no policy TO public; no `prosecdef` functions or non-invoker views in
  sf_event_bus; sf_app holds no TRUNCATE/TRIGGER/REFERENCES/CREATE.
- **004-05** NEW UCS. Relay startup guard: start as sf_t004_app (sf_app member), as a superuser, as a BYPASSRLS role, and
  as sf_t004_pub after `SET ROLE` from a superuser session. Exp: refuses each; checks both session_user and current_user;
  static check: no environment variable, option or test flag disables the guard (blocking flaw P-004-1).
- **004-06** PLAN I11 UCS. Full publish cycle as pub with `orders` present: succeeds; static scan of publisher SQL names no
  table other than outbox_event/outbox_event_platform and catalogue views.
- **004-07** NEW UCS. Discovery injection: owner creates schemas named `x"; DROP TABLE sf_t004_a.orders; --` and
  `a'b` with template tables granted to pub; a VIEW named outbox_event granted to pub; a table named outbox_event in a
  schema outside the configured allowlist. Exp: quoted identifiers work, orders intact; view ignored (relkind r/p only);
  non-allowlisted schema ignored.

## B. Producer helper (rules 1, 2)
- **004-08** PLAN I1/I2/I3 CTL/LOST. Rollback leaves no row; commit one row published once; ctx T1 + envelope T2:
  SF-TEN-002 no row; no ctx: SF-TEN-001; RLS backstop when the guard is bypassed; invalid envelope: SF-SYS-003 no row.
- **004-09** NEW UCS. Identifier injection into `insertOutboxEvent({schema})`: `sf_t004_a; DROP`, `"sf_t004_a"`,
  `sf_t004_a.outbox_event--`, `pg_catalog`, 64+ chars, uppercase. Exp: rejected before SQL by an identifier allowlist
  pattern; topic `../x`, 250 chars, empty: rejected.
- **004-10** NEW UCS/CTL. Platform event from a tenant-context tx (fix P-004-3): AuditEventSubmitted or SecurityPolicyPublished
  with tenant_id null inside a T1 tx. Exp: refused unless the event type is on the producer's configured platform allowlist
  (empty by default).
- **004-11** NEW FCC. As sf_t004_app raw SQL: column tenant T1 with envelope tenant T2: CHECK; platform table with non-null
  envelope tenant: CHECK; `INSERT ... RETURNING`, `ON CONFLICT DO UPDATE`, SELECT, UPDATE, DELETE on outbox: 42501.
- **004-12** NEW UCS. Envelope at 262,144 bytes accepted, 262,145 rejected; multibyte payload counted in bytes not chars.

## C. Consumer helper (rule 5)
- **004-13** PLAN I9/I10 CTL. Duplicate delivery applied once; platform event uses platform inbox; handler sees
  current_tenant_id() = envelope tenant; T1 inbox rows invisible to T2.
- **004-14** NEW CTL/UCS. Forged messages: tenant-scoped topic carrying envelope tenant_id null; platform topic carrying
  tenant T1; `sf-tenant-id` header != envelope tenant; envelope tenant `''`, uppercase, nil uuid. Exp: consumer DLQ, no
  handler call, no inbox row, offset committed.
- **004-15** NEW CTL. One backend (`max:1`): T1 message, platform message, T2 message. Exp: platform handler sees
  current_tenant_id() NULL; no residual T1 setting in T2.
- **004-16** NEW LOST. Handler throws: rollback, no inbox row, redelivered and applied once; process killed after DB commit
  and before offset commit: redelivered, inbox dedupes, applied once.

## D. Relay correctness under faults and races
- **004-17** PLAN I5-I8/I13 LOST. Interleaved ordering with 3 publishers; dead letter holds its key, replay in order;
  broker down/up no loss; lease-expiry redelivery, late mark affects 0 rows; purge keeps PENDING/DEAD_LETTERED.
- **004-18** NEW LOST. Purge concurrent with claims and with replay DEAD_LETTERED->PENDING (1,000 rows): the DELETE
  predicate is `status='PUBLISHED' AND published_at < ...` in the same statement; zero PENDING/DEAD_LETTERED deleted.
- **004-19** NEW LOST/UCS. Publisher DELETE scope (frozen grant allows deleting any row): static check that the only DELETEs
  are purge (PUBLISHED) and discard (DEAD_LETTERED with a recorded DLQ acknowledgement); discard of a row not yet on the DLQ
  topic: refused, row kept.
- **004-20** NEW LOST. Lost-lease failure path: A claims, lease expires, B publishes and marks; A then reports a transport
  failure. Exp: A's retry/backoff UPDATE is conditioned on `lease_owner=A AND status='PENDING'` and affects 0 rows; the row
  stays PUBLISHED (no reset to PENDING, no duplicate attempts).
- **004-21** NEW LOST. Two relays configured with the same workerId: leases distinct (random suffix) or second refuses start.
  Application clock skewed +10 min: no early reclaim (lease arithmetic uses DB now()).
- **004-22** NEW LOST. DLQ publish fails: row stays PENDING with a retry, never DEAD_LETTERED without DLQ ack; 1,000
  transient failures never dead-letter; unregistered topic retried with last_error_code (Q3), not lost.
- **004-23** NEW UCS. SIMULATED (in-memory) transport with SF_ENVIRONMENT = PRODUCTION, UAT, PREPROD, unset, empty,
  `production`, ` PRODUCTION`: refused (fail closed when unset or not an exact D-04 value).
- **004-24** NEW CTL. DLQ keeps tenancy: a tenant event lands only on `<topic>.dlq` of a TENANT_SCOPED topic with
  sf-tenant-id preserved; never on a platform DLQ.

## E. Operator actions, registry, leakage
- **004-25** NEW UCS/LOST. Replay/discard (fix P-004-2): without PRIVILEGED_ADMIN, MFA, reason and authz allow: refused,
  row unchanged; the audit record (AuditEventSubmitted / DeadLetterReplayed|Discarded) commits **before** the row changes
  and the action does not run if that audit commit fails; no code path performs these as plain sf_outbox_publisher without
  a prior committed audit.
- **004-26** PLAN I14 FCC. Incompatible schema registration fails explicitly; event_schema UPDATE/DELETE refused; sync idempotent.
- **004-27** NEW UCS. Registry writes from a non-CMP-038 sf_app login (fix X-1): INSERT topic/event_schema 42501, or, if
  the cross-cutting fix is rejected, documented residual; publisher decisions come only from the shipped snapshot (Q2): a
  row inserted into sf_event_bus.topic does not change relay behaviour.
- **004-28** NEW UCS. Leakage canary: canary in envelope `data` and in `orders`; capture relay/consumer logs, metric
  attributes and spans across all suites. Exp: no canary, no tenant_id/event_id/partition_key in metric attributes, DLQ
  logs show error code and event_id only.
- **004-29** PLAN K1-K5 LOST. Real Kafka 4.1.0 (ruling Q1): publish/consume with dedupe, ordering, broker kill/restart no
  loss, DLQ poison, real lag. Must execute; a skip is a failed gate for this task.
- **004-30** PLAN I16 FCC. Round trip; migration_lint; template tables byte-identical after substitution.

Totals: 30 cases, 23 NEW, 7 PLAN.
