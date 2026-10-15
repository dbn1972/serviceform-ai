import type { PoolClient } from 'pg';

export const TOPIC_DOMAIN = 'sf.migration';

export function envelopeOf(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
  ctx?: { trace_id?: string; correlation_id?: string },
): {
  tenant_id: string;
  topic: string;
  event_type: string;
  payload: Record<string, unknown>;
  trace_id: string | null;
  correlation_id: string | null;
} {
  return {
    tenant_id: tenantId,
    topic: TOPIC_DOMAIN,
    event_type: eventType,
    payload,
    trace_id: ctx?.trace_id ?? null,
    correlation_id: ctx?.correlation_id ?? null,
  };
}

export async function insertOutbox(
  client: PoolClient,
  envelope: ReturnType<typeof envelopeOf>,
): Promise<void> {
  await client.query(
    `INSERT INTO sf_migration.outbox_event
       (tenant_id, topic, event_type, payload, trace_id, correlation_id, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())`,
    [
      envelope.tenant_id,
      envelope.topic,
      envelope.event_type,
      JSON.stringify(envelope.payload),
      envelope.trace_id,
      envelope.correlation_id,
    ],
  );
}
