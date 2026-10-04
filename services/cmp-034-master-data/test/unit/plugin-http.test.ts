import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { registerMasterData } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { localSimulatedBinding } from '../doubles/connector-example.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRACE = '0af7651916cd43dd8448eb211c80319c';

const simBinding = localSimulatedBinding({
  tenant_id: T1,
  connector_type: 'DEPARTMENT_API',
});

function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...partial,
  };
}

function bearer(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

function idem(label: string): Record<string, string> {
  return { 'idempotency-key': `idem-${label}-${randomUUID().slice(0, 8)}` };
}

describe('CMP-034 plugin HTTP unit (memory pool)', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let authorizer: ContractAuthorizer;

  beforeAll(async () => {
    store = emptyStore();
    authorizer = new ContractAuthorizer();
    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerMasterData(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
      environment: 'LOCAL',
    });
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR } }));
    fixtures.set('t2', ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR } }));
  });

  beforeEach(() => {
    authorizer.denies.clear();
    authorizer.throws = false;
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies missing auth and forged tenant headers', async () => {
    const unauth = await app.inject({ method: 'GET', url: '/v1/code-sets' });
    expect(unauth.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'GET',
      url: '/v1/code-sets',
      headers: { ...bearer('t1'), 'x-tenant-id': T2 },
    });
    expect(forged.statusCode).toBe(403);
  });

  it('draft values, import SIMULATED, publish, pin, resolve', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/code-sets',
      headers: { ...bearer('t1'), ...idem('set') },
      payload: { set_code: 'GENERIC_SET', localization_key: 'md.generic_set' },
    });
    expect(created.statusCode).toBe(201);
    const setId = (created.json() as { code_set_id: string }).code_set_id;

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/code-sets',
      headers: bearer('t1'),
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    const got = await app.inject({
      method: 'GET',
      url: `/v1/code-sets/${setId}`,
      headers: bearer('t1'),
    });
    expect(got.statusCode).toBe(200);

    const version = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions`,
      headers: { ...bearer('t1'), ...idem('ver') },
      payload: { jurisdiction_ref: 'opaque-jur-ref' },
    });
    expect(version.statusCode).toBe(201);
    const versionNo = (version.json() as { version_no: number }).version_no;

    const versions = await app.inject({
      method: 'GET',
      url: `/v1/code-sets/${setId}/versions`,
      headers: bearer('t1'),
    });
    expect(versions.statusCode).toBe(200);

    const values = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/values`,
      headers: { ...bearer('t1'), ...idem('val') },
      payload: {
        items: [{ value_code: 'ITEM_Z', localization_key: 'md.z', sort_order: 9 }],
      },
    });
    expect(values.statusCode).toBe(201);

    const imported = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/import`,
      headers: { ...bearer('t1'), ...idem('imp') },
      payload: {
        connector_binding: simBinding,
        scenario: 'code_list_success',
        test_run_id: 'ci-md-unit',
      },
    });
    expect(imported.statusCode).toBe(201);

    const published = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/publish`,
      headers: { ...bearer('t1'), ...idem('pub') },
      payload: { reason: 'release-1' },
    });
    expect(published.statusCode).toBe(200);

    const mutate = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/values`,
      headers: { ...bearer('t1'), ...idem('mut') },
      payload: {
        items: [{ value_code: 'ITEM_Q', localization_key: 'md.q', sort_order: 1 }],
      },
    });
    expect(mutate.statusCode).toBe(400);

    const bind = await app.inject({
      method: 'POST',
      url: '/v1/code-set-bindings',
      headers: { ...bearer('t1'), ...idem('bind') },
      payload: {
        code_set_id: setId,
        pinned_version_no: versionNo,
        target_type: 'OFFERING',
        target_ref: 'offering-ref-1',
      },
    });
    expect(bind.statusCode).toBe(201);

    const resolved = await app.inject({
      method: 'GET',
      url: `/v1/code-sets/${setId}/resolve`,
      headers: bearer('t1'),
    });
    expect(resolved.statusCode).toBe(200);
    expect((resolved.json() as { version_no: number }).version_no).toBe(versionNo);
  });
});
