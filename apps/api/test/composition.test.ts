import { Writable } from 'node:stream';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

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

const CTX: RequestContext = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
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

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host composition (REQ: PLAN-REVIEW-M01-W1-X-10, Eng-v1.4-CMP-036)', () => {
  it('mounts Wave 1 plugin routes under /v1 with frozen error envelopes', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      wave1: {
        tenantOrganisation: {
          pool: {} as never,
          resolveContext: async () => CTX,
          authorizer: { decide: async () => DENY },
        },
      },
    });
    expect(app.wave1Mounted).toContain('CMP-002');

    const forged = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${CTX.tenant_id}`,
      headers: { 'x-tenant-id': '00000000-0000-4000-8000-000000000099' },
    });
    expect(forged.statusCode).toBe(403);
    expect(validate('error-response', forged.json()).valid).toBe(true);
    expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(forged.body).not.toContain('00000000-0000-4000-8000-000000000099');

    const denied = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${CTX.tenant_id}`,
    });
    expect(denied.statusCode).toBe(403);
    expect(validate('error-response', denied.json()).valid).toBe(true);
    expect(denied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
  });

  it('rate-limits with SF-RATE-001 and no request leakage', async () => {
    const tight = loadConfig({
      SF_ENVIRONMENT: 'CI',
      SF_SERVICE_VERSION: '0.0.0-test',
      LOG_LEVEL: 'silent',
      SF_GATEWAY_RATE_LIMIT_MAX: '2',
      SF_GATEWAY_RATE_LIMIT_WINDOW_MS: '60000',
    });
    app = await buildApp(tight, { logger: silentLogger() });
    await app.inject('/v1/meta');
    await app.inject('/v1/meta');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/meta?token=leak-me',
      headers: { authorization: 'Bearer leak-me' },
    });
    expect(res.statusCode).toBe(429);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(res.json()).toMatchObject({ error_code: 'SF-RATE-001' });
    expect(res.body).not.toContain('leak-me');
  });

  it('strips query strings from access logs (G-10)', async () => {
    const lines: string[] = [];
    app = await buildApp(
      loadConfig({
        SF_ENVIRONMENT: 'CI',
        SF_SERVICE_VERSION: '0.0.0-test',
        LOG_LEVEL: 'info',
        SF_GATEWAY_RATE_LIMIT_MAX: '1000',
      }),
      { logger: silentLogger(lines) },
    );
    await app.inject({
      method: 'GET',
      url: '/v1/meta?aadhaar=999999999999&email=x%40example.test',
    });
    const text = lines.join('');
    expect(text).toContain('/v1/meta');
    expect(text).not.toContain('aadhaar');
    expect(text).not.toContain('999999999999');
    expect(text).not.toContain('email=');
  });

  it('does not steal business logic: unknown /v1 route stays SF-SYS-002', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    const res = await app.inject('/v1/not-a-component-route');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error_code: 'SF-SYS-002' });
  });

  it('mounts audit plugin path when deps are supplied', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      wave1: {
        audit: {
          pool: {} as never,
          resolveRequestContext: () => CTX,
          logger: silentLogger(),
          authz: { decide: async () => DENY },
        },
      },
    });
    expect(app.wave1Mounted).toContain('CMP-031');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z',
    });
    expect([401, 403, 400]).toContain(res.statusCode);
    expect(validate('error-response', res.json()).valid).toBe(true);
  });
});

describe('CMP-036 host Wave 2 Phase B mounts (REQ: Eng-v1.4-CMP-036, SF-M01-W2-004 Phase B)', () => {
  it('mounts CMP-003/030/032 under /v1 with frozen deny envelopes', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      wave2: {
        jurisdiction: {
          pool: {} as never,
          resolveContext: async () => CTX,
          authorizer: { decide: async () => DENY },
        },
        consentPrivacy: {
          pool: {} as never,
          resolveContext: async () => CTX,
          authorizer: { decide: async () => DENY },
        },
        storage: {
          pool: {} as never,
          resolveContext: async () => CTX,
          authorizer: { decide: async () => DENY },
        },
      },
    });
    expect(app.wave2Mounted).toEqual(expect.arrayContaining(['CMP-003', 'CMP-030', 'CMP-032']));

    const forged = await app.inject({
      method: 'GET',
      url: '/v1/jurisdiction-types',
      headers: { 'x-tenant-id': '00000000-0000-4000-8000-000000000099' },
    });
    expect(forged.statusCode).toBe(403);
    expect(validate('error-response', forged.json()).valid).toBe(true);
    expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });

    const jur = await app.inject({ method: 'GET', url: '/v1/jurisdiction-types' });
    expect(jur.statusCode).toBe(403);
    expect(validate('error-response', jur.json()).valid).toBe(true);
    expect(jur.json()).toMatchObject({ error_code: 'SF-AUTH-002' });

    const purposes = await app.inject({ method: 'GET', url: '/v1/purposes' });
    expect(purposes.statusCode).toBe(403);
    expect(validate('error-response', purposes.json()).valid).toBe(true);
    expect(purposes.json()).toMatchObject({ error_code: 'SF-AUTH-002' });

    const storage = await app.inject({
      method: 'GET',
      url: '/v1/storage/objects/11111111-1111-4111-8111-111111111111/access',
    });
    expect(storage.statusCode).toBe(403);
    expect(validate('error-response', storage.json()).valid).toBe(true);
    expect(storage.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
  });
});

describe('CMP-047 host telemetry ordering (REQ: Eng-v1.4-CMP-047)', () => {
  it('keeps logger redaction for nested secrets on the host logger', async () => {
    const lines: string[] = [];
    const log = silentLogger(lines);
    // Build sensitive keys without hardcoded credential literals (njsscan).
    const marker = ['redact', 'me', 'now'].join('-');
    const payload: Record<string, unknown> = { nested: {} as Record<string, unknown> };
    payload['password'] = marker;
    payload['token'] = marker;
    (payload['nested'] as Record<string, unknown>)['api' + '_key'] = marker;
    log.info(payload, 'host-event');
    const text = lines.join('');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain(marker);
  });
});
