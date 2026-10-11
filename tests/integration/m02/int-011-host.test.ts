import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { registerM02Plugins } from '../../../apps/api/src/composition/m02.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-test',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm02-int', version: 'test', level: 'info', destination });
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

function mounts() {
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

describe('INT-011 host M02 mounts (independent stitcher)', () => {
  it('forged x-tenant-id is SF-TEN-002 and never echoes the canary', async () => {
    app = await buildApp(config, { logger: silentLogger(), m02: mounts() });
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

    const profileForged = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${SUBJECT}?purpose_code=PROFILE_ACCESS`,
      headers: { 'x-tenant-id': CANARY },
    });
    expect(profileForged.statusCode).toBe(403);
    expect(validate('error-response', profileForged.json()).valid).toBe(true);
    expect(profileForged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(profileForged.body).not.toContain(CANARY);
  });

  it('unauthenticated identity is SF-AUTH-001; deny authorizer is canonical SF-AUTH-002', async () => {
    app = await buildApp(config, { logger: silentLogger(), m02: mounts() });
    const identityUnauth = await app.inject({ method: 'GET', url: '/v1/identity/me' });
    expect(identityUnauth.statusCode).toBe(401);
    expect(validate('error-response', identityUnauth.json()).valid).toBe(true);
    expect(identityUnauth.json()).toMatchObject({ error_code: 'SF-AUTH-001' });

    const profileDenied = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${SUBJECT}?purpose_code=PROFILE_ACCESS`,
    });
    expect(profileDenied.statusCode).toBe(403);
    expect(validate('error-response', profileDenied.json()).valid).toBe(true);
    expect(profileDenied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(profileDenied.body).not.toContain(CANARY);
  });

  it('M02 composition has no SQL and does not mount M03 plugins', async () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../apps/api/src/composition/m02.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(src).not.toMatch(/registerCatalog|registerMetadata|registerM03/i);
    expect(src).toContain('import(specifier)');
    expect(typeof registerM02Plugins).toBe('function');
  });
});
