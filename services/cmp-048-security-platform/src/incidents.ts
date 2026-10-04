import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type { Pool } from 'pg';
import { withTenantTx } from './db/tx.js';
import { envelope } from './events/envelopes.js';
import { writeOutbox } from './events/outbox-writer.js';

export async function reportIncident(
  pool: Pool,
  ctx: RequestContext,
  data: { incident_code: string; reason_code: string; decision_id?: string },
): Promise<{ id: string }> {
  const id = randomUUID();
  await withTenantTx(pool, ctx, async (c) => {
    const ev = envelope(ctx, {
      event_type: 'SecurityIncidentDetected',
      aggregate_type: 'SecurityIncident',
      aggregate_id: id,
      aggregate_version: 1,
      tenant_id: ctx.tenant_id,
      data,
    });
    await writeOutbox(c, ev, 'sf.security.events.v1');
  });
  return { id };
}
