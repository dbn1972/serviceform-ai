import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-sec',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

const T1 = '11111111-1111-4111-8111-111111111111';
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CANARY = '00000000-0000-4000-8000-000000000099';

const CTX: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-local',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: ['5fad7b4e-a06c-4d9e-b15f-8c4d2e6a0b75'],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

const DENY = {
  allow: false as const,
  reason_code: 'ROLE_DENIED',
  policy_revision: 'test-1',
  decision_id: '00000000-0000-4000-8000-0000000000bb',
};

const DIGILOCKER_BINDING = {
  connector_binding_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenant_id: T1,
  connector_type: 'DIGILOCKER' as const,
  mode: 'SIMULATED' as const,
  environment: 'CI' as const,
  critical: true,
  secret_ref: null,
  simulator_version: 'sim-1',
};

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm02-sec', version: 'test', level: 'silent', destination });
}

function m02Mounts() {
  return {
    identityAccess: {
      commands: {},
      verifier: { verify: async () => null },
      resolveContext: { resolve: async () => CTX },
      cellId: 'cell-local',
      rateLimitMax: 10_000,
    },
    citizenProfile: {
      pool: {} as never,
      resolveContext: async () => CTX,
      authorizer: { decide: async () => DENY },
      consentAccess: { check: async () => ({ allowed: true, reason_code: 'OK' }) },
      subjectDirectory: { exists: async () => true },
      deploymentEnvironment: 'CI' as const,
      digiLockerBinding: DIGILOCKER_BINDING,
      rateLimitMax: 10_000,
    },
  };
}

async function expectTen002(app: FastifyInstance, method: 'GET' | 'POST' | 'PUT', url: string) {
  const forged = await app.inject({
    method,
    url,
    headers: { authorization: 'Bearer officer-t1', 'x-tenant-id': CANARY },
  });
  expect(forged.statusCode).toBe(403);
  expect(validate('error-response', forged.json()).valid).toBe(true);
  expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
  expect(forged.body).not.toContain(CANARY);
  expect(JSON.stringify(forged.json())).not.toContain(CANARY);
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M02-SEC INT-011 forged-tenant HTTP (not CERTIFIED)', () => {
  it('rejects client-controlled tenant headers on CMP-004/005 mounts with zero leakage', async () => {
    app = await buildApp(config, { logger: silentLogger(), m02: m02Mounts() });
    expect(app.m02Mounted).toEqual(expect.arrayContaining(['CMP-004', 'CMP-005']));

    await expectTen002(app, 'GET', '/v1/identity/me');
    await expectTen002(app, 'POST', '/v1/identity/citizen/otp/challenges');
    await expectTen002(app, 'POST', '/v1/identity/citizen/otp/verify');
    await expectTen002(app, 'POST', '/v1/identity/citizen/recovery');
    await expectTen002(app, 'POST', '/v1/identity/citizen/sessions/revoke');
    await expectTen002(app, 'POST', '/v1/identity/citizen/links/digilocker');
    await expectTen002(app, 'POST', '/v1/identity/officer/sessions');
    await expectTen002(app, 'POST', '/v1/identity/officer/sessions/revoke');
    await expectTen002(app, 'GET', `/v1/profiles/${SUBJECT}?purpose_code=PROFILE_ACCESS`);
    await expectTen002(app, 'PUT', `/v1/profiles/${SUBJECT}`);
    await expectTen002(app, 'PUT', `/v1/profiles/${SUBJECT}/claims`);
    await expectTen002(app, 'POST', `/v1/profiles/${SUBJECT}/verified-claims/import`);
  });

  it('rejects x-sf-tenant and sibling client tenant headers without echoing canary', async () => {
    app = await buildApp(config, { logger: silentLogger(), m02: m02Mounts() });
    const hdrs = ['x-sf-tenant', 'x-tenant', 'sf-tenant-id', 'x-roles'];
    for (const name of hdrs) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/identity/me',
        headers: { authorization: 'Bearer officer-t1', [name]: CANARY },
      });
      expect(res.statusCode, name).toBe(403);
      expect(res.body, name).not.toContain(CANARY);
      expect((res.json() as { error_code: string }).error_code).toBe('SF-TEN-002');
    }
  });
});
