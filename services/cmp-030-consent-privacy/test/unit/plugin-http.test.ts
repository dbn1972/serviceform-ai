import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { registerConsentPrivacy } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { frozenClock } from '../doubles/clock.js';
import type { RequestContext } from '@serviceform/contracts';
import { randomUUID } from 'node:crypto';

const T1 = '11111111-1111-4111-8111-111111111111';
const TRACE = '0af7651916cd43dd8448eb211c80319c';

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

describe('plugin HTTP guards', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    fixtures.clear();
    fixtures.set(
      'officer',
      ctx({
        tenant_id: T1,
        actor: { type: 'OFFICER', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      }),
    );
    const pool = {
      connect: async () => {
        throw new Error('pool-unused-for-guard-tests');
      },
    } as unknown as Pool;
    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerConsentPrivacy(app, {
      prefix: '/v1',
      pool,
      resolveContext: fixtureResolver,
      authorizer: new ContractAuthorizer(),
      clock: frozenClock('2026-10-04T12:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires auth and rejects tenant-identifying headers', async () => {
    const unauth = await app.inject({ method: 'GET', url: '/v1/purposes' });
    expect(unauth.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'GET',
      url: '/v1/purposes',
      headers: { authorization: 'Bearer officer', 'x-tenant-id': T1 },
    });
    expect(forged.statusCode).toBe(403);
    const badBody = await app.inject({
      method: 'POST',
      url: '/v1/privacy/access-check',
      headers: { authorization: 'Bearer officer' },
      payload: { subject_id: 'not-a-uuid', purpose_code: 'X' },
    });
    expect(badBody.statusCode).toBe(400);
  });
});
