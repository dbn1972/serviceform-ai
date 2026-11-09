import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerConsentPrivacy } from '../../src/plugin.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const PURPOSE = '0d15ba00-3030-4000-8000-0d15ba003030';

/** A citizen records consent only for themselves, as SELF; assisted bases are for officers. */
describe('CMP-030 citizen consent basis', () => {
  let app: FastifyInstance;
  let poolUsed = 0;

  beforeAll(async () => {
    const citizen: RequestContext = {
      tenant_id: T1,
      cell_id: 'cell-01',
      actor: { type: 'CITIZEN', id: CITIZEN },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'OTP',
      correlation_id: randomUUID(),
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    };
    app = Fastify({ logger: false });
    await registerConsentPrivacy(app, {
      prefix: '/v1',
      pool: {
        connect: async () => {
          poolUsed += 1;
          throw new Error('pool-unused');
        },
      } as unknown as Pool,
      resolveContext: async () => citizen,
      authorizer: {
        decide: async () => ({
          allow: true,
          decision_id: '00000000-0000-4000-8000-0000000000d1',
          reason_code: 'ALLOW',
          policy_revision: 'test',
        }),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['ASSISTED', 'LEGAL_REP'] as const)(
    'refuses a citizen granting their own consent as %s before any write',
    async (basis) => {
      poolUsed = 0;
      const res = await app.inject({
        method: 'POST',
        url: '/v1/consents',
        headers: { 'idempotency-key': `basis-${basis}-0001` },
        payload: {
          subject_id: CITIZEN,
          purpose_id: PURPOSE,
          channel: 'WEB',
          representation_basis: basis,
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        error_code: 'SF-AUTH-002',
        details: [{ code: 'CITIZEN_SELF_ONLY' }],
      });
      expect(poolUsed).toBe(0);
    },
  );

  it('lets a citizen SELF grant reach the store', async () => {
    poolUsed = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: { 'idempotency-key': 'basis-SELF-0001' },
      payload: {
        subject_id: CITIZEN,
        purpose_id: PURPOSE,
        channel: 'WEB',
        representation_basis: 'SELF',
      },
    });
    expect(poolUsed).toBe(1);
    expect(res.statusCode).toBe(500);
  });
});
