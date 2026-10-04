import { Writable } from 'node:stream';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { registerM02Plugins } from '../src/composition/m02.js';

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
      digiLockerBinding: DIGILOCKER_BINDING,
      rateLimitMax: 10_000,
    },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host M02 mounts (REQ: host-mount-m02, INT-011, PLAN-REVIEW-single-writer-apps-api)', () => {
  it('mounts CMP-004/005 under /v1 with frozen deny envelopes and no tenant-header leakage', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      m02: m02Mounts(),
    });
    expect(app.m02Mounted).toEqual(expect.arrayContaining(['CMP-004', 'CMP-005']));

    const identityForged = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { 'x-tenant-id': CANARY },
    });
    expect(identityForged.statusCode).toBe(403);
    expect(validate('error-response', identityForged.json()).valid).toBe(true);
    expect(identityForged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(identityForged.body).not.toContain(CANARY);

    const identityUnauth = await app.inject({ method: 'GET', url: '/v1/identity/me' });
    expect(identityUnauth.statusCode).toBe(401);
    expect(validate('error-response', identityUnauth.json()).valid).toBe(true);
    expect(identityUnauth.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    expect(identityUnauth.body).not.toContain(CANARY);

    const profileForged = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${SUBJECT}?purpose_code=PROFILE_ACCESS`,
      headers: { 'x-tenant-id': CANARY },
    });
    expect(profileForged.statusCode).toBe(403);
    expect(validate('error-response', profileForged.json()).valid).toBe(true);
    expect(profileForged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(profileForged.body).not.toContain(CANARY);

    const profileDenied = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${SUBJECT}?purpose_code=PROFILE_ACCESS`,
    });
    expect(profileDenied.statusCode).toBe(403);
    expect(validate('error-response', profileDenied.json()).valid).toBe(true);
    expect(profileDenied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(profileDenied.body).not.toContain(CANARY);
  });

  it('keeps Wave 1/2 mounts when M02 plugins are registered', async () => {
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
    });
    expect(app.wave1Mounted).toContain('CMP-002');
    expect(app.wave2Mounted).toContain('CMP-003');
    expect(app.m02Mounted).toEqual(expect.arrayContaining(['CMP-004', 'CMP-005']));

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
  });

  it('does not register M03 host mounts and has no cross-component SQL in M02 composition', async () => {
    app = await buildApp(config, { logger: silentLogger(), m02: m02Mounts() });
    expect(app.m02Mounted).not.toContain('CMP-001');
    expect(app.m02Mounted).not.toContain('CMP-033');
    expect(app.m02Mounted).not.toContain('CMP-034');
    expect((app as FastifyInstance & { m03Mounted?: string[] }).m03Mounted).toBeUndefined();

    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/composition/m02.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(src).not.toMatch(/registerCatalog|registerMetadata|registerM03/i);
  });
});

describe('registerM02Plugins isolation (REQ: INT-011 CROSS_TENANT_LEAKAGE=0)', () => {
  it('loads plugins without importing sibling service TypeScript into the host graph', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/composition/m02.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('import(specifier)');
    expect(src).not.toMatch(/from '@serviceform\/cmp-004/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-005/);
    expect(typeof registerM02Plugins).toBe('function');
  });
});
