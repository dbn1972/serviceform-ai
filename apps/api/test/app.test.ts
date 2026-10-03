import { Writable } from 'node:stream';
import { validate } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { PlatformError } from '../src/errors.js';
import type { ReadinessCheck } from '../src/plugins/health.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-test',
  LOG_LEVEL: 'silent',
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

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(checks: ReadinessCheck[] = [], lines: string[] = []) {
  app = await buildApp(config, { logger: silentLogger(lines), readinessChecks: checks });
  return app;
}

describe('API foundation (REQ: AWS v1.7 s2 probes, s13.1 contract rules, s13.3 errors)', () => {
  it('reports liveness', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness from its checks and fails when a dependency fails', async () => {
    const ok = await (
      await build([{ name: 'postgres', check: async () => {} }])
    ).inject('/health/ready');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok', checks: { postgres: 'ok' } });
    await app?.close();
    const failing = await (
      await build([{ name: 'postgres', check: async () => Promise.reject(new Error('down')) }])
    ).inject('/health/ready');
    expect(failing.statusCode).toBe(503);
    expect(failing.json()).toEqual({ status: 'unavailable', checks: { postgres: 'failed' } });
  });

  it('returns service identity without tenant or secret data', async () => {
    const res = await (await build()).inject('/v1/meta');
    expect(res.json()).toEqual({
      service: 'serviceform-api',
      version: '0.0.0-test',
      environment: 'CI',
      cell_id: 'cell-local',
    });
  });

  it('propagates a valid inbound correlation id and replaces a malformed one', async () => {
    const a = await build();
    const id = '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86';
    const kept = await a.inject({ url: '/health/live', headers: { 'x-correlation-id': id } });
    expect(kept.headers['x-correlation-id']).toBe(id);
    const replaced = await a.inject({
      url: '/health/live',
      headers: { 'x-correlation-id': 'DROP TABLE x' },
    });
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(replaced.headers['x-correlation-id']).not.toBe('DROP TABLE x');
  });

  it('sets security headers', async () => {
    const res = await (await build()).inject('/health/live');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
    );
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a contract-valid SF-SYS-002 body for unknown routes', async () => {
    const res = await (await build()).inject('/nope');
    expect(res.statusCode).toBe(404);
    const body: unknown = res.json();
    expect(validate('error-response', body).valid).toBe(true);
    expect(body).toMatchObject({
      error_code: 'SF-SYS-002',
      correlation_id: res.headers['x-correlation-id'],
    });
  });

  it('maps schema validation failures to SF-SYS-003 with JSON pointers', async () => {
    const a = await build();
    a.post(
      '/test/validate',
      {
        schema: {
          body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        },
      },
      async () => ({ ok: true }),
    );
    const res = await a.inject({ method: 'POST', url: '/test/validate', payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error_code: string; details: { pointer: string }[] }>();
    expect(validate('error-response', body).valid).toBe(true);
    expect(body.error_code).toBe('SF-SYS-003');
    expect(body.details[0]?.pointer).toBe('/body');
  });

  it('maps PlatformError to its catalogue status and code', async () => {
    const a = await build();
    a.get('/test/denied', async () => {
      throw new PlatformError('SF-TEN-002');
    });
    const res = await a.inject('/test/denied');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error_code: 'SF-TEN-002',
      message: 'Cross-tenant operation denied',
    });
  });

  it('does not log client network identifiers', async () => {
    const lines: string[] = [];
    const a = await build([], lines);
    await a.inject({ url: '/v1/meta', remoteAddress: '203.0.113.7' });
    const text = lines.join('');
    expect(text).toContain('incoming request');
    expect(text).not.toContain('203.0.113.7');
  });

  it('hides internal error details and stack traces', async () => {
    const lines: string[] = [];
    const a = await build([], lines);
    a.get('/test/boom', async () => {
      throw new Error('SELECT secret FROM table failed at /srv/app.ts:10');
    });
    const res = await a.inject('/test/boom');
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('SELECT');
    expect(res.body).not.toContain('app.ts');
    expect(res.json()).toMatchObject({
      error_code: 'SF-SYS-001',
      message: 'Unexpected server error',
    });
    expect(validate('error-response', res.json()).valid).toBe(true);
  });

  it('rejects oversized bodies with a contract error', async () => {
    const small = loadConfig({ SF_ENVIRONMENT: 'CI', BODY_LIMIT_BYTES: '1024' });
    app = await buildApp(small, { logger: silentLogger() });
    app.post('/test/echo', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      payload: { x: 'a'.repeat(4096) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error_code: 'SF-SYS-003' });
  });
});

describe('configuration (REQ: AWS v1.7 s2 secrets; no secret defaults)', () => {
  it('requires DATABASE_URL outside LOCAL and CI', () => {
    expect(() => loadConfig({ SF_ENVIRONMENT: 'PRODUCTION' })).toThrow(/DATABASE_URL/);
  });

  it('reports invalid variable names without echoing values', () => {
    try {
      loadConfig({ PORT: 'not-a-port-secretvalue' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain('PORT');
      expect(String(e)).not.toContain('secretvalue');
    }
  });
});
