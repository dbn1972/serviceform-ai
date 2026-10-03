import { validate, type EventEnvelope } from '@serviceform/contracts';
import { OutboxError } from './errors.js';
import { assertSchemaName, assertTopicName, quoteIdent } from './identifiers.js';
import { MAX_ENVELOPE_BYTES, OUTBOX_TABLE, OUTBOX_TABLE_PLATFORM } from './sql.js';
import type { OutboxTx } from './tx.js';

export interface InsertOutboxEventInput {
  schema: string;
  topic: string;
  envelope: EventEnvelope;
  partitionKey?: string;
  /** Event types permitted as platform (null-tenant) rows inside a tenant-context transaction. Empty by default. */
  platformAllowlist?: readonly string[];
}

export async function insertOutboxEvent(
  tx: OutboxTx,
  input: InsertOutboxEventInput,
): Promise<void> {
  const schema = assertSchemaName(input.schema);
  const topic = assertTopicName(input.topic);
  const result = validate('event-envelope', input.envelope);
  if (!result.valid) {
    throw new OutboxError('SF-SYS-003', {
      details: [
        { code: 'ENVELOPE_INVALID', message: 'event envelope failed SF-CON-EVENT-ENVELOPE' },
      ],
    });
  }
  const envelope = input.envelope;
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
  if (payload.byteLength > MAX_ENVELOPE_BYTES) {
    throw new OutboxError('SF-SYS-003', {
      details: [
        {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'payload too large, reference S3 object instead',
        },
      ],
    });
  }
  const partitionKey = input.partitionKey ?? envelope.aggregate_id;
  if (partitionKey.length < 1 || partitionKey.length > 200) {
    throw new OutboxError('SF-SYS-003', {
      details: [{ code: 'PARTITION_KEY_INVALID' }],
    });
  }

  const ctx = await tx.query<{ tid: string | null }>(
    'SELECT sf_platform.current_tenant_id() AS tid',
  );
  const currentTenant = ctx.rows[0]?.tid ?? null;

  if (envelope.tenant_id !== null) {
    if (currentTenant === null) {
      throw new OutboxError('SF-TEN-001');
    }
    if (currentTenant !== envelope.tenant_id) {
      throw new OutboxError('SF-TEN-002');
    }
  } else if (currentTenant !== null) {
    const allow = input.platformAllowlist ?? [];
    if (!allow.includes(envelope.event_type)) {
      throw new OutboxError('SF-SYS-003', {
        details: [{ code: 'PLATFORM_EVENT_NOT_ALLOWLISTED' }],
      });
    }
  }

  const table = envelope.tenant_id === null ? OUTBOX_TABLE_PLATFORM : OUTBOX_TABLE;
  const qSchema = quoteIdent(schema);
  const qTable = quoteIdent(table);

  if (envelope.tenant_id === null) {
    const sql =
      'INSERT INTO ' +
      qSchema +
      '.' +
      qTable +
      ' (event_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)' +
      ' VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8, $9::jsonb)';
    await tx.query(sql, [
      envelope.event_id,
      topic,
      partitionKey,
      envelope.event_type,
      envelope.schema_version,
      envelope.aggregate_type,
      envelope.aggregate_id,
      envelope.aggregate_version,
      payload.toString('utf8'),
    ]);
    return;
  }

  const sql =
    'INSERT INTO ' +
    qSchema +
    '.' +
    qTable +
    ' (event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)' +
    ' VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid, $9, $10::jsonb)';
  await tx.query(sql, [
    envelope.event_id,
    envelope.tenant_id,
    topic,
    partitionKey,
    envelope.event_type,
    envelope.schema_version,
    envelope.aggregate_type,
    envelope.aggregate_id,
    envelope.aggregate_version,
    payload.toString('utf8'),
  ]);
}
