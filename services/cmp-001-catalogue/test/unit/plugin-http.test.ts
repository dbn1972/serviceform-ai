import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { registerCatalogue } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { frozenClock } from '../doubles/clock.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TRACE = '0af7651916cd43dd8448eb211c80319c';
const CAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SVC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: partial.actor.type === 'PRIVILEGED_ADMIN' ? ['PLATFORM_OPERATOR'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: partial.auth_assurance ?? 'MFA',
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

describe('plugin HTTP unit (memory pool)', () => {
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
    await registerCatalogue(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
      clock: frozenClock('2026-10-04T12:00:00.000Z'),
    });
    fixtures.set(
      'officer-t1',
      ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    fixtures.set(
      'officer-t2',
      ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    fixtures.set(
      'admin-a',
      ctx({
        tenant_id: null,
        actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A },
        auth_assurance: 'MFA',
      }),
    );
    fixtures.set(
      'admin-nomfa',
      ctx({
        tenant_id: null,
        actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A },
        auth_assurance: 'PASSWORD',
      }),
    );
  });

  beforeEach(() => {
    authorizer.denies.clear();
    authorizer.throws = false;
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses to boot when a critical connector is SIMULATED in PRODUCTION', async () => {
    const boot = Fastify({ logger: false });
    await expect(
      registerCatalogue(boot, {
        prefix: '/v1',
        pool: createMemoryPool(emptyStore()),
        resolveContext: fixtureResolver,
        authorizer,
        connectorBindings: [{ critical: true, mode: 'SIMULATED', environment: 'PRODUCTION' }],
      }),
    ).rejects.toMatchObject({ code: 'SF-INT-001' });
    await boot.close();
  });

  it('denies missing auth and forged tenant headers', async () => {
    const unauth = await app.inject({ method: 'GET', url: '/v1/categories' });
    expect(unauth.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'GET',
      url: '/v1/categories',
      headers: { ...bearer('officer-t1'), 'x-tenant-id': T2 },
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json()).not.toHaveProperty('items');
  });

  it('creates category and canonical service as privileged admin', async () => {
    const cat = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: { ...bearer('admin-a'), 'idempotency-key': key('cat') },
      payload: { category_code: 'FAMILY_A', display_label: 'Family A' },
    });
    expect(cat.statusCode).toBe(201);
    store.categories[0] = {
      category_id: CAT,
      category_code: 'FAMILY_A',
      display_label: 'Family A',
      parent_category_id: null,
      status: 'ACTIVE',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/canonical-services',
      headers: { ...bearer('admin-a'), 'idempotency-key': key('svc') },
      payload: {
        service_code: 'svc-alpha',
        category_id: CAT,
        title: 'Alpha',
        summary: 'Generic descriptor',
        tags: ['civil-docs'],
      },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: '/v1/categories',
      headers: bearer('admin-a'),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.length).toBeGreaterThan(0);
  });

  it('refuses privileged catalogue writes without MFA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: { ...bearer('admin-nomfa'), 'idempotency-key': key('nomfa') },
      payload: { category_code: 'FAMILY_B', display_label: 'Family B' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates tenant offering, version, binding; rejects client tenant and pin', async () => {
    store.canonical.push({
      canonical_service_id: SVC,
      service_code: 'svc-alpha',
      category_id: CAT,
      status: 'DRAFT',
    });
    store.canonicalVersions.push({
      canonical_service_id: SVC,
      version_no: 1,
      title: 'Alpha',
      summary: 'Generic descriptor',
      tags: ['civil-docs'],
      status: 'DRAFT',
    });
    const pin = await app.inject({
      method: 'POST',
      url: '/v1/offerings',
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('pin') },
      payload: {
        canonical_service_id: SVC,
        offering_code: 'off-alpha',
        local_name: 'Local offering',
        published_pin_ref: 'should-fail',
      },
    });
    expect(pin.statusCode).toBe(400);
    const tenantBody = await app.inject({
      method: 'POST',
      url: '/v1/offerings',
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('ten') },
      payload: {
        canonical_service_id: SVC,
        offering_code: 'off-alpha',
        local_name: 'Local offering',
        tenant_id: T2,
      },
    });
    expect([400, 403]).toContain(tenantBody.statusCode);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/offerings',
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('off') },
      payload: {
        canonical_service_id: SVC,
        offering_code: 'off-alpha',
        local_name: 'Local offering',
        tags: ['civil-docs'],
      },
    });
    expect(created.statusCode).toBe(201);
    const offeringId = created.json().offering_id as string;
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/offerings?tag=civil-docs',
      headers: bearer('officer-t1'),
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json().items.some((r: { offering_id: string }) => r.offering_id === offeringId),
    ).toBe(true);
    const ver = await app.inject({
      method: 'POST',
      url: `/v1/offerings/${offeringId}/versions`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('ver') },
      payload: { local_name: 'Local offering v2', status: 'READY' },
    });
    expect(ver.statusCode).toBe(201);
    const bind = await app.inject({
      method: 'POST',
      url: `/v1/offerings/${offeringId}/bindings`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('bind') },
      payload: {
        jurisdiction_ref: randomUUID(),
        target_type: 'OFFICE',
        target_ref: randomUUID(),
      },
    });
    expect(bind.statusCode).toBe(201);
    const got = await app.inject({
      method: 'GET',
      url: `/v1/offerings/${offeringId}`,
      headers: bearer('officer-t1'),
    });
    expect(got.statusCode).toBe(200);
    expect(got.headers['cache-control']).toContain('private');
  });

  it('fail-closes PDP timeout and OPA deny', async () => {
    authorizer.throws = true;
    const timeout = await app.inject({
      method: 'GET',
      url: '/v1/categories',
      headers: bearer('officer-t1'),
    });
    expect(timeout.statusCode).toBe(503);
    authorizer.throws = false;
    authorizer.denies.add('CATALOGUE_OFFERING_READ');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/offerings',
      headers: bearer('officer-t1'),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('replays identical idempotency keys', async () => {
    const idem = key('replay');
    const first = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: { ...bearer('admin-a'), 'idempotency-key': idem },
      payload: { category_code: 'FAMILY_C', display_label: 'Family C' },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: { ...bearer('admin-a'), 'idempotency-key': idem },
      payload: { category_code: 'FAMILY_C', display_label: 'Family C' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
  });
});
