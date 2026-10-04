import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerMakerChecker } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const MAKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHECKER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TRACE = '0af7651916cd43dd8448eb211c80319c';
const HASH = `sha256:${'ab'.repeat(32)}`;
const SUBJECT = '33333333-3333-4333-8333-333333333333';

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

describe('CMP-051 plugin HTTP unit (memory pool)', () => {
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
    await registerMakerChecker(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
      config: loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_CMP051_METADATA_MODE: 'SIMULATED' }),
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
    });
    fixtures.set('maker', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: MAKER } }));
    fixtures.set('checker', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: CHECKER } }));
    fixtures.set('t2', ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: MAKER } }));
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
      url: `/v1/publication-requests/${randomUUID()}`,
    });
    expect(unauth.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'GET',
      url: `/v1/publication-requests/${randomUUID()}`,
      headers: { ...bearer('maker'), 'x-tenant-id': T2 },
    });
    expect(forged.statusCode).toBe(403);
  });

  it('requires a distinct checker before approval', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/publication-requests',
      headers: { ...bearer('maker'), 'idempotency-key': key('create') },
      payload: { subject_id: SUBJECT, proposed_hash: HASH },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { request_id: string }).request_id;

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/publication-requests',
      headers: { ...bearer('maker'), 'idempotency-key': key('create-used') },
      payload: { subject_id: SUBJECT, proposed_hash: HASH },
    });
    expect(replay.statusCode).toBe(201);

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/publication-requests/${id}/submit`,
      headers: { ...bearer('maker'), 'idempotency-key': key('sub') },
    });
    expect(submitted.statusCode).toBe(200);
    expect((submitted.json() as { status: string }).status).toBe('SUBMITTED');

    const selfApprove = await app.inject({
      method: 'POST',
      url: `/v1/publication-requests/${id}/approve`,
      headers: { ...bearer('maker'), 'idempotency-key': key('self') },
      payload: { reason: 'self-approval-forbidden' },
    });
    expect(selfApprove.statusCode).toBe(403);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/publication-requests/${id}/approve`,
      headers: { ...bearer('checker'), 'idempotency-key': key('ok') },
      payload: { reason: 'checker-approval' },
    });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as { status: string }).status).toBe('APPROVED');
  });
});
