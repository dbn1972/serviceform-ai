import { describe, expect, it } from 'vitest';
import { SimulatedObjectStore } from '@serviceform/storage';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { LocalWrapKms } from '../../src/ports/kms-port.js';
import { storeObject } from '../../src/service/store-object.js';
import { Cmp032Error } from '../../src/errors.js';

const ctx: RequestContext = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('storeObject (unit doubles)', () => {
  it('KMS failure fails closed before store', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('storage_policy') && sql.includes('SELECT')) {
          return {
            rows: [
              {
                policy_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                tenant_id: ctx.tenant_id,
                encryption_algorithm: 'AES_256_GCM',
                kms_key_ref: 'local/k',
                max_object_bytes: '10485760',
                allowed_content_types: ['application/octet-stream'],
                retention_class: 'STANDARD',
                status: 'ACTIVE',
                version: '1',
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await expect(
      storeObject(
        client as never,
        {
          ctx,
          config: loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_STORAGE_MODE: 'SIMULATED' }),
          store: new SimulatedObjectStore(),
          kms: new LocalWrapKms(true),
          now: new Date('2026-10-04T00:00:00.000Z'),
        },
        {
          contentType: 'application/octet-stream',
          contentBase64: Buffer.from('abc').toString('base64'),
        },
      ),
    ).rejects.toBeInstanceOf(Cmp032Error);
    expect(queries.some((q) => q.includes('INSERT INTO sf_storage.object_metadata'))).toBe(false);
  });
});
