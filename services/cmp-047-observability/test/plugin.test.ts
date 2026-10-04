import { Writable } from 'node:stream';
import { createLogger } from '@serviceform/observability';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapObservability, observabilityPlugin } from '../src/index.js';

describe('CMP-047 observability plugin (REQ: Eng-v1.4-CMP-047, Constitution #21)', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
  });

  it('writes access logs without query strings', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _e, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({
      service: 'obs-test',
      version: 'test',
      level: 'info',
      destination,
    });
    const app = Fastify({ loggerInstance: logger as never });
    apps.push(app);
    await app.register(observabilityPlugin, { logger });
    app.get('/v1/probe', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/v1/probe?email=citizen%40example.test&otp=123456' });
    const text = lines.join('');
    expect(text).toContain('request completed');
    expect(text).toContain('/v1/probe');
    expect(text).not.toContain('email=');
    expect(text).not.toContain('otp=');
    expect(text).not.toContain('citizen@example.test');
    expect(text).not.toContain('123456');
  });

  it('bootstraps telemetry off when no OTLP endpoint is set', async () => {
    const { telemetry, logger } = bootstrapObservability({
      logger: { service: 'obs', version: '0', level: 'silent' },
      telemetry: { serviceName: 'obs', serviceVersion: '0', environment: 'CI' },
    });
    expect(telemetry.enabled).toBe(false);
    expect(logger).toBeDefined();
    await telemetry.shutdown();
  });
});
