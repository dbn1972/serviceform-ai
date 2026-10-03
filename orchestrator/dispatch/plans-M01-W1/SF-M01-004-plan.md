# SF-M01-004 plan: CMP-038 Event Bus (outbox library, relay, topic registry)

Builder: serviceform-foundation-builder, route opus (claude-opus-5-5), effort high. PLAN ONLY, no code written.
Worktree `/var/tmp/wt-SF-M01-004`, branch `agent/M01-cmp-038-event-bus-SF-M01-004`, base `d1d0965`.
Read: envelope SF-M01-004.yaml, DISPATCH-PLAN-M01-W1 s4-s6, AGENTS.md, CLAUDE-MULTI-AGENT-GUIDE.md, constitution #11/#23,
MODEL-ROUTING-QUALITY s9, SF-CON-OUTBOX (template rules 1-6 + outbox-record schema), SF-CON-EVENT-ENVELOPE,
SF-CON-DB-SESSION-CONTEXT (+ migration 1759490000000, `dbSessionSettings`), db/test/shared-db-contracts.int.test.ts,
CONTRACT-REVIEW-001 (D-01..D-05), AWS v1.7 s4.3/s4.5/s4.6/s13.2/CMP-038, Eng v1.4 CMP-038 + INT-011/INT-013, TI v1.0 s13,
migration_lint.py, check_scope.py, .dependency-cruiser.cjs, packages/observability and packages/contracts public API.

## 1. Impact plan (AGENTS.md task loop step 2)

| Aspect | Impact |
|---|---|
| Module / IDs | M01; CMP-038; INT-011 (events keep immutable tenant context), INT-013 (SIMULATED transport parity, mode refusal). Requirements: AWS s4.3, s4.5 "outbox", s4.6 MSK partitioning + lag SLO, s13.2 rules; Eng CMP-038 responsibilities (topic governance, schema/versioning, partitioning, outbox ingestion, retry/DLQ, lag monitoring) and failure modes (lag, poison message, broker outage, duplicate delivery); TI s13. |
| Domain | No business state (Eng: "does not become authoritative business state"). Owns topic registry, schema metadata, consumer checkpoint metadata. |
| Data | New schema `sf_event_bus` (owner CMP-038): 3 registry tables + the 4 template tables copied verbatim. Relay touches other components' `outbox_event*` tables only through `sf_outbox_publisher` grants (frozen contract; D-02). |
| APIs / events | No end-user REST (Eng: "event contracts via AsyncAPI"). Library API (s2), programmatic registry service, AsyncAPI for CMP-038's own events: `TopicRegistered`, `EventSchemaRegistered`, `DeadLetterReplayed`, `DeadLetterDiscarded` (platform events, tenant_id null, written to `sf_event_bus.outbox_event_platform`; CMP-031 can ingest them as audit facts). |
| Tenancy / authz | Producer helper requires transaction-local tenant context equal to envelope tenant (SF-TEN-001/002) before the RLS-guarded INSERT; publisher is the approved cross-tenant service (D-02), never holds sf_app/BYPASSRLS (startup self-check refuses); consumer helper derives DB session context from the validated envelope. No tenant_id in metric labels or logs (only event_id/correlation_id). |
| Migration | One file `db/migrations/1759500000000_cmp-038-event-bus.sql` (> 1759490000000, check-order). |
| Tests | s6. Real-broker suite runs against a disposable local Apache Kafka (option A, s3.3) or is deferred. |
| Observability | OTel metrics via `@opentelemetry/api` global MeterProvider that `startTelemetry()` of packages/observability registers; pino logger via `createLogger()` (s5). |
| Rollback | Revert the branch. Down migration drops `sf_event_bus` (dev/CI only; it holds CMP-038's own outbox). Stopping the relay is safe: producers keep inserting PENDING rows into their own outboxes, nothing is lost, backlog drains on restart (s13.2). Kafka topics created by the provisioner are left in place (deleting topics is an operator action). |

## 2. packages/outbox API (`@serviceform/outbox`)

Exports `.` (producer + inbox + types, no Kafka code) and `./publisher`, `./kafka`, `./testing` subpaths so producers do not load a Kafka client.

**2.1 Producer (rule 1, 2).**
- `withOutboxTransaction(pool, ctx: RequestContext, fn: (tx: OutboxTx) => Promise<T>)`: BEGIN, applies every entry of
  `dbSessionSettings(ctx)` with `SELECT set_config($1,$2,true)`, runs fn, COMMIT/ROLLBACK. `OutboxTx` is a branded handle;
  `asOutboxTx(client)` lets a component that already owns BEGIN + settings pass its client.
- `insertOutboxEvent(tx, { schema, topic, envelope, partitionKey? })`:
  1. `validate('event-envelope', envelope)` (packages/contracts), else `OutboxError SF-SYS-003`.
  2. topic matches `^[a-zA-Z0-9._-]{3,249}$`; `schema` is a plain identifier, quoted with `escapeIdentifier`.
  3. serialised envelope <= 262144 bytes (D-03), else SF-SYS-003 "payload too large, reference S3 object instead".
  4. tenant routing: `envelope.tenant_id` non-null -> `<schema>.outbox_event`; null -> `<schema>.outbox_event_platform`.
  5. tenant guard: `SELECT sf_platform.current_tenant_id()`; tenant event with null context -> SF-TEN-001; mismatch -> SF-TEN-002
     (RLS would also refuse; this gives a stable code). Platform event inside a tenant-context tx is allowed (no tenant leak).
  6. Columns derived from the envelope only (event_id, tenant_id, event_type, schema_version, aggregate_*), so the table CHECKs
     cannot diverge; `partition_key` = `partitionKey ?? aggregate_id`.
  7. single `INSERT` (no RETURNING, producers have no SELECT grant). Producers never SELECT/UPDATE/DELETE outbox rows.
- No network I/O; the helper never opens its own transaction inside `insertOutboxEvent` (constitution #11).

**2.2 Publisher (rules 3, 4, 6)** `createOutboxPublisher({ pool, transport, registry: TopicRegistryReader, workerId, ... })`.
- Startup guard: refuses to start if `current_user` is superuser, has BYPASSRLS, or `pg_has_role(current_user,'sf_app','MEMBER')`
  (skippable only by an explicit test flag that the test sets after `SET ROLE sf_outbox_publisher`).
- Discovery: `pg_class`/`pg_namespace` lookup of tables named `outbox_event` / `outbox_event_platform` where
  `has_table_privilege(oid,'SELECT,UPDATE')`, optionally intersected with a configured schema allowlist. Catalog only, no business tables.
- Claim (one short tx per table, rule 3+4):
  ```sql
  WITH c AS (SELECT o.seq FROM s.t o
    WHERE o.status='PENDING' AND o.next_attempt_at <= now()
      AND (o.lease_expires_at IS NULL OR o.lease_expires_at < now())
      AND NOT EXISTS (SELECT 1 FROM s.t p WHERE p.partition_key=o.partition_key AND p.seq<o.seq AND p.status<>'PUBLISHED')
    ORDER BY o.seq LIMIT $batch FOR UPDATE SKIP LOCKED)
  UPDATE s.t SET lease_owner=$worker, lease_expires_at=now()+$lease, attempts=attempts+1
  FROM c WHERE s.t.seq=c.seq RETURNING s.t.*;
  ```
  Literal rule 4: only the head row of each key is claimable, so one claim carries at most one row per key; ordering per
  key is preserved across workers. Uses only granted columns.
- Publish with no transaction open (connection released). Per row: (a) envelope re-validated; (b) registry checks: topic
  ACTIVE, topic tenant class matches table (tenant table <-> TENANT_SCOPED topic), `(topic,event_type,schema_version)`
  registered, `data` valid against the registered data schema, partition-key strategy honoured; (c) message = key
  `partition_key`, value = envelope JSON, headers `sf-event-id`, `sf-event-type`, `sf-schema-version`, `sf-tenant-id`,
  `sf-cell-id`, `sf-correlation-id`, `sf-source` (`schema.table#seq`). Send timeout = lease - safety margin so a slow send
  cannot outlive its lease. Kafka producer: acks all, idempotent.
- Mark (second short tx): success -> `status='PUBLISHED', published_at=now(), lease_owner=NULL, lease_expires_at=NULL
  WHERE seq=ANY($1) AND lease_owner=$worker`. Lost lease (0 rows) is logged; the duplicate is harmless (inbox dedup).
- Retry/backoff: retryable (broker down, timeout, not-leader, unregistered topic/version, see Q3) ->
  `next_attempt_at = now() + min(cap, base*2^attempts) * jitter`, `last_error_code` e.g. `BROKER_UNAVAILABLE`, lease cleared.
  Never dead-letters a transient failure ("retries until acknowledged", s13.2). Whole-loop circuit breaker: after N
  consecutive transport failures the loop idles with backoff instead of claiming (no DB hammering while broker is down).
- Dead-letter (non-retryable: envelope invalid, data invalid vs registered schema, tenant/topic class mismatch, partition-key
  mismatch, message too large): publish the original envelope to the registry's DLQ topic (`<topic>.dlq`, same key,
  headers + `sf-error-code`, tenant context preserved per TI s13), then mark `status='DEAD_LETTERED', last_error_code=...`.
  If the DLQ publish fails it is a retry, not a loss. The DEAD_LETTERED row holds its key (rule 4) until an operator action.
- Operator actions (`replayDeadLetter`, `discardDeadLetter`) in the service, run as publisher role, each writes a CMP-038
  platform audit event to its own outbox in the same tx. Replay = back to PENDING with attempts kept. Discard: see Q5.
- Purge (rule 6): periodic `DELETE ... WHERE status='PUBLISHED' AND published_at < now() - topic.outbox_retention` in batches
  of <= 1000 by seq, per topic from the registry. DEAD_LETTERED and PENDING rows are never purged.
- Lifecycle: `start()`, `stop()` (drains in-flight, releases leases), `runOnce()` for deterministic tests. Seq kept as string (bigint).

**2.3 Consumer inbox helper (rule 5)** `consumeWithInbox({ pool, schema, consumerGroup, supportedVersions, workerActor }, handler)`
returns a transport handler: parse + `validate('event-envelope')` (invalid -> consumer-side DLQ, offset committed, never applied);
unsupported `schema_version` -> explicit `SCHEMA_VERSION_UNSUPPORTED` failure (no silent apply); then BEGIN, set_config
`app.tenant_id` = envelope tenant (omitted when null), `app.cell_id`, `app.actor_type/id` = worker identity,
`app.correlation_id` = envelope correlation (DB-session-context rule for background workers); `INSERT INTO <schema>.inbox_event
(consumer_group, event_id, tenant_id) ... ON CONFLICT DO NOTHING` (or `inbox_event_platform` when tenant null); rowCount 0 ->
COMMIT, skip (duplicate); else `handler(tx, envelope)` then COMMIT; Kafka offset committed only after DB commit. Optional
stale-aggregate-version hook (s13.2).

## 3. Kafka client and transport

**3.1 Choice: `@platformatic/kafka` 2.12.1, Apache-2.0** (pinned exact, matching repo practice; 2.12.1 released 25 Sep 2026,
chosen over 2.13.0 of 1 Oct 2026 for a 7-day cool-off). Reasons: pure TypeScript, no install/native build scripts (pnpm 10
would block a native build unless root `package.json` `onlyBuiltDependencies` changed, which is read-only for this task);
actively maintained; verified in the 2.12.1 tarball: idempotent producer option, `createTopics`, `listOffsets`,
`listConsumerGroupOffsets`, `describeGroups`, murmur2 partitioner (Java-client compatible keys). Transitive deps all
Apache-2.0/MIT (ajv, avsc, debug, fastq, scule, mnemonist, ajv-draft-04, @platformatic/wasm-utils, dynamic-buffer).
Rejected: `kafkajs` 2.2.4 (MIT, unmaintained since Feb 2023); `@confluentinc/kafka-javascript` 1.10.1 (MIT, librdkafka
native addon with `node-pre-gyp install` script, blocked by pnpm build policy). Note: package engines `node >=22.22.0`
vs repo `>=22.12.0`; local and CI (`.nvmrc` 22) resolve 22.22.x. Other new deps: none beyond workspace pins
(`pg` 8.23.1, `@types/pg` 8.23.1, `@opentelemetry/api` 1.9.1, devDep `@opentelemetry/sdk-metrics` 2.11.0, `fastify` not needed).

**3.2 Transport interface** (`packages/outbox/src/transport/types.ts`):
```ts
interface EventTransport {
  readonly mode: 'REAL' | 'SIMULATED';
  publish(msgs: OutgoingMessage[], o: { timeoutMs: number }): Promise<PublishOutcome[]>; // per msg: ok | retryable | fatal
  ensureTopics(defs: TopicSpec[]): Promise<void>;
  subscribe(group: string, topics: string[], h: MessageHandler): Promise<Subscription>; // manual commit after h resolves
  logEndOffsets(topic: string): Promise<Map<number, bigint>>;
  committedOffsets(group: string, topic: string): Promise<Map<number, bigint>>;
  close(): Promise<void>;
}
```
`KafkaTransport` (`./kafka`) and `InMemoryTransport` (`./testing`: partitions with the same murmur2 partitioner, consumer
groups, committed offsets, fault injection `down()/up()`, `failNext(n, kind)`, `redeliver()`). INT-013: the in-memory
transport is `SIMULATED`; the relay entry refuses it unless `SF_ENVIRONMENT` is LOCAL, CI, DEVELOPMENT, SIT or PERFORMANCE
(D-04 list). Transport selection is server-side config only.

**3.3 Broker evidence here.** No Docker daemon, but Java 21 is installed and archive.apache.org answers (200 for
`kafka_2.13-4.1.0.tgz`). Option A (recommended, needs orchestrator approval as a test-harness download): run a single-node
KRaft Apache Kafka 4.1.0 from the tarball in the builder scratchpad (outside the repo), `SF_KAFKA_BROKERS=127.0.0.1:<port>`,
and execute the real-broker suite including a broker kill/restart for `broker-outage.log`. Option B: the real-broker suite
is `describe.skipIf(!process.env.SF_KAFKA_BROKERS)` and is deferred. **Deferral gap:** CI has never run (G-01) and
`.github/workflows/ci.yml` has no Kafka service and no step that runs `services/*/vitest.integration.config.ts`; `.github`
is read-only here, so "deferred to CI" currently means "not executed" until CMP-055/delivery adds a job (Q1).
Deferred under B: real Kafka publish/consume, real broker-outage, real partition ordering, lag via real admin API.
Always executed here: everything against PostgreSQL 16 with the in-memory transport (atomicity, leases, ordering logic,
backoff, DLQ, purge, inbox dedup, metrics).

## 4. Topic registry

Schema `sf_event_bus` (declared `-- sf:schema sf_event_bus PLATFORM_OPERATIONAL owner=CMP-038`).

| Table | Isolation | Content |
|---|---|---|
| `sf_event_bus.topic` | PLATFORM_OPERATIONAL owner=CMP-038 | `topic_name` PK (contract pattern), `owner_component` (CMP-001..061), `tenancy` (TENANT_SCOPED or PLATFORM_OPERATIONAL: which outbox table may feed it), `partition_key_strategy` (AGGREGATE_ID or DECLARED), `partitions`, `replication_factor`, `broker_retention`, `outbox_retention` (rule 6), `replay_class` (Eng "retention and replay class by topic"), `compatibility` (BACKWARD, FORWARD, FULL), `dlq_topic` (NOT NULL, `<topic>.dlq`), `status` ACTIVE/DEPRECATED, `created_at`. |
| `sf_event_bus.event_schema` | PLATFORM_OPERATIONAL owner=CMP-038 | PK `(topic_name, event_type, schema_version)`, `data_schema jsonb` (JSON Schema 2020-12 for `data`), `registered_at`. Immutable: INSERT-only grants plus trigger refusing UPDATE/DELETE (no mutation of published versions). |
| `sf_event_bus.consumer_checkpoint` | PLATFORM_OPERATIONAL owner=CMP-038 | PK `(consumer_group, topic_name, partition)`, `committed_offset`, `log_end_offset`, `lag`, `observed_at`. Written by the lag monitor only. |
| `sf_event_bus.outbox_event`, `outbox_event_platform`, `inbox_event`, `inbox_event_platform` | as template | Copied unchanged from `outbox.template.sql` (`{schema}`=sf_event_bus, `{cmp}`=CMP-038), plus `GRANT USAGE ON SCHEMA sf_event_bus TO sf_app`. |

Grants: `sf_app` SELECT/INSERT on `topic`, `event_schema`; SELECT/INSERT/UPDATE on `consumer_checkpoint`.
`sf_outbox_publisher` SELECT on `topic`, `event_schema` (needed for rules 4/6 and validation; see Q2).
Source of truth for entries: versioned `services/cmp-038-event-bus/registry/topics.json`, applied by an idempotent
`registry:sync` command (compatibility-checked, each change emits `TopicRegistered`/`EventSchemaRegistered`). Producers
add topics by PR to that file (CODEOWNERS review by CMP-038). `ensureTopics` provisions topic + DLQ topic on the broker.
Compatibility check (pure function, tested): new version must be `schema_version = max+1`; BACKWARD refuses new required
properties, removed properties, type changes, enum narrowing, `additionalProperties` true->false; FORWARD the mirror;
FULL both. Incompatible -> `RegistryError` with `SF-SYS-003` and reason `SCHEMA_INCOMPATIBLE` (no new error family, Q6).
Publisher reads the registry through `TopicRegistryReader` (port in packages/outbox, Postgres implementation in the service,
cached with a short TTL). DLQ topics are registry rows too (tenancy inherited, outbox_retention n/a).

## 5. Metrics (consume packages/observability only)

packages/observability exports `startTelemetry` (NodeSDK registers the global MeterProvider) and `createLogger`, but no meter
helper. Plan: `metrics.getMeter('@serviceform/outbox')` from `@opentelemetry/api` 1.9.1 (same pin as observability),
exported by the pipeline `startTelemetry` starts; logs through `createLogger` (redaction applies). Instruments:
`sf.outbox.claimed`, `sf.outbox.published`, `sf.outbox.publish_failures{error_code}`, `sf.outbox.dead_lettered{error_code}`,
`sf.outbox.pending` and `sf.outbox.oldest_pending_age_s` (observable gauges per schema/table), `sf.outbox.publish_latency_ms`,
`sf.eventbus.consumer.lag{topic,consumer_group,partition}`, `sf.eventbus.consumer.committed_offset`, `sf.inbox.duplicates`.
No tenant_id or event_id attributes (cardinality, isolation). Lag monitor (service) polls `committedOffsets`/`logEndOffsets`
for registered topics, upserts `consumer_checkpoint`, records gauges. Tests assert with `InMemoryMetricExporter`. See Q4.

## 6. Tests

Test-before-code: the security verifier's tenant-negative/deny tests (MODEL-ROUTING s9) land first under
`services/cmp-038-event-bus/test/integration/security/`; I implement against them unchanged. Unit tests run in `pnpm test`;
`*.int.test.ts` run via `services/cmp-038-event-bus/vitest.integration.config.ts` with `DATABASE_URL` (disposable DB,
`migrate up`, throwaway schemas rendered from the template as in db/test). Roles exercised with `SET LOCAL ROLE`.

Unit (packages/outbox/test, services/cmp-038-event-bus/test/unit): U1 envelope->row derivation; U2 tenant/platform table
routing; U3 size cap 262144; U4 topic/identifier validation and quoting; U5 backoff with jitter and cap; U6 error
classification retryable vs fatal; U7 compatibility checker matrix (BACKWARD/FORWARD/FULL, each refusal reason);
U8 in-memory transport partitioner = murmur2 reference vectors; U9 SIMULATED transport refused in UAT/PREPROD/PRODUCTION;
U10 message headers/key mapping; U11 metrics emitted without tenant attributes.

Integration, PostgreSQL 16 + in-memory transport (executed here):
- I1 atomicity: insert + business row in one tx, ROLLBACK -> no outbox row, nothing published (`outbox-atomicity.log`); COMMIT -> exactly one row, published once.
- I2 producer tenant-negative: context T1 + envelope T2 -> SF-TEN-002 and no row; no context -> SF-TEN-001; RLS backstop when guard bypassed.
- I3 invalid envelope rejected by producer (SF-SYS-003, no row); invalid envelope inserted raw by superuser fixture -> publisher sends to `<topic>.dlq`, not to the topic, row DEAD_LETTERED.
- I4 data invalid vs registered schema -> DLQ; unknown version/unregistered topic -> explicit `last_error_code`, retried, not lost.
- I5 ordering with interleaved aggregates: 3 aggregates x 50 events interleaved, 3 concurrent publishers -> per-key consumed order = seq order (`ordering.log`).
- I6 dead-letter holds its key: key K seq1 dead-lettered -> K seq2 never published, other keys flow; replay -> seq1 then seq2 in order, audit event written.
- I7 broker down: transport `down()` mid-stream, publisher backs off (attempts/next_attempt_at grow, loop idles), `up()` -> all events delivered, none lost, per-key order kept (`broker-outage.log`, in-memory part).
- I8 lease expiry redelivery: publisher A claims and "crashes" (no mark) -> after lease expiry B republishes; A's late mark affects 0 rows; consumer applies once.
- I9 duplicate delivery deduped by inbox: same message delivered twice -> handler effect once, `sf.inbox.duplicates`=1; platform event uses platform inbox.
- I10 consumer tenant isolation: handler sees `current_tenant_id()` = envelope tenant; inbox rows of T1 invisible under T2.
- I11 relay never reads business tables: business table in the same schema with no publisher grant, full cycle succeeds as `sf_outbox_publisher`; plus static scan of publisher SQL for table names.
- I12 publisher self-check refuses a role that is member of sf_app.
- I13 purge: PUBLISHED older than retention deleted, newer kept, DEAD_LETTERED/PENDING kept.
- I14 registry: incompatible version registration fails explicitly; event_schema UPDATE/DELETE refused; sync idempotent.
- I15 lag: consumer behind by N -> checkpoint row and lag gauge = N.
- I16 migration: up/down/up round trip; migration_lint passes; template tables byte-identical after placeholder substitution.

Real broker (`*.kafka.int.test.ts`, skipIf no `SF_KAFKA_BROKERS`): K1 publish after commit + consume with inbox dedup;
K2 ordering across partitions with interleaved aggregates; K3 broker process killed and restarted -> no loss, order kept;
K4 DLQ topic receives poison event; K5 lag from real `listConsumerGroupOffsets`. Executed only under option A.

## 7. Files (all checked against allowed_write_paths; evidence/handover allowed by check_scope.py for every task)

`packages/outbox/**`: `package.json`, `tsconfig.json`, `src/index.ts`, `src/errors.ts`, `src/tx.ts`, `src/producer.ts`,
`src/envelope.ts`, `src/sql.ts`, `src/inbox.ts`, `src/metrics.ts`, `src/registry-port.ts`, `src/publisher/index.ts`,
`src/publisher/publisher.ts`, `src/publisher/claim.ts`, `src/publisher/backoff.ts`, `src/publisher/classify.ts`,
`src/publisher/dead-letter.ts`, `src/publisher/purge.ts`, `src/publisher/discovery.ts`, `src/publisher/role-guard.ts`,
`src/transport/types.ts`, `src/transport/partitioner.ts`, `src/transport/kafka.ts`, `src/testing/in-memory-transport.ts`,
`src/testing/index.ts`, `test/producer.test.ts`, `test/envelope.test.ts`, `test/backoff.test.ts`, `test/classify.test.ts`,
`test/in-memory-transport.test.ts`, `test/partitioner.test.ts`, `test/metrics.test.ts`.
`services/cmp-038-event-bus/**`: `package.json`, `tsconfig.json`, `vitest.integration.config.ts`, `README.md`
(schema-registry strategy, required by AWS CMP-038), `contracts/asyncapi.yaml`, `contracts/topic-registry-entry.schema.json`,
`registry/topics.json`, `src/index.ts`, `src/config.ts`, `src/registry/repository.ts`, `src/registry/compatibility.ts`,
`src/registry/service.ts`, `src/registry/pg-reader.ts`, `src/registry/sync.ts`, `src/relay/main.ts`, `src/lag/lag-monitor.ts`,
`src/lag/checkpoint-repository.ts`, `src/dead-letter/operator-actions.ts`, `src/topics/provisioner.ts`,
`test/unit/compatibility.test.ts`, `test/unit/config.test.ts`, `test/unit/registry-service.test.ts`, `test/helpers/db.ts`,
`test/helpers/kafka.ts`, `test/integration/*.int.test.ts` (I1-I16), `test/integration/*.kafka.int.test.ts` (K1-K5),
`test/integration/security/*` (authored by the security verifier).
`db/migrations/1759500000000_cmp-038-event-bus.sql` (matches `*_cmp-038-*.sql`).
`pnpm-lock.yaml` via `pnpm install` only.
Evidence (implicitly allowed): `evidence/SF-M01-004/{EVIDENCE.md,outbox-atomicity.log,broker-outage.log,ordering.log,
coverage-summary.json,scope-check.log,gates.log,junit/*.xml}`, `orchestrator/handovers/SF-M01-004.yaml`.
Not touched: `contracts/**`, `packages/contracts/**`, `packages/observability/**`, `apps/**` (wiring is W2/CMP-036),
`db/test/**`, root configs, `.github/**`, other wave-1 scopes. No import of SF-M01-001/002/003/005 code.

## 8. Open questions and foreseen stop conditions

- Q1 (evidence): approve option A (local Apache Kafka 4.1.0 tarball, Java 21, scratch dir outside repo) so the real-broker
  acceptance tests and `broker-outage.log` are executed here? Otherwise they are skipped and, since CI has no Kafka service
  nor a service-integration job and `.github` is read-only, they stay unexecuted until CMP-055/delivery adds a job.
- Q2 (contract reading): rule 6 needs the publisher to read the registry, but the role comment and D-02 say it "reads and
  marks outbox tables only". Is `GRANT SELECT` on `sf_event_bus.topic`/`event_schema` to `sf_outbox_publisher` within D-02?
  If not, the relay uses a second pool under a CMP-038 sf_app login role for registry reads. If the guardian says neither is
  allowed: STOP (rule 6 not implementable as written).
- Q3 (policy): events for an unregistered topic or unregistered schema_version: retry with explicit `last_error_code` and
  alert (recommended, deploy-ordering issue, no loss) or dead-letter? Wave-1 producers' topics are unknown to me; the
  stitcher must add them to `registry/topics.json` at integration.
- Q4 (observability): is "lag exposed through packages/observability" satisfied by `@opentelemetry/api` metrics exported by
  the SDK `startTelemetry` starts? packages/observability has no meter helper and is read-only; a helper belongs to CMP-047 (W2).
- Q5 (operator discard): status has no DISCARDED value. Discard = DELETE the DEAD_LETTERED row after it is on the DLQ topic,
  with a `DeadLetterDiscarded` audit event. Marking it PUBLISHED would falsify history. Approve DELETE?
- Q6 (errors): no SF-EVT family exists; registry/publisher API errors reuse SF-SYS-003/SF-SYS-004/SF-TEN-00x with reason
  details. A new family would need a spec/contract change.
- Q7 (throughput): literal rule 4 lets one claim take only the head row per key, so a single key publishes one event per
  claim cycle. Fine for aggregate keys, but relevant to the 100K events/s NFR for hot keys; no change proposed.
- Q8 (admin surface): no REST/Fastify plugin planned (Eng: AsyncAPI, not end-user REST; apps/api wiring is W2). Registry is
  managed by `registry/topics.json` + `registry:sync`. Confirm.
- Q9 (merge order): migration timestamp 1759500000000 must stay ordered relative to the other wave-1 migrations under
  `--check-order`; the merger may need to renumber.
- Stop conditions foreseen: SQS vs MSK per event class (this plan routes everything to Kafka; any request for SQS-routed
  classes or isolated retry queues stops for an architecture decision); any change to outbox/inbox DDL, grants, or the
  envelope (D-01 data classification stays out); publisher needing tables other than outbox + CMP-038 registry; payloads
  over 256 KiB; a Kafka client feature gap in 2.12.1 discovered at implementation (re-plan, not swap silently); needing
  root `package.json`/`.github`/`packages/observability` edits.
