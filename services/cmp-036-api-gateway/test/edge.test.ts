import { randomUUID } from 'node:crypto';
import { validate } from '@serviceform/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  apiGatewayPlugin,
  findForbiddenEdgeHeader,
  isForbiddenEdgeHeaderName,
} from '../src/index.js';

describe('CMP-036 edge guards (REQ: Eng-v1.4-CMP-036, Constitution #6)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function build(max = 1000): Promise<FastifyInstance> {
    app = Fastify({
      logger: false,
      genReqId: () => randomUUID(),
    });
    // Minimal catalogue mapper so rate-limit Errors become ErrorResponse (host does this in apps/api).
    app.setErrorHandler((error, request, reply) => {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 429) {
        return reply.code(429).send({
          error_code: 'SF-RATE-001',
          message: 'Rate limit exceeded',
          correlation_id: request.id,
        });
      }
      return reply.code(status && status >= 400 ? status : 500).send({
        error_code: 'SF-SYS-001',
        message: 'Unexpected server error',
        correlation_id: request.id,
      });
    });
    await app.register(apiGatewayPlugin, {
      edge: { rateLimit: { max, timeWindowMs: 60_000 } },
    });
    app.get('/v1/probe', async () => ({ ok: true }));
    app.get('/health/live', async () => ({ status: 'ok' }));
    return app;
  }

  it('recognises forged tenant and identity headers', () => {
    for (const name of [
      'x-tenant-id',
      'X-SF-Tenant',
      'tenant-id',
      'x-sf-roles',
      'x-actor-type',
      'x-delegation-id',
    ]) {
      expect(isForbiddenEdgeHeaderName(name)).toBe(true);
    }
    expect(isForbiddenEdgeHeaderName('authorization')).toBe(false);
    expect(isForbiddenEdgeHeaderName('x-correlation-id')).toBe(false);
  });

  it('detects tenant= in Forwarded', () => {
    expect(findForbiddenEdgeHeader({ forwarded: 'for=10.0.0.1;tenant=abc' })).toBe('forwarded');
    expect(findForbiddenEdgeHeader({ forwarded: 'for=10.0.0.1' })).toBeUndefined();
  });

  it('denies forged client tenant headers with SF-TEN-002 and no leakage', async () => {
    const a = await build();
    const res = await a.inject({
      method: 'GET',
      url: '/v1/probe',
      headers: { 'x-tenant-id': '00000000-0000-4000-8000-000000000099' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as Record<string, unknown>;
    expect(validate('error-response', body).valid).toBe(true);
    expect(body).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(JSON.stringify(body)).not.toContain('00000000-0000-4000-8000-000000000099');
  });

  it('allows probes and normal /v1 traffic without forged headers', async () => {
    const a = await build();
    expect((await a.inject('/health/live')).statusCode).toBe(200);
    expect((await a.inject('/v1/probe')).statusCode).toBe(200);
  });

  it('emits controlled SF-RATE-001 without leaking request details', async () => {
    const a = await build(2);
    await a.inject('/v1/probe');
    await a.inject('/v1/probe');
    const denied = await a.inject({
      method: 'GET',
      url: '/v1/probe?secret=should-not-echo',
      headers: { authorization: 'Bearer should-not-echo' },
    });
    expect(denied.statusCode).toBe(429);
    const body = denied.json() as Record<string, unknown>;
    expect(validate('error-response', body).valid).toBe(true);
    expect(body).toMatchObject({ error_code: 'SF-RATE-001' });
    expect(denied.body).not.toContain('should-not-echo');
    expect(denied.body).not.toContain('secret=');
  });

  it('does not rate-limit health probes', async () => {
    const a = await build(1);
    await a.inject('/v1/probe');
    expect((await a.inject('/v1/probe')).statusCode).toBe(429);
    expect((await a.inject('/health/live')).statusCode).toBe(200);
  });
});
