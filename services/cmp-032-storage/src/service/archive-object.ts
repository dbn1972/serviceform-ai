import type { RequestContext } from '@serviceform/contracts';
import type { ObjectStorePort } from '@serviceform/storage';
import type { PoolClient } from 'pg';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { Cmp032Error } from '../errors.js';
import { archiveObjectMetadata, getObjectMetadata } from '../repo/object-repo.js';

export async function archiveObject(
  client: PoolClient,
  deps: {
    ctx: RequestContext;
    store: ObjectStorePort;
    now: Date;
  },
  objectId: string,
): Promise<{ object_id: string; status: string; aggregate_version: number }> {
  const tenantId = deps.ctx.tenant_id;
  if (!tenantId) throw new Cmp032Error('SF-TEN-001');

  const existing = await getObjectMetadata(client, objectId);
  if (!existing || existing.status === 'DELETED') throw new Cmp032Error('SF-SYS-002');
  if (existing.tenant_id !== tenantId) throw new Cmp032Error('SF-AUTH-002');
  if (existing.status === 'ARCHIVED') {
    return {
      object_id: objectId,
      status: 'ARCHIVED',
      aggregate_version: Number(existing.aggregate_version),
    };
  }

  await deps.store.archive(objectId);
  const row = await archiveObjectMetadata(client, objectId, deps.now);
  if (!row) throw new Cmp032Error('SF-APP-001');

  const event = envelopeOf({
    eventType: 'ObjectArchived',
    tenantId,
    cellId: deps.ctx.cell_id,
    aggregateType: 'StorageObject',
    aggregateId: objectId,
    aggregateVersion: Number(row.aggregate_version),
    occurredAt: deps.now.toISOString(),
    correlationId: deps.ctx.correlation_id,
    actor: deps.ctx.actor,
    data: {
      object_id: objectId,
      object_key: row.object_key,
      status: 'ARCHIVED',
    },
  });
  await insertOutbox(client, event);

  return {
    object_id: objectId,
    status: 'ARCHIVED',
    aggregate_version: Number(row.aggregate_version),
  };
}
