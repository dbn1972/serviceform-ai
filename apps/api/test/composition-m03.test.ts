import { Writable } from 'node:stream';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { registerM03Plugins } from '../src/composition/m03.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-test',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

function silentLogger(lines: string[] = []) {
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return createLogger({ service: 'api-test', version: 'test', level: 'info', destination });
}

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

function m03Mounts() {
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  return {
    catalogue: {
      pool: {} as never,
      resolveContext,
      authorizer,
    },
    metadata: {
      pool: {} as never,
      resolveContext,
      authorizer,
    },
    masterData: {
      pool: {} as never,
      resolveContext,
      authorizer,
    },
    localization: {
      pool: {} as never,
      resolveContext,
      authorizer,
      deploymentEnvironment: 'CI' as const,
    },
  };
}

function m02Mounts() {
  return {
    identityAccess: {
      commands: {},
      verifier: { verify: async () => null },
      resolveContext: { resolve: async () => null },
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
      digiLockerBinding: {
        connector_binding_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        tenant_id: T1,
        connector_type: 'DIGILOCKER' as const,
        mode: 'SIMULATED' as const,
        environment: 'CI' as const,
        critical: true,
        secret_ref: null,
        simulator_version: 'sim-1',
      },
      rateLimitMax: 10_000,
    },
  };
}

async function expectTen002(app: FastifyInstance, method: 'GET' | 'POST', url: string) {
  const forged = await app.inject({
    method,
    url,
    headers: { 'x-tenant-id': CANARY },
  });
  expect(forged.statusCode).toBe(403);
  expect(validate('error-response', forged.json()).valid).toBe(true);
  expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
  expect(forged.body).not.toContain(CANARY);
  return forged;
}

async function expectAuth002(app: FastifyInstance, method: 'GET' | 'POST', url: string) {
  const denied = await app.inject({ method, url });
  expect(denied.statusCode).toBe(403);
  expect(validate('error-response', denied.json()).valid).toBe(true);
  expect(denied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
  expect(denied.body).not.toContain(CANARY);
  return denied;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host M03 Wave A mounts (REQ: host-mount-m03, INT-011, PLAN-REVIEW-single-writer-apps-api)', () => {
  it('mounts CMP-001/033/034/053 under /v1 with frozen deny envelopes and no tenant-header leakage', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      m03: m03Mounts(),
    });
    expect(app.m03Mounted).toEqual(
      expect.arrayContaining(['CMP-001', 'CMP-033', 'CMP-034', 'CMP-053']),
    );
    expect(app.m03Mounted).not.toContain('CMP-051');
    expect(app.m03Mounted).not.toContain('CMP-052');
    expect(app.m03Mounted).not.toContain('CMP-054');

    await expectTen002(app, 'GET', '/v1/categories');
    await expectAuth002(app, 'GET', '/v1/categories');

    await expectTen002(app, 'GET', `/v1/metadata/documents/${DOC}`);
    await expectAuth002(app, 'GET', `/v1/metadata/documents/${DOC}`);

    await expectTen002(app, 'GET', '/v1/code-sets');
    await expectAuth002(app, 'GET', '/v1/code-sets');

    await expectTen002(app, 'GET', '/v1/locales');
    await expectAuth002(app, 'GET', '/v1/locales');
  });

  it('returns SF-AUTH-001 when context is missing and never echoes the tenant canary', async () => {
    const authorizer = { decide: async () => DENY };
    app = await buildApp(config, {
      logger: silentLogger(),
      m03: {
        catalogue: {
          pool: {} as never,
          resolveContext: async () => null,
          authorizer,
        },
      },
    });
    const unauth = await app.inject({ method: 'GET', url: '/v1/categories' });
    expect(unauth.statusCode).toBe(401);
    expect(validate('error-response', unauth.json()).valid).toBe(true);
    expect(unauth.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    expect(unauth.body).not.toContain(CANARY);
  });

  it('keeps Wave 1/2/M02 mounts when M03 Wave A plugins are registered', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      wave1: {
        tenantOrganisation: {
          pool: {} as never,
          resolveContext: async () => CTX,
          authorizer: { decide: async () => DENY },
        },
      },
      wave2: {
        jurisdiction: {
          pool: {} as never,
          resolveContext: async () => CTX,
          authorizer: { decide: async () => DENY },
        },
      },
      m02: m02Mounts(),
      m03: m03Mounts(),
    });
    expect(app.wave1Mounted).toContain('CMP-002');
    expect(app.wave2Mounted).toContain('CMP-003');
    expect(app.m02Mounted).toEqual(expect.arrayContaining(['CMP-004', 'CMP-005']));
    expect(app.m03Mounted).toEqual(
      expect.arrayContaining(['CMP-001', 'CMP-033', 'CMP-034', 'CMP-053']),
    );

    const tenant = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: { 'x-tenant-id': CANARY },
    });
    expect(tenant.statusCode).toBe(403);
    expect(tenant.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(tenant.body).not.toContain(CANARY);

    const jur = await app.inject({ method: 'GET', url: '/v1/jurisdiction-types' });
    expect(jur.statusCode).toBe(403);
    expect(jur.json()).toMatchObject({ error_code: 'SF-AUTH-002' });

    const identityUnauth = await app.inject({ method: 'GET', url: '/v1/identity/me' });
    expect(identityUnauth.statusCode).toBe(401);
    expect(identityUnauth.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
  });

  it('does not register CMP-051/052/054 or Studio and has no cross-component SQL in M03 composition', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect(app.m03Mounted).toBeUndefined();

    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/composition/m03.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(src).not.toMatch(/registerStudio|registerAdmin/i);
    expect(src).not.toMatch(/services\/cmp-051|services\/cmp-052/);
    expect(src).not.toMatch(/from ['"]@serviceform\/ui-ux4g['"]/);
    expect(src).not.toMatch(/apps\/web-studio|apps\/web-admin/);
  });
});

describe('registerM03Plugins isolation (REQ: INT-011 CROSS_TENANT_LEAKAGE=0)', () => {
  it('loads plugins without importing sibling service TypeScript into the host graph', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/composition/m03.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('import(specifier)');
    expect(src).not.toMatch(/from '@serviceform\/cmp-001/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-033/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-034/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-053/);
    expect(typeof registerM03Plugins).toBe('function');
  });
});
