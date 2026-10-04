import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerVersioning } from '../../src/plugin.js';
import { DenyApprovalPort, SimulatedApprovalPort } from '../../src/ports/approval.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { validPins } from '../fixtures/pins.js';
import { createMemoryPool, emptyStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
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

describe('CMP-052 plugin HTTP unit (memory pool)', () => {
  let app: FastifyInstance;
  const config = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_CMP052_APPROVAL_MODE: 'SIMULATED' });

  beforeAll(async () => {
    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerVersioning(app, {
      prefix: '/v1',
      pool: createMemoryPool(emptyStore()),
      resolveContext: fixtureResolver,
      authorizer: new ContractAuthorizer(),
      approval: new SimulatedApprovalPort(config, true),
      config,
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
    });
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR } }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a draft, publishes with checker approval, refuses mutation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tenant-service-bindings',
      headers: { ...bearer('t1'), 'idempotency-key': key('c') },
      payload: {
        binding_key: 'generic.offering',
        offering_ref: 'offering-1',
        metadata_bundle_ref: 'bundle-1',
        pins: validPins(),
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { binding_id: string; artifact_hash: string; status: string };
    expect(body.status).toBe('DRAFT');
    const hashBefore = body.artifact_hash;

    const published = await app.inject({
      method: 'POST',
      url: `/v1/tenant-service-bindings/${body.binding_id}/publish`,
      headers: { ...bearer('t1'), 'idempotency-key': key('p') },
    });
    expect(published.statusCode).toBe(200);
    const pub = published.json() as {
      status: string;
      artifact_hash: string;
      published_version_id: string;
    };
    expect(pub.status).toBe('PUBLISHED');
    expect(pub.artifact_hash).toBe(hashBefore);

    const mutate = await app.inject({
      method: 'PATCH',
      url: `/v1/tenant-service-bindings/${body.binding_id}`,
      headers: { ...bearer('t1'), 'idempotency-key': key('m') },
      payload: { offering_ref: 'mutated' },
    });
    expect(mutate.statusCode).toBe(400);
  });

  it('refuses publish without checker approval', async () => {
    const denyApp = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerVersioning(denyApp, {
      prefix: '/v1',
      pool: createMemoryPool(emptyStore()),
      resolveContext: fixtureResolver,
      authorizer: new ContractAuthorizer(),
      approval: new DenyApprovalPort(),
      config,
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
    });
    fixtures.set('t1d', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR } }));
    const created = await denyApp.inject({
      method: 'POST',
      url: '/v1/tenant-service-bindings',
      headers: { ...bearer('t1d'), 'idempotency-key': key('d') },
      payload: {
        binding_key: 'generic.denied',
        offering_ref: 'offering-1',
        metadata_bundle_ref: 'bundle-1',
        pins: validPins(),
      },
    });
    const id = (created.json() as { binding_id: string }).binding_id;
    const published = await denyApp.inject({
      method: 'POST',
      url: `/v1/tenant-service-bindings/${id}/publish`,
      headers: { ...bearer('t1d'), 'idempotency-key': key('dp') },
    });
    expect(published.statusCode).toBe(400);
    expect((published.json() as { details?: { code: string }[] }).details?.[0]?.code).toBe(
      'CHECKER_APPROVAL_REQUIRED',
    );
    await denyApp.close();
  });
});
