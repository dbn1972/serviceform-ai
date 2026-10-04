import { randomUUID } from 'node:crypto';
import {
  validate,
  type Actor,
  type EventEnvelope,
  type RequestContext,
} from '@serviceform/contracts';

export function envelope<T extends object>(
  ctx: RequestContext,
  opts: {
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
    tenant_id: string | null;
    data: T;
  },
): EventEnvelope<T> {
  const ev: EventEnvelope<T> = {
    event_id: randomUUID(),
    event_type: opts.event_type,
    schema_version: 1,
    tenant_id: opts.tenant_id,
    cell_id: ctx.cell_id,
    aggregate_type: opts.aggregate_type,
    aggregate_id: opts.aggregate_id,
    aggregate_version: opts.aggregate_version,
    occurred_at: new Date().toISOString(),
    correlation_id: ctx.correlation_id,
    actor: ctx.actor as Actor,
    data: opts.data,
  };
  const check = validate('event-envelope', ev);
  if (!check.valid) throw new Error('event envelope failed SF-CON-EVENT-ENVELOPE');
  return ev;
}
