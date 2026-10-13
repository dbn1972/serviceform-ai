import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '@serviceform/contracts';
import { buildApp } from '../../../apps/api/src/app.js';
import type { M06PluginMounts } from '../../../apps/api/src/composition/m06.js';
import type { M08PluginMounts } from '../../../apps/api/src/composition/m08.js';
import {
  CANARY,
  config,
  ctxFor,
  DOC,
  expectForgedTenantDenied,
  OFFICER_1,
  silentLogger,
  T1,
} from './support/fixtures.js';

const M08_EXPECTED = ['CMP-035', 'CMP-007', 'CMP-045', 'CMP-046', 'CMP-049', 'CMP-006'] as const;
const CTX: RequestContext = ctxFor(T1, OFFICER_1, 'OFFICER');

type Probe = { cmp: (typeof M08_EXPECTED)[number]; method: 'GET' | 'POST'; url: string };

const READ_PROBES: readonly Probe[] = [
  { cmp: 'CMP-035', method: 'GET', url: `/v1/search/documents/${DOC}` },
  { cmp: 'CMP-007', method: 'GET', url: `/v1/recommendations/${DOC}` },
  { cmp: 'CMP-045', method: 'GET', url: `/v1/analytics/metric-definitions/${DOC}` },
  { cmp: 'CMP-046', method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' },
  { cmp: 'CMP-049', method: 'GET', url: `/v1/retention/policies/${DOC}` },
  { cmp: 'CMP-006', method: 'GET', url: `/v1/discovery/queries/${DOC}` },
];

const WRITE_PROBES: readonly Probe[] = [
  { cmp: 'CMP-035', method: 'POST', url: '/v1/search/queries' },
  { cmp: 'CMP-007', method: 'POST', url: '/v1/recommendations' },
  { cmp: 'CMP-045', method: 'POST', url: '/v1/analytics/metric-definitions' },
  { cmp: 'CMP-046', method: 'POST', url: '/v1/ops/views/SLA_SUMMARY/refresh' },
  { cmp: 'CMP-049', method: 'POST', url: '/v1/retention/policies' },
  { cmp: 'CMP-006', method: 'POST', url: '/v1/discovery/queries' },
];

/** Records the tenant each service call saw, so leakage of a forged value is observable. */
const seenTenants: string[] = [];

function recorder(name: string) {
  return async (...args: unknown[]) => {
    const ctx = args.find(
      (a): a is { tenant_id: string } =>
        typeof a === 'object' && a !== null && 'tenant_id' in (a as Record<string, unknown>),
    );
    if (ctx) seenTenants.push(ctx.tenant_id);
    return { status: 200, body: { id: DOC, echo: name } };
  };
}

function serviceProxy(name: string): unknown {
  return new Proxy({}, { get: () => recorder(name) });
}

function recommendationOptions(): Record<string, unknown> {
  const unused = async () => {
    throw new Error('not reached at host seam');
  };
  return {
    repository: { withTx: unused, inTransaction: () => false },
    authorizer: {
      decide: async (input: { subject: { tenant_id: string } }) => {
        seenTenants.push(input.subject.tenant_id);
        return {
          allow: false,
          reason_code: 'DENY_DEFAULT',
          policy_revision: 'int',
          decision_id: DOC,
        };
      },
    },
    catalogue: { candidates: unused },
    consent: { check: unused },
    profile: { signals: unused },
    gateway: { invoke: unused },
  };
}

function m08Mounts(): M08PluginMounts {
  const resolveContext = async () => CTX;
  return {
    search: { service: serviceProxy('search'), resolveContext },
    recommendation: { options: recommendationOptions(), resolveContext },
    analytics: { service: serviceProxy('analytics'), resolveContext },
    ops: { service: serviceProxy('ops'), resolveContext },
    retention: { service: serviceProxy('retention'), resolveContext },
    discovery: { service: serviceProxy('discovery'), resolveContext },
  };
}

function m06Mounts(): M06PluginMounts {
  const resolveContext = async () => CTX;
  const ok = async () => ({ status: 200, body: { id: DOC } });
  return { fee: { service: { quote: ok, get: ok, listForApplication: ok }, resolveContext } };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  seenTenants.length = 0;
});

describe('INT-011 M08 host admission + forged tenant denial', () => {
  it('admits six M08 mounts in deterministic order; CMP-036 registered exactly once', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    expect(app.m08Mounted).toEqual([...M08_EXPECTED]);
    expect(app.printPlugins().split('cmp-036-api-gateway').length - 1).toBe(1);
  });

  it('every M08 read route is reachable and served with server-derived tenant only', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    for (const p of READ_PROBES) {
      const res = await app.inject({ method: p.method, url: p.url });
      expect(res.statusCode, `${p.cmp} ${p.url}`).not.toBe(404);
      if (p.cmp === 'CMP-007') {
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
      } else {
        expect(res.statusCode, `${p.cmp} ${p.url}`).toBe(200);
      }
    }
    expect(seenTenants.length).toBeGreaterThan(0);
    expect(new Set(seenTenants)).toEqual(new Set([T1]));
  });

  it('forged tenant headers on every M08 read and write route → SF-TEN-002, no canary, no service call', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    for (const p of [...READ_PROBES, ...WRITE_PROBES]) {
      await expectForgedTenantDenied(app, p.method, p.url, p.method === 'POST' ? {} : undefined);
    }
    expect(seenTenants).toEqual([]);
  });

  it('tenant_id in the request body is never adopted as identity', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/discovery/queries',
      payload: { tenant_id: CANARY },
    });
    expect(res.body).not.toContain(CANARY);
    expect(seenTenants).not.toContain(CANARY);
  });

  it('M06 + M08 coexist: M06 mounts preserved, CMP-036 once, forged tenant denied on both', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts(), m08: m08Mounts() });
    expect(app.m06Mounted).toEqual(['CMP-020']);
    expect(app.m08Mounted).toEqual([...M08_EXPECTED]);
    expect(app.printPlugins().split('cmp-036-api-gateway').length - 1).toBe(1);
    const fee = await app.inject({ method: 'GET', url: `/v1/fee-quotes/${DOC}` });
    expect(fee.statusCode).toBe(200);
    await expectForgedTenantDenied(app, 'GET', `/v1/fee-quotes/${DOC}`);
    await expectForgedTenantDenied(app, 'GET', '/v1/ops/views/SLA_SUMMARY');
  });

  it('host without M08 deps leaves m08Mounted undefined and M08 paths unrouted', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect(app.m08Mounted).toBeUndefined();
    const res = await app.inject({ method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' });
    expect(res.statusCode).toBe(404);
    expect(validate('error-response', res.json()).valid).toBe(true);
  });
});
