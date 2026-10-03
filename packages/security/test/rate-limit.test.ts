import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { SecurityError, sfSecurity } from '../src/index.js';
import { AuthzRateLimiter } from '../src/pep/rate-limit.js';
import { CELL, context, stubResolver, stubVerifier } from './helpers/fakes.js';
import { jsonAllow, startStubOpa } from './helpers/stub-opa.js';

describe('authz rate limiter', () => {
  it('admits under the cap and then denies', () => {
    const lim = new AuthzRateLimiter({ windowMs: 60_000, max: 2 });
    expect(lim.consume('k')).toBe(true);
    expect(lim.consume('k')).toBe(true);
    expect(lim.consume('k')).toBe(false);
    expect(lim.consume('other')).toBe(true);
  });

  it('rejects invalid config', () => {
    expect(() => new AuthzRateLimiter({ windowMs: 0, max: 1 })).toThrow(/invalid/);
  });

  it('PEP returns 429 SF-RATE-001 after the cap (CodeQL js/missing-rate-limiting)', async () => {
    const stub = await startStubOpa((_r, res) => jsonAllow(res));
    const f = Fastify({ logger: false });
    f.setErrorHandler((err, _req, reply) => {
      if (err instanceof SecurityError) {
        return reply.code(err.statusCode).send({ error_code: err.code });
      }
      return reply.code(500).send({});
    });
    await f.register(sfSecurity, {
      verifier: stubVerifier(),
      resolver: stubResolver(context()),
      pdp: {
        decide: async () => ({
          allow: true,
          reason_code: 'ALLOW',
          policy_revision: 'w1',
          decision_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
        }),
      },
      cellId: CELL,
      authzRateLimit: { windowMs: 60_000, max: 1 },
    });
    f.get('/work', {
      config: {
        sfAuthz: {
          action: 'VIEW',
          resource: () => ({
            resource_type: 'ExampleAggregate',
            tenant_id: context().tenant_id,
            classification: 'TENANT_SCOPED' as const,
          }),
        },
      },
      handler: async () => ({ ok: true }),
    });
    const first = await f.inject({ method: 'GET', url: '/work' });
    expect(first.statusCode).toBe(200);
    const second = await f.inject({ method: 'GET', url: '/work' });
    expect(second.statusCode).toBe(429);
    expect(JSON.parse(second.body).error_code).toBe('SF-RATE-001');
    await f.close();
    await stub.close();
  });
});
