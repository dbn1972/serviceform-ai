import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { registerMetadata } from '../../src/plugin.js';
import { loadConfig } from '../../src/config.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRACE = '0af7651916cd43dd8448eb211c80319c';

function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: ['SERVICE_DESIGNER'],
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

function key(label: string): string {
  return `idem-${label}-${randomUUID().slice(0, 8)}`;
}

describe('CMP-033 plugin HTTP unit (memory pool)', () => {
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
    await registerMetadata(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
      config: loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_METADATA_SCHEMA_MODE: 'SIMULATED' }),
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
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
    const unauth = await app.inject({
      method: 'GET',
      url: `/v1/metadata/documents/${randomUUID()}`,
    });
    expect(unauth.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'GET',
      url: `/v1/metadata/documents/${randomUUID()}`,
      headers: { ...bearer('t1'), 'x-tenant-id': T2 },
    });
    expect(forged.statusCode).toBe(403);
  });

  it('creates, reads, patches, validates, publishes a SERVICE document', async () => {
    const createKey = key('create');
    const created = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: { ...bearer('t1'), 'idempotency-key': createKey },
      payload: {
        kind: 'SERVICE',
        document_key: 'svc.alpha',
        payload: { code: 'generic_service', title: 'Service' },
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { document_id: string; status: string };
    expect(body.status).toBe('DRAFT');

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: { ...bearer('t1'), 'idempotency-key': createKey },
      payload: {
        kind: 'SERVICE',
        document_key: 'svc.alpha',
        payload: { code: 'generic_service', title: 'Service' },
      },
    });
    expect(replay.statusCode).toBe(201);

    const read = await app.inject({
      method: 'GET',
      url: `/v1/metadata/documents/${body.document_id}`,
      headers: bearer('t1'),
    });
    expect(read.statusCode).toBe(200);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/metadata/documents/${body.document_id}`,
      headers: { ...bearer('t1'), 'idempotency-key': key('patch') },
      payload: { payload: { code: 'generic_service', title: 'Updated' } },
    });
    expect(patched.statusCode).toBe(200);

    const validated = await app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${body.document_id}/validate`,
      headers: { ...bearer('t1'), 'idempotency-key': key('val') },
    });
    expect(validated.statusCode).toBe(200);
    expect((validated.json() as { status: string }).status).toBe('VALIDATED');

    const published = await app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${body.document_id}/publish`,
      headers: { ...bearer('t1'), 'idempotency-key': key('pub') },
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as { status: string }).status).toBe('PUBLISHED');

    const mutate = await app.inject({
      method: 'PATCH',
      url: `/v1/metadata/documents/${body.document_id}`,
      headers: { ...bearer('t1'), 'idempotency-key': key('mut') },
      payload: { payload: { code: 'generic_service', title: 'Nope' } },
    });
    expect(mutate.statusCode).toBe(400);
  });

  it('composes a bundle and rejects invalid ids', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: { ...bearer('t1'), 'idempotency-key': key('svc2') },
      payload: {
        kind: 'FORM',
        document_key: 'form.alpha',
        payload: { pages: [{ id: 'page.one', fields: [{ id: 'field.a', control: 'text' }] }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { document_id: string }).document_id;
    const validated = await app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${id}/validate`,
      headers: { ...bearer('t1'), 'idempotency-key': key('val2') },
    });
    expect(validated.statusCode).toBe(200);

    const bundle = await app.inject({
      method: 'POST',
      url: '/v1/metadata/bundles',
      headers: { ...bearer('t1'), 'idempotency-key': key('bun') },
      payload: { bundle_key: 'bundle.alpha', document_ids: [id] },
    });
    expect(bundle.statusCode).toBe(201);
    expect((bundle.json() as { missing_kinds: string[] }).missing_kinds.length).toBeGreaterThan(0);

    const badId = await app.inject({
      method: 'GET',
      url: '/v1/metadata/documents/not-a-uuid',
      headers: bearer('t1'),
    });
    expect(badId.statusCode).toBe(400);

    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1'),
      payload: { kind: 'SERVICE', document_key: 'svc.beta', payload: { code: 'x', title: 'x' } },
    });
    expect(missingKey.statusCode).toBe(400);
  });
});
