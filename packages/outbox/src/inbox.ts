import {
  dbSessionSettings,
  validate,
  type ActorType,
  type EventEnvelope,
} from '@serviceform/contracts';
import type pg from 'pg';
import { inboxDuplicates } from './metrics.js';
import { OutboxError } from './errors.js';
import { assertConsumerGroup, assertSchemaName, quoteIdent } from './identifiers.js';
import type { TopicRegistryReader } from './registry-port.js';
import { INBOX_TABLE, INBOX_TABLE_PLATFORM } from './sql.js';
import { asOutboxTx } from './tx.js';
import type { IncomingMessage, MessageHandler } from './transport/types.js';

export interface WorkerActor {
  type: ActorType;
  id: string;
}

export interface ConsumeInboxOptions {
  pool: pg.Pool;
  schema: string;
  consumerGroup: string;
  supportedVersions: readonly number[];
  workerActor: WorkerActor;
  cellId: string;
  registry: TopicRegistryReader;
  onConsumerDlq: (msg: IncomingMessage, code: string) => Promise<void>;
  handler: (tx: ReturnType<typeof asOutboxTx>, envelope: EventEnvelope) => Promise<void>;
}

const NIL = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function headerTenant(headers: Record<string, string>): string | undefined {
  return headers['sf-tenant-id'];
}

export function consumeWithInbox(options: ConsumeInboxOptions): MessageHandler {
  const schema = assertSchemaName(options.schema);
  const group = assertConsumerGroup(options.consumerGroup);
  const qSchema = quoteIdent(schema);

  return async (msg: IncomingMessage) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.value) as unknown;
    } catch {
      await options.onConsumerDlq(msg, 'ENVELOPE_INVALID');
      return;
    }
    const check = validate('event-envelope', parsed);
    if (!check.valid) {
      await options.onConsumerDlq(msg, 'ENVELOPE_INVALID');
      return;
    }
    const envelope = parsed as EventEnvelope;
    if (!options.supportedVersions.includes(envelope.schema_version)) {
      throw new OutboxError('SF-SYS-003', { details: [{ code: 'SCHEMA_VERSION_UNSUPPORTED' }] });
    }
    const topic = options.registry.getTopic(msg.topic);
    if (topic) {
      if (topic.tenancy === 'TENANT_SCOPED' && envelope.tenant_id === null) {
        await options.onConsumerDlq(msg, 'TENANCY_MISMATCH');
        return;
      }
      if (topic.tenancy === 'PLATFORM_OPERATIONAL' && envelope.tenant_id !== null) {
        await options.onConsumerDlq(msg, 'TENANCY_MISMATCH');
        return;
      }
    }
    const ht = headerTenant(msg.headers);
    if (ht !== undefined) {
      if (envelope.tenant_id === null || ht !== envelope.tenant_id) {
        await options.onConsumerDlq(msg, 'TENANT_HEADER_MISMATCH');
        return;
      }
    }
    if (envelope.tenant_id !== null) {
      if (
        envelope.tenant_id === NIL ||
        envelope.tenant_id !== envelope.tenant_id.toLowerCase() ||
        !UUID.test(envelope.tenant_id)
      ) {
        await options.onConsumerDlq(msg, 'TENANT_INVALID');
        return;
      }
    }

    const client = await options.pool.connect();
    try {
      await client.query('BEGIN');
      const ctx = {
        tenant_id: envelope.tenant_id,
        cell_id: envelope.cell_id || options.cellId,
        actor: options.workerActor,
        roles: [] as string[],
        jurisdiction_ids: [] as string[],
        auth_assurance: 'WORKLOAD_IDENTITY' as const,
        correlation_id: envelope.correlation_id,
        trace_id: envelope.correlation_id,
      };
      const settings = dbSessionSettings(ctx);
      for (const [key, value] of Object.entries(settings)) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const table = envelope.tenant_id === null ? INBOX_TABLE_PLATFORM : INBOX_TABLE;
      const qTable = quoteIdent(table);
      const insertSql =
        envelope.tenant_id === null
          ? 'INSERT INTO ' +
            qSchema +
            '.' +
            qTable +
            ' (consumer_group, event_id) VALUES ($1, $2::uuid) ON CONFLICT DO NOTHING'
          : 'INSERT INTO ' +
            qSchema +
            '.' +
            qTable +
            ' (consumer_group, event_id, tenant_id) VALUES ($1, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING';
      const ins =
        envelope.tenant_id === null
          ? await client.query(insertSql, [group, envelope.event_id])
          : await client.query(insertSql, [group, envelope.event_id, envelope.tenant_id]);
      if ((ins.rowCount ?? 0) === 0) {
        inboxDuplicates.add(1);
        await client.query('COMMIT');
        return;
      }
      await options.handler(asOutboxTx(client), envelope);
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep
      }
      throw e;
    } finally {
      client.release();
    }
  };
}
