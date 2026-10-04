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
const DOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm03-sec', version: 'test', level: 'silent', destination });
}

function m03Mounts() {
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  return {
    catalogue: { pool: {} as never, resolveContext, authorizer },
    metadata: { pool: {} as never, resolveContext, authorizer },
    masterData: { pool: {} as never, resolveContext, authorizer },
    makerChecker: { pool: {} as never, resolveContext, authorizer },
    versioning: { pool: {} as never, resolveContext, authorizer },
    localization: {
      pool: {} as never,
      resolveContext,
      authorizer,
      deploymentEnvironment: 'CI' as const,
    },
  };
}

async function expectTen002(app: FastifyInstance, method: 'GET' | 'POST', url: string) {
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

describe('SF-M03-SEC INT-011 forged-tenant HTTP (not CERTIFIED)', () => {
  it('rejects client-controlled tenant headers on all M03 Fastify mounts with zero leakage', async () => {
    app = await buildApp(config, { logger: silentLogger(), m03: m03Mounts() });
    expect(app.m03Mounted).toEqual(
      expect.arrayContaining(['CMP-001', 'CMP-033', 'CMP-034', 'CMP-051', 'CMP-052', 'CMP-053']),
    );
    expect(app.m03Mounted).not.toContain('CMP-050');
    expect(app.m03Mounted).not.toContain('CMP-054');

    await expectTen002(app, 'GET', '/v1/categories');
    await expectTen002(app, 'GET', `/v1/metadata/documents/${DOC}`);
    await expectTen002(app, 'GET', '/v1/code-sets');
    await expectTen002(app, 'GET', `/v1/publication-requests/${DOC}`);
    await expectTen002(app, 'GET', `/v1/tenant-service-bindings/${DOC}`);
    await expectTen002(app, 'GET', '/v1/locales');
  });

  it('rejects x-sf-tenant and tenant-id body-adjacent headers without echoing canary', async () => {
    app = await buildApp(config, { logger: silentLogger(), m03: m03Mounts() });
    const hdrs = ['x-sf-tenant', 'x-tenant', 'sf-tenant-id'];
    for (const name of hdrs) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/categories',
        headers: { authorization: 'Bearer officer-t1', [name]: CANARY },
      });
      expect(res.statusCode, name).toBe(403);
      expect(res.body, name).not.toContain(CANARY);
      expect((res.json() as { error_code: string }).error_code).toBe('SF-TEN-002');
    }
  });
});
