import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate } from '@serviceform/contracts';
import { buildApp } from '../../../apps/api/src/app.js';
import type { M06PluginMounts } from '../../../apps/api/src/composition/m06.js';
import type { M08PluginMounts } from '../../../apps/api/src/composition/m08.js';
import {
  CANARY,
  config,
  ContextState,
  ctxFor,
  DOC,
  expectForgedTenantDenied,
  idemHeaders,
  OFFICER_1,
  silentLogger,
  T1,
} from './support/fixtures.js';
import {
  M09_EXPECTED,
  m09Harness,
  READ_PROBES,
  WRITE_PROBES,
  type M09Harness,
} from './support/mounts.js';

const CTX = ctxFor(T1, OFFICER_1, 'OFFICER');

function allTenantsSeen(h: M09Harness): string[] {
  return [
    ...h.recorder.seen,
    ...h.semanticPool.tenantsSeen(),
    ...h.migrationPool.tenantsSeen(),
    ...h.riskPool.tenantsSeen(),
    ...h.semanticAuthz.calls.map((c) => c.subject.tenant_id ?? 'null'),
    ...h.migrationAuthz.calls.map((c) => c.subject.tenant_id ?? 'null'),
  ];
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('INT-011 M09 host admission', () => {
  it('admits CMP-056..061 in deterministic order; CMP-036 registered exactly once', async () => {
    const h = m09Harness(async () => CTX);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    expect(app.m09Mounted).toEqual([...M09_EXPECTED]);
    expect(app.printPlugins().split('cmp-036-api-gateway').length - 1).toBe(1);
  });

  it('every probed M09 route is registered on the host (not a 404 fallthrough)', async () => {
    const h = m09Harness(async () => CTX);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    for (const p of [...READ_PROBES, ...WRITE_PROBES]) {
      expect(app.hasRoute({ method: p.method, url: p.route }), `${p.cmp} ${p.route}`).toBe(true);
      const res = await app.inject({ method: p.method, url: p.url });
      expect(res.statusCode, `${p.cmp} ${p.url}`).toBeLessThan(500);
    }
  });

  it('read routes reach owner ports with the server-derived tenant only', async () => {
    const h = m09Harness(async () => CTX);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    for (const p of READ_PROBES) {
      await app.inject({ method: p.method, url: p.url });
    }
    const seen = allTenantsSeen(h);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([T1]));
  });

  it('host without M09 deps leaves m09Mounted undefined and M09 paths unrouted', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect(app.m09Mounted).toBeUndefined();
    for (const url of ['/v1/appointments/slots', '/v1/privacy/me', '/v1/elements']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(validate('error-response', res.json()).valid).toBe(true);
    }
  });
});

describe('INT-011 M09 forged tenant denial (CROSS_TENANT_LEAKAGE=0)', () => {
  it('forged tenant headers on every M09 read and write route → SF-TEN-002, no canary, no port call', async () => {
    const h = m09Harness(async () => CTX);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    for (const p of [...READ_PROBES, ...WRITE_PROBES]) {
      await expectForgedTenantDenied(app, p.method, p.url, p.method === 'POST' ? {} : undefined);
    }
    expect(allTenantsSeen(h)).toEqual([]);
    expect(h.semanticPool.statements).toEqual([]);
    expect(h.migrationPool.statements).toEqual([]);
    expect(h.riskPool.statements).toEqual([]);
  });

  it('Forwarded: tenant=... is treated as a forged tenant header', async () => {
    const h = m09Harness(async () => CTX);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    for (const p of READ_PROBES) {
      const res = await app.inject({
        method: p.method,
        url: p.url,
        headers: { forwarded: `for=192.0.2.1;tenant=${CANARY}` },
      });
      expect(res.statusCode, `${p.cmp} ${p.url}`).toBe(403);
      expect(res.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    }
    expect(allTenantsSeen(h)).toEqual([]);
  });

  it('tenant_id in a write body is never adopted as identity on any M09 write route', async () => {
    const h = m09Harness(async () => CTX);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    for (const p of WRITE_PROBES) {
      const res = await app.inject({
        method: p.method,
        url: p.url,
        headers: idemHeaders(`int-011-body-${p.cmp}`),
        payload: { tenant_id: CANARY },
      });
      expect(res.statusCode, `${p.cmp} ${p.url}`).toBeGreaterThanOrEqual(400);
      expect(res.body, `${p.cmp} ${p.url}`).not.toContain(CANARY);
    }
    expect(allTenantsSeen(h)).not.toContain(CANARY);
  });

  it('switching the server-side context switches the tenant; nothing from T1 reaches a T2 call', async () => {
    const state = new ContextState(CTX);
    const h = m09Harness(state.resolve);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    await app.inject({ method: 'GET', url: '/v1/privacy/me' });
    state.ctx = ctxFor('22222222-2222-4222-8222-222222222222', OFFICER_1, 'OFFICER');
    await app.inject({ method: 'GET', url: '/v1/privacy/me' });
    expect(h.recorder.seen).toEqual([T1, '22222222-2222-4222-8222-222222222222']);
  });
});

describe('INT-011 M09 unauthenticated requests fail closed with the frozen error envelope', () => {
  async function unauthenticatedOutcomes(): Promise<{
    h: M09Harness;
    wrongStatus: string[];
    badEnvelope: string[];
  }> {
    const h = m09Harness(async () => null);
    app = await buildApp(config, { logger: silentLogger(), m09: h.mounts });
    const wrongStatus: string[] = [];
    const badEnvelope: string[] = [];
    for (const p of [...READ_PROBES, ...WRITE_PROBES]) {
      const res = await app.inject({
        method: p.method,
        url: p.url,
        headers: idemHeaders(`int-011-unauth-${p.cmp}`),
        ...(p.method === 'POST' ? { payload: {} } : {}),
      });
      const body = res.json() as Record<string, unknown>;
      const key = `${p.cmp} ${p.method} ${p.route}`;
      if (res.statusCode !== 401) wrongStatus.push(`${key} -> ${res.statusCode}`);
      if (!validate('error-response', body).valid) {
        badEnvelope.push(`${key} -> ${JSON.stringify(body)}`);
      }
    }
    return { h, wrongStatus, badEnvelope };
  }

  it('no server-side context → request refused and no owner port or DB statement reached', async () => {
    const { h } = await unauthenticatedOutcomes();
    expect(allTenantsSeen(h)).toEqual([]);
    expect(h.semanticPool.statements).toEqual([]);
    expect(h.migrationPool.statements).toEqual([]);
    expect(h.riskPool.statements).toEqual([]);
  });

  it.fails(
    '[F-08 CMP-058] no server-side context → 401 on every M09 route (authentication precedes input validation)',
    async () => {
      const { wrongStatus } = await unauthenticatedOutcomes();
      expect(wrongStatus, 'routes not answering 401 to an unauthenticated caller').toEqual([]);
    },
  );

  it.fails(
    '[F-01 CMP-060] every M09 refusal body conforms to FROZEN SF-CON-ERROR-RESPONSE',
    async () => {
      const { badEnvelope } = await unauthenticatedOutcomes();
      expect(badEnvelope, 'routes emitting a non-SF-CON-ERROR-RESPONSE body').toEqual([]);
    },
  );
});

describe('INT-011 M09 coexistence with prior host modules', () => {
  function m06Mounts(): M06PluginMounts {
    const ok = async () => ({ status: 200, body: { id: DOC } });
    return {
      fee: {
        service: { quote: ok, get: ok, listForApplication: ok },
        resolveContext: async () => CTX,
      },
    };
  }

  function m08Mounts(): M08PluginMounts {
    const ok = new Proxy({}, { get: () => async () => ({ status: 200, body: { id: DOC } }) });
    return {
      ops: { service: ok, resolveContext: async () => CTX },
      retention: { service: ok, resolveContext: async () => CTX },
    };
  }

  it('M06 + M08 + M09 coexist: prior mounts preserved, CMP-036 once, forged tenant denied on each', async () => {
    const h = m09Harness(async () => CTX);
    app = await buildApp(config, {
      logger: silentLogger(),
      m06: m06Mounts(),
      m08: m08Mounts(),
      m09: h.mounts,
    });
    expect(app.m06Mounted).toEqual(['CMP-020']);
    expect(app.m08Mounted).toEqual(['CMP-046', 'CMP-049']);
    expect(app.m09Mounted).toEqual([...M09_EXPECTED]);
    expect(app.printPlugins().split('cmp-036-api-gateway').length - 1).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/v1/fee-quotes/${DOC}` })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: '/v1/privacy/me' })).statusCode).toBe(200);
    await expectForgedTenantDenied(app, 'GET', `/v1/fee-quotes/${DOC}`);
    await expectForgedTenantDenied(app, 'GET', '/v1/ops/views/SLA_SUMMARY');
    await expectForgedTenantDenied(app, 'GET', '/v1/privacy/me');
    await expectForgedTenantDenied(app, 'GET', '/v1/elements');
  });
});
