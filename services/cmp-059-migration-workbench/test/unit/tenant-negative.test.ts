/**
 * Tenant-negative / security tests for CMP-059.
 * INT-011: Tenant isolation enforcement chain.
 * Ensures tenant_id from context is NEVER overridable by request headers or body.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerMigration } from '../../src/plugin.js';
import { AllowAuthorizer, DenyAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { createMemoryPool, emptyStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ctx(tenantId: string, extra: Partial<RequestContext> = {}): RequestContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: ACTOR },
    roles: ['MIGRATION_OPERATOR'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    ...extra,
  };
}

describe('CMP-059 tenant-negative / INT-011', () => {
  let app: FastifyInstance;
  const config = loadConfig({ SF_ENVIRONMENT: 'LOCAL' });
  const store = emptyStore();

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerMigration(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer: new AllowAuthorizer(),
      config,
      clock: () => new Date('2026-10-15T12:00:00.000Z'),
    });
    fixtures.set('t1', ctx(T1));
    fixtures.set('t2', ctx(T2));
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects request with x-roles header (forbidden header)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/migrations/projects',
      headers: {
        authorization: 'Bearer t1',
        'content-type': 'application/json',
        'x-roles': 'ADMIN',
      },
      body: JSON.stringify({ display_name: 'X', source_system_ref: 'Y' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects request without auth token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/migrations/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'X', source_system_ref: 'Y' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('tenant T2 cannot access T1 project (404 due to RLS filter)', async () => {
    // Create a project for T1
    const create = await app.inject({
      method: 'POST',
      url: '/v1/migrations/projects',
      headers: { authorization: 'Bearer t1', 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'T1 Project', source_system_ref: 'T1-SYS' }),
    });
    expect(create.statusCode).toBe(201);
    const { project_id } = create.json<{ project_id: string }>();

    // T2 attempts to read T1's reconciliation (project not found for T2 tenant scope)
    const res = await app.inject({
      method: 'GET',
      url: `/v1/migrations/${project_id}/reconciliation`,
      headers: { authorization: 'Bearer t2' },
    });
    // Should be 404 because no project exists in T2's tenant scope
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when authorizer denies', async () => {
    let denyApp: FastifyInstance | undefined;
    try {
      denyApp = Fastify({ logger: false });
      await registerMigration(denyApp, {
        prefix: '/v1',
        pool: createMemoryPool(emptyStore()),
        resolveContext: fixtureResolver,
        authorizer: new DenyAuthorizer(),
        config,
        clock: () => new Date('2026-10-15T12:00:00.000Z'),
      });
      fixtures.set('deny-t1', ctx(T1));
      const res = await denyApp.inject({
        method: 'POST',
        url: '/v1/migrations/projects',
        headers: { authorization: 'Bearer deny-t1', 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: 'X', source_system_ref: 'SYS-001' }),
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await denyApp?.close();
    }
  });
});
