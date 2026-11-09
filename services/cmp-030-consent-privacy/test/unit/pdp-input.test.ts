import { randomUUID } from 'node:crypto';
import type { AuthzDecisionInput, RequestContext } from '@serviceform/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerConsentPrivacy } from '../../src/plugin.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const OTHER = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const PURPOSE = '0d15ba00-3030-4000-8000-0d15ba003030';

/** SF-M10-B-2d: the PDP sees the consent subject as owner and the principal's assurance. */
describe('CMP-030 PDP input', () => {
  let app: FastifyInstance;
  const seen: AuthzDecisionInput[] = [];

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
          throw new Error('pool-unused');
        },
      } as unknown as Pool,
      resolveContext: async () => citizen,
      authorizer: {
        decide: async (input) => {
          seen.push(input);
          return { allow: false, reason_code: 'ROLE_NOT_PERMITTED', policy_revision: 'test' };
        },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    [
      'CONSENT_GRANT',
      'POST',
      '/v1/consents',
      { subject_id: OTHER, purpose_id: PURPOSE, channel: 'WEB' },
    ],
    ['CONSENT_READ', 'GET', `/v1/consents?subject_id=${OTHER}`, undefined],
    [
      'PRIVACY_ACCESS_CHECK',
      'POST',
      '/v1/privacy/access-check',
      { subject_id: OTHER, purpose_code: 'SAMPLE_PURPOSE' },
    ],
  ] as const)('%s names the consent subject as owner', async (action, method, url, payload) => {
    seen.length = 0;
    const res = await app.inject({
      method,
      url,
      headers: { 'idempotency-key': `k-${randomUUID()}` },
      ...(payload ? { payload } : {}),
    });
    expect(res.statusCode).toBe(403);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      action,
      subject: { user_id: CITIZEN, actor_type: 'CITIZEN', assurance: 'OTP' },
      resource: { resource_type: 'Consent', tenant_id: T1, owner_id: OTHER },
    });
  });

  it('purpose reads carry assurance and no owner', async () => {
    seen.length = 0;
    await app.inject({ method: 'GET', url: '/v1/purposes' });
    expect(seen[0]?.subject.assurance).toBe('OTP');
    expect(seen[0]?.resource).not.toHaveProperty('owner_id');
  });
});
