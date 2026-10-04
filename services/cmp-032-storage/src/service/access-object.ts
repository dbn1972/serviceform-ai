import type { RequestContext } from '@serviceform/contracts';
import {
  createSimulatedPresign,
  type ObjectStorePort,
  type StorageSecretsPort,
} from '@serviceform/storage';
import type { PoolClient } from 'pg';
import type { StorageServiceConfig } from '../config.js';
import { Cmp032Error } from '../errors.js';
import { getObjectMetadata } from '../repo/object-repo.js';

export async function accessObject(
  client: PoolClient,
  deps: {
    ctx: RequestContext;
    config: StorageServiceConfig;
    store: ObjectStorePort;
    secrets: StorageSecretsPort;
    now: Date;
  },
  objectId: string,
): Promise<{
  object_id: string;
  access_url: string;
  expires_at: string;
  method: 'GET';
  storage_mode: string;
  simulation?: unknown;
}> {
  const tenantId = deps.ctx.tenant_id;
  if (!tenantId) throw new Cmp032Error('SF-TEN-001');

  const meta = await getObjectMetadata(client, objectId);
  if (!meta || meta.status === 'DELETED') throw new Cmp032Error('SF-SYS-002');
  if (meta.tenant_id !== tenantId) throw new Cmp032Error('SF-AUTH-002');

  const bytes = await deps.store.getBytes(objectId);
  if (!bytes) throw new Cmp032Error('SF-SYS-002');

  const expiresAt = new Date(deps.now.getTime() + deps.config.presignTtlSeconds * 1000);
  let access;
  try {
    access = await createSimulatedPresign({
      secrets: deps.secrets,
      secretName: deps.config.presignSecretName,
      objectId,
      objectKey: meta.object_key,
      expiresAt,
      ...(meta.simulation ? { simulation: meta.simulation } : {}),
    });
  } catch (err) {
    throw new Cmp032Error('SF-SYS-004', {
      details: [{ code: 'PRESIGN_SECRET_UNAVAILABLE' }],
      cause: err,
    });
  }

  return {
    object_id: objectId,
    access_url: access.url,
    expires_at: access.expiresAt,
    method: 'GET',
    storage_mode: meta.storage_mode,
    ...(access.simulation ? { simulation: access.simulation } : {}),
  };
}
