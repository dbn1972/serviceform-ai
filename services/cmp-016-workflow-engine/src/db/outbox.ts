import { randomUUID } from 'node:crypto';
import { Cmp016Error } from '../errors.js';
import { isUuid } from '../domain/model.js';
import type { WorkflowContext } from '../ports.js';
import type { SqlClient } from './tx.js';

export const TOPIC_DOMAIN = 'sf.workflow.events.v1';
export const TOPIC_AUDIT = 'sf.audit.ingest.v1';

export const DOMAIN_EVENT_TYPES = [
  'WorkflowVersionPublished',
  'WorkflowVersionRetired',
  'WorkflowInstanceStarted',
  'WorkflowRequestRecorded',
  'WorkflowInstanceMigrated',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number] | 'AuditEventSubmitted';

/** SF-CON-EVENT-ENVELOPE v1 (snake_case, ADR-0002). */
export interface EventEnvelope<T extends object = Record<string, unknown>> {
  event_id: string;
  event_type: DomainEventType;
  schema_version: number;
  tenant_id: string;
  cell_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  correlation_id: string;
  actor: { type: string; id: string };
  data: T;
}

export function envelopeOf<T extends object>(
  ctx: WorkflowContext,
  params: {
    eventType: DomainEventType;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    occurredAt: string;
    data: T;
  },
): EventEnvelope<T> {
  return {
    event_id: randomUUID(),
    event_type: params.eventType,
    schema_version: 1,
    tenant_id: ctx.tenant_id,
    cell_id: ctx.cell_id,
    aggregate_type: params.aggregateType,
    aggregate_id: params.aggregateId,
    aggregate_version: params.aggregateVersion,
    occurred_at: params.occurredAt,
    correlation_id: ctx.correlation_id,
    actor: { type: ctx.actor.type, id: ctx.actor.id },
    data: params.data,
  };
}

function assertEnvelope(env: EventEnvelope<object>): void {
  const ok =
    isUuid(env.event_id) &&
    isUuid(env.tenant_id) &&
    isUuid(env.aggregate_id) &&
    isUuid(env.correlation_id) &&
    isUuid(env.actor.id) &&
    /^[A-Z][A-Za-z0-9]{2,79}$/.test(env.event_type) &&
    /^[A-Z][A-Za-z0-9]{1,63}$/.test(env.aggregate_type) &&
    /^cell-[a-z0-9-]{1,40}$/.test(env.cell_id) &&
    Number.isInteger(env.aggregate_version) &&
    env.aggregate_version >= 0;
  if (!ok) throw new Cmp016Error('SF-SYS-001', [{ code: 'INVALID_ENVELOPE' }]);
}

/** Inserts exactly one tenant outbox row in the caller's open transaction (SF-CON-OUTBOX rule 1). */
export async function insertOutbox(
  client: SqlClient,
  env: EventEnvelope<object>,
  topic: string = TOPIC_DOMAIN,
): Promise<string> {
  assertEnvelope(env);
  const partitionKey =
    topic === TOPIC_AUDIT
      ? `audit:${String((env.data as { audit_id?: string }).audit_id ?? env.aggregate_id)}`
      : env.aggregate_id;
  await client.query(
    `INSERT INTO sf_workflow.outbox_event (
       event_id, tenant_id, topic, partition_key, event_type, schema_version,
       aggregate_type, aggregate_id, aggregate_version, envelope
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      env.event_id,
      env.tenant_id,
      topic,
      partitionKey,
      env.event_type,
      env.schema_version,
      env.aggregate_type,
      env.aggregate_id,
      env.aggregate_version,
      JSON.stringify(env),
    ],
  );
  return env.event_id;
}
