import { randomBytes } from 'node:crypto';
import { createAjv, validate, type EventEnvelope } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type pg from 'pg';
import { OutboxError } from '../errors.js';
import {
  ATTR_SAFE,
  claimed,
  deadLettered,
  published,
  publishFailures,
  publishLatency,
} from '../metrics.js';
import type { TopicRegistryReader, TopicSpec } from '../registry-port.js';
import { OUTBOX_TABLE, OUTBOX_TABLE_PLATFORM } from '../sql.js';
import type { EventTransport, OutgoingMessage, PublishOutcome } from '../transport/types.js';
import { backoffMs } from './backoff.js';
import {
  claimBatch,
  discardDeadLetter,
  markDeadLettered,
  markPublished,
  purgePublished,
  replayDeadLetter,
  scheduleRetry,
  type ClaimedRow,
} from './claim.js';
import { discoverOutboxTables } from './discovery.js';
import { assertPublisherRole } from './role-guard.js';

const ajv = createAjv();

export interface PublisherOptions {
  pool: pg.Pool;
  transport: EventTransport;
  registry: TopicRegistryReader;
  workerId: string;
  schemaAllowlist?: readonly string[];
  leaseMs?: number;
  batchSize?: number;
  loggerService?: string;
}

export interface OutboxPublisher {
  start(): Promise<void>;
  stop(): Promise<void>;
  runOnce(): Promise<number>;
  workerId(): string;
  replay(schema: string, table: string, seq: string): Promise<number>;
  discard(schema: string, table: string, seq: string, dlqAcked: boolean): Promise<number>;
}

function envelopeOf(row: ClaimedRow): EventEnvelope | undefined {
  const raw = row.envelope;
  if (!raw || typeof raw !== 'object') return undefined;
  const parsed = validate('event-envelope', raw);
  return parsed.valid ? (raw as EventEnvelope) : undefined;
}

function tenantClassOk(row: ClaimedRow, topic: TopicSpec): boolean {
  const isPlatformTable = row.table === OUTBOX_TABLE_PLATFORM;
  if (isPlatformTable) return topic.tenancy === 'PLATFORM_OPERATIONAL';
  return topic.tenancy === 'TENANT_SCOPED';
}

function validateAgainstRegistry(
  row: ClaimedRow,
  env: EventEnvelope,
  registry: TopicRegistryReader,
): { ok: true } | { ok: false; retryable: boolean; code: string } {
  const topic = registry.getTopic(row.topic);
  if (!topic || topic.status !== 'ACTIVE') {
    return { ok: false, retryable: true, code: 'TOPIC_UNREGISTERED' };
  }
  if (!tenantClassOk(row, topic)) {
    return { ok: false, retryable: false, code: 'TENANCY_MISMATCH' };
  }
  if (topic.partition_key_strategy === 'AGGREGATE_ID' && row.partition_key !== env.aggregate_id) {
    return { ok: false, retryable: false, code: 'PARTITION_KEY_MISMATCH' };
  }
  const schema = topic.schemas.find(
    (s) => s.event_type === env.event_type && s.schema_version === env.schema_version,
  );
  if (!schema) {
    return { ok: false, retryable: true, code: 'SCHEMA_VERSION_UNSUPPORTED' };
  }
  const check = ajv.compile(schema.data_schema);
  if (!check(env.data)) {
    return { ok: false, retryable: false, code: 'DATA_SCHEMA_INVALID' };
  }
  return { ok: true };
}

function headersFor(
  row: ClaimedRow,
  env: EventEnvelope,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'sf-event-id': env.event_id,
    'sf-event-type': env.event_type,
    'sf-schema-version': String(env.schema_version),
    'sf-cell-id': env.cell_id,
    'sf-correlation-id': env.correlation_id,
    'sf-source': row.schema + '.' + row.table + '#' + row.seq,
  };
  if (env.tenant_id !== null) headers['sf-tenant-id'] = env.tenant_id;
  if (extra) Object.assign(headers, extra);
  return headers;
}

export function createOutboxPublisher(options: PublisherOptions): OutboxPublisher {
  const leaseMs = options.leaseMs ?? 15_000;
  const batchSize = options.batchSize ?? 32;
  const workerId = options.workerId + ':' + randomBytes(8).toString('hex');
  const log = createLogger({
    service: options.loggerService ?? '@serviceform/outbox',
    version: '0.0.0',
    level: 'info',
  });
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consecutiveFailures = 0;

  async function inTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await options.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try {
        await c.query('ROLLBACK');
      } catch {
        // keep
      }
      throw e;
    } finally {
      c.release();
    }
  }

  async function publishRow(row: ClaimedRow): Promise<{ done: 'published' | 'retried' | 'dead' }> {
    const started = Date.now();
    const env = envelopeOf(row);
    if (!env) {
      const dlqTopic = options.registry.getTopic(row.topic)?.dlq_topic ?? row.topic + '.dlq';
      const poison: OutgoingMessage = {
        topic: dlqTopic,
        key: row.partition_key,
        value: JSON.stringify(row.envelope ?? {}),
        headers: {
          'sf-event-id': row.event_id,
          'sf-error-code': 'ENVELOPE_INVALID',
          'sf-source': row.schema + '.' + row.table + '#' + row.seq,
        },
      };
      const [dlq] = await options.transport.publish([poison], {
        timeoutMs: Math.max(1000, leaseMs - 2000),
      });
      if (dlq?.kind !== 'ok') {
        await inTx((c) =>
          scheduleRetry(
            c,
            row.schema,
            row.table,
            row.seq,
            workerId,
            'DLQ_PUBLISH_FAILED',
            backoffMs(row.attempts),
          ),
        );
        publishFailures.add(1, { [ATTR_SAFE.errorCode]: 'DLQ_PUBLISH_FAILED' });
        return { done: 'retried' };
      }
      await inTx((c) =>
        markDeadLettered(c, row.schema, row.table, row.seq, workerId, 'ENVELOPE_INVALID'),
      );
      deadLettered.add(1, { [ATTR_SAFE.errorCode]: 'ENVELOPE_INVALID' });
      log.warn({ event_id: row.event_id, error_code: 'ENVELOPE_INVALID' }, 'dead-lettered');
      return { done: 'dead' };
    }

    const check = validateAgainstRegistry(row, env, options.registry);
    if (!check.ok) {
      if (check.retryable) {
        await inTx((c) =>
          scheduleRetry(
            c,
            row.schema,
            row.table,
            row.seq,
            workerId,
            check.code,
            backoffMs(row.attempts),
          ),
        );
        publishFailures.add(1, { [ATTR_SAFE.errorCode]: check.code });
        return { done: 'retried' };
      }
      const topic = options.registry.getTopic(row.topic);
      const dlqTopic = topic?.dlq_topic ?? row.topic + '.dlq';
      const dlqMsg: OutgoingMessage = {
        topic: dlqTopic,
        key: row.partition_key,
        value: JSON.stringify(env),
        headers: headersFor(row, env, { 'sf-error-code': check.code }),
      };
      const [dlq] = await options.transport.publish([dlqMsg], {
        timeoutMs: Math.max(1000, leaseMs - 2000),
      });
      if (dlq?.kind !== 'ok') {
        await inTx((c) =>
          scheduleRetry(
            c,
            row.schema,
            row.table,
            row.seq,
            workerId,
            'DLQ_PUBLISH_FAILED',
            backoffMs(row.attempts),
          ),
        );
        return { done: 'retried' };
      }
      await inTx((c) => markDeadLettered(c, row.schema, row.table, row.seq, workerId, check.code));
      deadLettered.add(1, { [ATTR_SAFE.errorCode]: check.code });
      log.warn({ event_id: env.event_id, error_code: check.code }, 'dead-lettered');
      return { done: 'dead' };
    }

    const msg: OutgoingMessage = {
      topic: row.topic,
      key: row.partition_key,
      value: JSON.stringify(env),
      headers: headersFor(row, env),
    };
    const [outcome]: PublishOutcome[] = await options.transport.publish([msg], {
      timeoutMs: Math.max(1000, leaseMs - 2000),
    });
    if (outcome?.kind === 'ok') {
      const n = await inTx((c) => markPublished(c, row.schema, row.table, [row.seq], workerId));
      if (n === 0) {
        log.info({ event_id: env.event_id }, 'lost lease; mark skipped');
      } else {
        published.add(1, { [ATTR_SAFE.table]: row.table });
      }
      publishLatency.record(Date.now() - started, { [ATTR_SAFE.table]: row.table });
      return { done: 'published' };
    }
    const code = outcome?.errorCode ?? 'BROKER_UNAVAILABLE';
    const n = await inTx((c) =>
      scheduleRetry(c, row.schema, row.table, row.seq, workerId, code, backoffMs(row.attempts)),
    );
    if (n === 0) {
      log.info({ event_id: env.event_id }, 'lost lease; retry skipped');
    }
    publishFailures.add(1, { [ATTR_SAFE.errorCode]: code });
    return { done: 'retried' };
  }

  async function runOnce(): Promise<number> {
    let processed = 0;
    const tables = await inTx((c) => discoverOutboxTables(c, options.schemaAllowlist));
    for (const t of tables) {
      const rows = await inTx((c) =>
        claimBatch(c, t.schema, t.table, workerId, batchSize, leaseMs),
      );
      claimed.add(rows.length, { [ATTR_SAFE.schema]: t.schema, [ATTR_SAFE.table]: t.table });
      for (const row of rows) {
        const result = await publishRow(row);
        processed += 1;
        if (result.done === 'retried' && row.topic) {
          consecutiveFailures += 1;
        } else if (result.done === 'published') {
          consecutiveFailures = 0;
        }
      }
    }
    for (const topic of options.registry.allTopics()) {
      if (topic.status !== 'ACTIVE') continue;
      await inTx(async (c) => {
        const discovered = await discoverOutboxTables(c, options.schemaAllowlist);
        for (const t of discovered) {
          if (t.table !== OUTBOX_TABLE && t.table !== OUTBOX_TABLE_PLATFORM) continue;
          await purgePublished(
            c,
            t.schema,
            t.table,
            topic.topic_name,
            topic.outbox_retention,
            1000,
          );
        }
      });
    }
    return processed;
  }

  async function loop(): Promise<void> {
    if (!running) return;
    try {
      if (consecutiveFailures >= 8) {
        await new Promise((r) => setTimeout(r, backoffMs(consecutiveFailures, 500, 15_000)));
      }
      await runOnce();
    } catch (cause) {
      consecutiveFailures += 1;
      log.error({ error_code: 'PUBLISHER_LOOP' }, String(cause));
    }
    if (running) {
      timer = setTimeout(
        () => {
          void loop();
        },
        consecutiveFailures >= 8 ? backoffMs(consecutiveFailures) : 200,
      );
    }
  }

  return {
    workerId: () => workerId,
    async start() {
      await assertPublisherRole(options.pool);
      running = true;
      void loop();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      await options.transport.close();
    },
    runOnce,
    replay(schema, table, seq) {
      return inTx((c) => replayDeadLetter(c, schema, table, seq));
    },
    async discard(schema, table, seq, dlqAcked) {
      if (!dlqAcked) {
        throw new OutboxError('SF-SYS-003', { details: [{ code: 'DLQ_ACK_REQUIRED' }] });
      }
      return inTx((c) => discardDeadLetter(c, schema, table, seq));
    },
  };
}
