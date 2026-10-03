# SF-M01-004 implementation plan (PHASE 1 — PLAN ONLY)

Status: **IMPLEMENTING** (revision 2 plan, approved). Role creation uses idempotent `DO $$ … IF NOT EXISTS (pg_roles) … CREATE ROLE` blocks — PostgreSQL has no `CREATE ROLE IF NOT EXISTS`.

**Rev 2 (orchestrator finding):** `topic` / `event_schema` / `consumer_checkpoint` are **GRANT-only**. Do **not** ENABLE RLS on them (zero-policy RLS would also deny CMP-038 runtime and fail 004-P1). ADR-0006 requires FORCE RLS only on TENANT_SCOPED tables. Peers still fail with 42501 from missing GRANT.

| Field | Value |
|---|---|
| Task | SF-M01-004 |
| Component | CMP-038 Event Bus / Messaging Platform |
| Integrations | INT-011 (tenant isolation on the event path), INT-013 (SIMULATED transport parity / mode refusal) |
| Builder | serviceform-foundation-builder |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` |
| Branch | `agent/M01-cmp-038-event-bus-SF-M01-004` |
| Binding docs | Envelope `orchestrator/tasks/SF-M01-004.yaml`; PLAN-REVIEW-M01-W1; SECURITY-PRECHECK-M01-W1; dispatch plan + negative tests; **ADR-0006 ACCEPTED Option A** |
| Privilege role | **`sf_cmp038_rw`** (normative; supersedes PLAN-REVIEW name `sf_event_bus_rw`) |

This plan **adopts** the dispatch sketch `orchestrator/dispatch/plans-M01-W1/SF-M01-004-plan.md` and the mandatory cases in `SF-M01-004-negative-tests.md`, then **replaces** Wave 1 privilege modelling with ADR-0006 conditions 1–10. Frozen contracts are not edited. SF-CON-OUTBOX is copied **byte-for-byte** after `{schema}`/`{cmp}` substitution.

---

## 0. Write-path and freeze constraints

Allowed writes only:

- `services/cmp-038-event-bus/**`
- `packages/outbox/**`
- `db/migrations/*_cmp-038-*.sql`

Implicitly allowed by `check_scope.py` at evidence time (not this PR): `evidence/SF-M01-004/**`, `orchestrator/handovers/SF-M01-004.yaml`.

**Do not write:** `pnpm-lock.yaml` (read-only; restore if `pnpm install` dirties it; lockfile reconciliation is orchestrator/integration). Frozen `contracts/**`, Constitution, ADRs, other components, root manifests, `.github/**`, `infra/**`, `db/test/**`, `packages/contracts/**`, `packages/observability/**`.

**Do not:** self-certify, start Wave 2, merge, tighten/change frozen outbox grants, grant registry SQL to `sf_outbox_publisher`, import unmerged sibling component code.

Scope check after implementation: `python scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-004.yaml --base origin/main`.

---

## 1. Impact plan (AGENTS.md task loop step 2)

| Aspect | Impact |
|---|---|
| Module / IDs | M01; CMP-038; INT-011; INT-013. Requirements: AWS v1.7 §4.3 / §4.5 outbox / §4.6 partitioning + lag / §13.2; Eng v1.4 CMP-038 (topic governance, schema versioning, partitioning, outbox ingestion, retry/DLQ, lag); TI v1.0 §13; Constitution #6, #11, #21, #23, #24; ADR-0002 envelope; ADR-0006 privilege layer; CONTRACT-REVIEW D-01..D-05. |
| Domain | Not authoritative business state. Owns topic registry, event-schema metadata, consumer checkpoint metadata, CMP-038’s own outbox/inbox (template), relay/publisher process, producer and inbox helpers in `@serviceform/outbox`. |
| Data | Schema `sf_event_bus` (PLAN-REVIEW X-2). Three CMP-038 registry tables with DML **only** to `sf_cmp038_rw`. Four template tables copied unchanged (grants stay on `sf_app` / `sf_outbox_publisher` as frozen). Relay touches **other components’** `outbox_event*` **only** through frozen `sf_outbox_publisher` grants (D-02; Constitution #23 exception already frozen). No business-table SQL. |
| APIs / events | No end-user REST in W1 (Eng: AsyncAPI; apps/api mount is W2/CMP-036). Library API in `@serviceform/outbox`. CLI/process: `registry:sync`, relay `main`, lag monitor. Platform events: `TopicRegistered`, `EventSchemaRegistered`, `DeadLetterReplayed`, `DeadLetterDiscarded` (`tenant_id` null, `sf_event_bus.outbox_event_platform`, topic `sf.eventbus.platform.v1`). Audit of operator actions: `AuditEventSubmitted` on producer outbox per PLAN-REVIEW X-4 (`sf.audit.ingest.v1`) **before** replay/discard (P-004-2). |
| Tenancy / authz | Producer: `dbSessionSettings(ctx)` then RLS INSERT. Tenant envelope vs session: SF-TEN-001 / SF-TEN-002. Publisher is the approved cross-tenant service (D-02): login ∈ `sf_outbox_publisher` only — **not** `sf_app`, **not** `sf_cmp038_rw`, never SUPERUSER/BYPASSRLS. Consumer sets session from validated envelope. Operator replay/discard: CMP-038 runtime login (`sf_app` + `sf_cmp038_rw`) + PRIVILEGED_ADMIN + MFA + reason + injected `AuthorizationPort`; audit commit first. No tenant_id in metric attributes. |
| Migration | `db/migrations/1759500400000_cmp-038-event-bus.sql` (band `17595004xxxxx`, PLAN-REVIEW X-1; after `1759490000000`). Creates `sf_migrator` if missing (idempotent `DO $$` / `pg_roles` check — not `CREATE ROLE IF NOT EXISTS`), `sf_cmp038_rw`, schema, tables, FORCE RLS on **TENANT_SCOPED** outbox/inbox via template only, **no RLS** on the three registry tables, PUBLIC revoke, default privileges. |
| Tests | Security cases 004-01..004-30 first (test-before-code). ADR-0006 cases 004-P1..004-P10. Unit + PG 16 integration + real Kafka 4.1.0 (Q1 approved). |
| Observability | `metrics.getMeter('@serviceform/outbox')` via `@opentelemetry/api` after `startTelemetry()` (Q4 approved). Logs via `createLogger()` (redaction). Lag gauges + `consumer_checkpoint` upserts. |
| Rollback | Revert branch. Down migration drops `sf_event_bus` objects and `sf_cmp038_rw` if unused (dev/CI). Stopping the relay is safe: PENDING rows remain; no committed event is lost. Kafka topics are operator-owned (do not delete on down). Production data rollback is forward-fix only. |

**INT-011:** tenant context on events is immutable (envelope + CHECK + RLS). Consumer applies only under envelope tenant. Forged headers / class mismatch → consumer DLQ, no handler, no inbox row. Cross-tenant SELECT on tenant inbox returns empty.

**INT-013:** `EventTransport.mode` is `REAL` or `SIMULATED`. In-memory transport is SIMULATED and **fail-closed** unless `SF_ENVIRONMENT` is exactly one of LOCAL, CI, DEVELOPMENT, SIT, PERFORMANCE (D-04). Unset / empty / case variants / PRODUCTION / UAT / PREPROD refused. No SQS vs MSK split (stop condition if requested).

---

## 2. Schema and tables (isolation classes)

Schema: `sf_event_bus` — `-- sf:schema sf_event_bus PLATFORM_OPERATIONAL owner=CMP-038`.

Owner of schema and all tables: **`sf_migrator`** (NOLOGIN, NOSUPERUSER, NOBYPASSRLS, not an application identity). Created with an idempotent `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN CREATE ROLE …; END IF; END $$` block so sibling Wave 1 migrations can share it. PostgreSQL does not support `CREATE ROLE IF NOT EXISTS`. Runtime logins never own objects (ADR-0006 #5). No competing writer: M00 baseline does not create `sf_migrator`.

### 2.1 CMP-038 authoritative tables (ADR-0006 DML → `sf_cmp038_rw` only)

| Table | Isolation | DML | Notes |
|---|---|---|---|
| `sf_event_bus.topic` | PLATFORM_OPERATIONAL owner=CMP-038 | SELECT, INSERT, UPDATE(status, … non-key ops as needed) to **`sf_cmp038_rw` only** | PK `topic_name`; `owner_component`; `tenancy` TENANT_SCOPED \| PLATFORM_OPERATIONAL; `partition_key_strategy` AGGREGATE_ID \| DECLARED; partitions; replication; broker/outbox retention; replay_class; compatibility BACKWARD \| FORWARD \| FULL; `dlq_topic` NOT NULL; status ACTIVE \| DEPRECATED. **No GRANT to `sf_app`. No RLS.** |
| `sf_event_bus.event_schema` | PLATFORM_OPERATIONAL owner=CMP-038 | SELECT, INSERT to **`sf_cmp038_rw` only** | PK `(topic_name, event_type, schema_version)`; `data_schema jsonb`; INSERT-only. Trigger refuses UPDATE/DELETE (published versions immutable). **No GRANT to `sf_app`. No RLS.** |
| `sf_event_bus.consumer_checkpoint` | PLATFORM_OPERATIONAL owner=CMP-038 | SELECT, INSERT, UPDATE to **`sf_cmp038_rw` only** | PK `(consumer_group, topic_name, partition)`; offsets + lag. Written by lag monitor on the **CMP-038 runtime login**, never by the publisher role. **No GRANT to `sf_app`. No RLS.** |

**Registry isolation is GRANT-only (orchestrator ruling, rev 2).** Do **not** `ENABLE ROW LEVEL SECURITY` on `topic`, `event_schema`, or `consumer_checkpoint`. ADR-0006 condition 6 requires FORCE RLS only on TENANT_SCOPED tables. Zero-policy / deny-default RLS on these PLATFORM_OPERATIONAL tables would hide rows from the table owner’s non-owner runtime as well (`FORCE` is not the issue; default-deny with no `TO sf_app`/`TO sf_cmp038_rw` policy still blocks 004-P1). Peers and `sf_app`-only logins still get **42501** from missing GRANT. `REVOKE ALL … FROM PUBLIC` and revoked default privileges remain. RLS policies stay `TO sf_app` only where the frozen outbox/inbox template already creates them.

Do not take the alternative (`ENABLE RLS` + `USING (true) WITH CHECK (true) TO sf_app`) unless the orchestrator reverses this ruling: that would let every `sf_app` member pass RLS and would require DML grants on registry tables to `sf_app`, contradicting ADR-0006 condition 1.

### 2.2 Frozen outbox/inbox (copy template unchanged — ADR-0006 #9)

Copy `contracts/shared/sql/outbox.template.sql` with `{schema}`=`sf_event_bus`, `{cmp}`=`CMP-038`. **Do not add columns, policies, or grants.** Residual (recorded, not “fixed” here): template `GRANT INSERT` / inbox SELECT,INSERT **to `sf_app`**; publisher SELECT, DELETE, column UPDATE **to `sf_outbox_publisher`**. Tightening needs a CCR (P-004-4: DELETE policy).

| Table | Isolation | Grants (frozen) |
|---|---|---|
| `outbox_event` | TENANT_SCOPED | ENABLE + **FORCE RLS**; INSERT `sf_app`; publisher SELECT/DELETE/UPDATE(status, attempts, next_attempt_at, lease_owner, lease_expires_at, last_error_code, published_at) |
| `outbox_event_platform` | PLATFORM_OPERATIONAL | INSERT `sf_app`; same publisher grants; no tenant RLS (null-tenant CHECK) |
| `inbox_event` | TENANT_SCOPED | ENABLE + **FORCE RLS**; SELECT, INSERT `sf_app` |
| `inbox_event_platform` | PLATFORM_OPERATIONAL | SELECT, INSERT `sf_app` |

Also from template: `GRANT USAGE ON SCHEMA {schema} TO sf_outbox_publisher`. Additionally (schema-level, not a table-grant change to the template): `GRANT USAGE ON SCHEMA sf_event_bus TO sf_app, sf_cmp038_rw` so producers can INSERT outbox and CMP-038 can reach registry tables. **No** `GRANT SELECT` on `topic`/`event_schema` to `sf_outbox_publisher` (PLAN-REVIEW Q2).

Byte-identical check after substitution is acceptance test I16 / 004-30.

### 2.3 Roles (normative)

| Role | Kind | Attributes | Membership |
|---|---|---|---|
| `sf_cmp038_rw` | NOLOGIN group | NOSUPERUSER NOCREATEDB NOCREATEROLE **NOBYPASSRLS** | none of `sf_app`, other `_rw`, `sf_outbox_publisher` |
| CMP-038 runtime LOGIN (deploy/CI: `sf_cmp038_app` / test `sf_t004_app`) | LOGIN | NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE | **`sf_app`, `sf_cmp038_rw` only** |
| Relay LOGIN (test `sf_t004_pub`) | LOGIN | NOSUPERUSER NOBYPASSRLS | **`sf_outbox_publisher` only** (template rule 3) |
| `sf_migrator` | NOLOGIN (or equivalent) | NOSUPERUSER NOBYPASSRLS | owns schema/tables; never used as app runtime |
| Peer `_rw` roles | test harness only | — | created in tests for deny cases; **not** granted to CMP-038 logins; **not** created as a production side-effect of this migration except we do **not** CREATE other components’ `_rw` in the up migration |

Relay startup guard (P-004-1, **no disable flag**): refuse if `session_user` or `current_user` is superuser, has BYPASSRLS, is a member of `sf_app`, is a member of any `sf_cmp*_rw`, or is table/schema owner.

---

## 3. APIs and events mapped to Eng v1.4 CMP-038

| Eng responsibility | W1 surface |
|---|---|
| Topic governance | `registry/topics.json` + `registry:sync`; table `topic`; events `TopicRegistered` |
| Schema / versioning | `event_schema` INSERT-only; compatibility function; incompatible → `RegistryError` SF-SYS-003 + `SCHEMA_INCOMPATIBLE` (no new error family, X-8) |
| Partitioning | `partition_key` = `aggregate_id` unless DECLARED; Kafka key = partition_key; murmur2 |
| Outbox ingestion | `@serviceform/outbox` producer INSERT in caller tx; relay claim/publish/mark |
| Retry / DLQ | retryable → backoff, never DLQ; fatal → `<topic>.dlq` then DEAD_LETTERED; DLQ fail → stay PENDING (004-22) |
| Lag monitoring | admin offsets → `consumer_checkpoint` + OTel gauges |
| Failure modes | lag, poison, broker outage, duplicate delivery: tests I7/I8/I9/K3/K4 + lost-event invariant H3 |

Library (`@serviceform/outbox`) — dispatch plan §2 remains the API, with these **deltas**:

1. **No test flag** to skip the role guard (P-004-1).
2. **TopicRegistryReader** is satisfied by a **shipped snapshot** in `packages/outbox` generated from `services/cmp-038-event-bus/registry/topics.json`. Publisher **must not** SQL-read `sf_event_bus.topic` / `event_schema` (Q2). A row inserted into DB registry must **not** change relay behaviour until snapshot regen (004-27).
3. **Platform events from a tenant-context tx** are refused unless the event type is on a per-producer allowlist, default empty (P-004-3 / 004-10).
4. Retry/backoff UPDATE is `WHERE lease_owner = $worker AND status = 'PENDING'` (P-004-6 / 004-20).
5. Only DELETEs: purge (`status='PUBLISHED' AND published_at < …`) and discard (`status='DEAD_LETTERED'` after recorded DLQ ack) (004-19).
6. Identifier allowlist before SQL (004-09). No `SET ROLE` from superuser in tests (H1 / X-2).

Operator replay/discard (P-004-2):

1. CMP-038 runtime login checks PRIVILEGED_ADMIN + MFA + reason + `AuthorizationPort`.
2. Commit `AuditEventSubmitted` + `DeadLetterReplayed`/`DeadLetterDiscarded` to **this** component’s platform outbox in that login’s transaction.
3. Only then signal the relay to UPDATE (replay → PENDING, attempts kept) or DELETE (discard after DLQ ack). If audit commit fails, no action.
4. Publisher role never INSERTs outbox rows (frozen: no INSERT grant).

---

## 4. Kafka / transport and dependencies

**Broker evidence:** Apache Kafka **4.1.0** KRaft from tarball in `/var/tmp/kafka` (PLAN-REVIEW Q1). `infra/**` is read-only; do not add compose services. Real-broker tests are **mandatory** (004-29); skip = failed LOST gate.

**Client:** `kafkajs` **2.2.4** (MIT, zero transitive dependencies, no native `install` script — required because root `onlyBuiltDependencies` is read-only). Exact pin. Replaces `@platformatic/kafka` 2.12.1: every published version of that client depends on `@platformatic/wasm-utils@^0.2.1`, which workspace `trustPolicy: no-downgrade` rejects (OIDC trusted-publishing provenance present on `0.1.0` and removed on `0.2.1`). Policy is not disabled; no owner exception requested. Workspace pins: `pg` 8.23.1, `@types/pg` 8.23.1, `@opentelemetry/api` 1.9.1, `@serviceform/contracts` / `@serviceform/observability` `workspace:*`. Dev: `@opentelemetry/sdk-metrics` 2.11.0 for `InMemoryMetricExporter`. **No Fastify** in this task. **Do not commit `pnpm-lock.yaml`.** After package.json changes, orchestrator regenerates the lockfile.

Transport interface and SIMULATED/REAL behaviour: dispatch plan §3.2, plus 004-23 fail-closed.

---

## 5. ADR-0006 mapping (conditions 1–10) — executable in this component

| # | Condition | CMP-038 plan |
|---|---|---|
| 1 | `sf_app` holds no generic DML on component-authoritative tables | No INSERT/UPDATE/DELETE on `topic`, `event_schema`, `consumer_checkpoint` to `sf_app`. Outbox/inbox DML to `sf_app` is **frozen template residual** (condition 9), not “generic” registry DML. |
| 2 | `_rw` is NOLOGIN | `CREATE ROLE sf_cmp038_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` |
| 3 | Runtime LOGIN inherits only `sf_app` + own `_rw` | Test + deploy docs. Relay LOGIN is **not** that runtime; it inherits publisher only. |
| 4 | No SUPERUSER / BYPASSRLS | Role attrs + 004-01 / 004-P5 |
| 5 | Runtime is not table owner | `ALTER SCHEMA/TABLE OWNER TO sf_migrator`; 004-P6 |
| 6 | FORCE RLS on TENANT_SCOPED only | Template `outbox_event` / `inbox_event` ENABLE+FORCE. Registry tables: **no RLS** (GRANT-only). Lint + 004-P7 |
| 7 | Cross-component SQL default DENY | No grants to other `_rw` or other CMP logins; publisher has no registry SELECT; 004-P3 / 004-27 / 004-03 |
| 8 | PUBLIC + default privileges | `REVOKE ALL ON SCHEMA/TABLES/SEQUENCES FROM PUBLIC`; `ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_event_bus REVOKE ALL ON TABLES, SEQUENCES FROM PUBLIC, sf_app`; 004-P8 |
| 9 | Preserve SF-CON-OUTBOX | Copy template unchanged; 004-30 |
| 10 | Privilege-boundary suite | §6.2 |

Lost committed events (hard gate): H3 on every fault test; evidence `outbox-atomicity.log`, `broker-outage.log`, `ordering.log`, `privilege-boundary.log`.

---

## 6. Tests (test-before-code)

Harness **H1–H3** from `SF-M01-004-negative-tests.md` is mandatory. Three real LOGIN pools; never `SET ROLE` from superuser.

### 6.1 Security verifier cases (004-01 … 004-30)

Implement files under `services/cmp-038-event-bus/test/integration/security/` **matching the verifier list unchanged**. Includes publisher catalogue exact-match (004-02): publisher privileges = frozen outbox grants + schema USAGE + three accessors — **any extra privilege including registry SELECT fails**. Real Kafka K1–K5 (004-29) must execute.

### 6.2 ADR-0006 privilege-boundary suite (NEW vs dispatch plan)

Run as CMP-038 runtime LOGIN `sf_t004_app` (`IN ROLE sf_app, sf_cmp038_rw`) unless noted. Evidence: `evidence/SF-M01-004/privilege-boundary.log`.

| ID | Assert |
|---|---|
| **004-P1** | Own authorized DML succeeds under GRANT-only registry access (no RLS on those tables): INSERT/SELECT topic + event_schema; UPSERT consumer_checkpoint; INSERT own outbox (via frozen `sf_app` INSERT) in a tenant tx. |
| **004-P2** | Wrong-tenant: envelope T2 with context T1 → SF-TEN-002 / RLS, no row; T2 cannot see T1 `inbox_event`. |
| **004-P3** | Peer login `IN ROLE sf_app, sf_cmp002_rw` (harness): SELECT/INSERT/UPDATE/DELETE on `sf_event_bus.topic`, `event_schema`, `consumer_checkpoint` → **42501 from missing GRANT** (not RLS). CMP-038 login: SELECT/INSERT/UPDATE/DELETE on fixture `sf_t004_peer.orders` (granted only to `sf_cmp002_rw`) → 42501. An `sf_app`-only login (no `_rw`) also 42501 on registry DML. |
| **004-P4** | `pg_has_role(session_user, 'sf_cmp002_rw'|'sf_cmp031_rw'|'sf_cmp037_rw'|'sf_cmp048_rw', 'MEMBER')` is false; `SET ROLE` those roles → error. Same for publisher login vs `sf_cmp038_rw` and `sf_app`. |
| **004-P5** | Runtime and publisher: `rolsuper` false, `rolbypassrls` false. |
| **004-P6** | `pg_tables.tableowner` / schema owner is `sf_migrator` (or equivalent), never the runtime/publisher LOGIN. |
| **004-P7** | Tenant outbox/inbox: `relrowsecurity` and `relforcerowsecurity` true; policies only as template; no policy TO PUBLIC. Registry tables `topic` / `event_schema` / `consumer_checkpoint`: `relrowsecurity` **false** (no ENABLE RLS, no policies). |
| **004-P8** | `has_table_privilege('public', …)` false for all new tables/sequences; default privileges do not grant `sf_app` DML on registry tables. |
| **004-P9** | Publisher catalogue (004-02) still holds after registry tables exist (no new publisher grants). |
| **004-P10** | Lost-event invariant H3 across rollback, broker down/up, lease expiry (ties 004-08/17/29). |

### 6.3 Unit / integration / Kafka

Dispatch plan §6 U1–U11, I1–I16, K1–K5 remain in scope, with P-004-1 (no skip flag) and snapshot-based registry.

---

## 7. Files to add in Phase 2 (not in this PR)

`packages/outbox/**`: package.json, tsconfig, exports `.` / `./publisher` / `./kafka` / `./testing`, producer/tx/inbox/publisher/transport/testing/metrics/snapshot, unit tests.

`services/cmp-038-event-bus/**`: package.json, tsconfig, vitest.integration.config.ts, README (schema-registry strategy), `contracts/asyncapi.yaml`, topic-registry JSON Schema, `registry/topics.json`, registry/lag/relay/operator modules, security + integration tests, helpers.

`db/migrations/1759500400000_cmp-038-event-bus.sql`.

Phase 2 evidence (not now): listed in the envelope (`privilege-boundary.log`, atomicity, broker-outage, ordering, EVIDENCE.md, junit, coverage ≥80% on new src, scope-check, gates, handover).

**Not touched:** other Wave 1 services, frozen contracts, lockfile, compose.

---

## 8. Rollback

- Code: revert this branch; plugin/process is unmounted until W2.
- DB Down: drop `sf_event_bus` CASCADE after REVOKE; drop `sf_cmp038_rw` if no remaining members; **do not** drop shared `sf_migrator` if other schemas exist.
- Relay stop: no loss of committed PENDING rows.
- Kafka: topics remain; operator deletes if required.

---

## 9. Open items for orchestrator (non-blocking unless marked)

| ID | Item | Proposal |
|---|---|---|
| O-LOCK | New `kafkajs@2.2.4` requires lockfile regen | Builder will not commit `pnpm-lock.yaml`. Replaces `@platformatic/kafka` (transitive `@platformatic/wasm-utils@0.2.1` failed `trustPolicy: no-downgrade`). Request orchestrator lockfile reconciliation; do not turn the policy off. |
| O-MIG | `sf_migrator` does not exist in M00 | This migration creates it with the same idempotent `DO $$` / `pg_roles` pattern as `sf_app` in the platform baseline, then `OWNER TO sf_migrator`. Sibling tasks may share the role; this task does not edit the frozen baseline. |
| O-CCR | P-004-4 DELETE on PENDING | Record residual; do **not** edit template. |
| STOP | SQS vs MSK, payload > 256 KiB, frozen contract edit, publisher SQL beyond outbox, root/`pnpm-lock` write, ADR-0006 violation | Stop; no silent architecture change. |

Rulings already binding (do not re-ask): Q1 Kafka tarball; Q2 no publisher registry GRANT + snapshot; Q3 unregistered → retry not DLQ; Q4 OTel global meter; Q5 discard = DELETE after DLQ + audit; Q8 no REST; naming `sf_cmp038_rw`; **registry tables GRANT-only, no RLS** (rev 2).

---

## 10. Recommended gate status after Phase 2 (not claimed now)

Builders may **recommend** only. Independent stitcher / security / evidence verifiers own gates. This Phase 1 revision contains **no executed tests** and is **not** VERIFIED or CERTIFIED.

Phase 2 should target: frozen_contract_conformance 100%; cross_tenant_leakage zero; unresolved_critical_security zero; lost_committed_applications zero; component_privilege_boundary 100%.
