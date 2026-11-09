import { randomUUID } from 'node:crypto';
import type { AuthzDecisionInput, RequestContext } from '@serviceform/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerCitizenProfile } from '../../src/plugin.js';
import { AllowConsent, AlwaysSubject } from '../doubles/ports.js';
import { ACTOR_CITIZEN, BINDING, T1, TRACE, createMemoryPool, emptyStore } from './memory-pool.js';

/** SF-M10-B-2d: the PDP sees a CITIZEN_PRIVATE profile owned by the subject and the assurance. */
describe('CMP-005 PDP input', () => {
  let app: FastifyInstance;
  const seen: AuthzDecisionInput[] = [];

  beforeAll(async () => {
    const citizen: RequestContext = {
      tenant_id: T1,
      cell_id: 'cell-01',
      actor: { type: 'CITIZEN', id: ACTOR_CITIZEN },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'OTP',
      correlation_id: randomUUID(),
      trace_id: TRACE,
    };
    app = Fastify({ logger: false });
    await registerCitizenProfile(app, {
      prefix: '/v1',
      pool: createMemoryPool(emptyStore()),
      resolveContext: async () => citizen,
      authorizer: {
        decide: async (input) => {
          seen.push(input);
          return { allow: false, reason_code: 'ROLE_NOT_PERMITTED', policy_revision: 'test' };
        },
      },
      consentAccess: new AllowConsent(),
      subjectDirectory: new AlwaysSubject(),
      deploymentEnvironment: 'CI',
      digiLockerBinding: BINDING,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['PROFILE_READ', 'GET', `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=SAMPLE_PURPOSE`],
    ['PROFILE_WRITE', 'PUT', `/v1/profiles/${ACTOR_CITIZEN}`],
  ] as const)('%s carries owner, CITIZEN_PRIVATE and assurance', async (action, method, url) => {
    seen.length = 0;
    const res = await app.inject({
      method,
      url,
      headers: { 'idempotency-key': `k-${randomUUID()}` },
      ...(method === 'PUT' ? { payload: {} } : {}),
    });
    expect(res.statusCode).toBe(403);
    expect(seen[0]).toMatchObject({
      action,
      subject: { user_id: ACTOR_CITIZEN, actor_type: 'CITIZEN', tenant_id: T1, assurance: 'OTP' },
      resource: {
        resource_type: 'CitizenProfile',
        tenant_id: T1,
        classification: 'CITIZEN_PRIVATE',
        owner_id: ACTOR_CITIZEN,
      },
    });
  });
});
