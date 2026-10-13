import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { M06PluginMounts } from '../src/composition/m06.js';
import type { M08PluginMounts } from '../src/composition/m08.js';

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

const M08_EXPECTED = ['CMP-035', 'CMP-007', 'CMP-045', 'CMP-046', 'CMP-049', 'CMP-006'] as const;

const M08_PROBE_ROUTES: ReadonlyArray<{
  cmp: (typeof M08_EXPECTED)[number];
  method: 'GET' | 'POST';
  url: string;
}> = [
  { cmp: 'CMP-035', method: 'GET', url: `/v1/search/documents/${DOC}` },
  { cmp: 'CMP-007', method: 'GET', url: `/v1/recommendations/${DOC}` },
  { cmp: 'CMP-045', method: 'GET', url: `/v1/analytics/metric-definitions/${DOC}` },
  { cmp: 'CMP-046', method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' },
  { cmp: 'CMP-049', method: 'GET', url: `/v1/retention/policies/${DOC}` },
  { cmp: 'CMP-006', method: 'GET', url: `/v1/discovery/queries/${DOC}` },
];

const echo = (name: string) => async () => ({ status: 200, body: { id: DOC, echo: name } });

function stubSearchService() {
  return { query: echo('search'), getDocument: echo('search') };
}

function recommendationOptions(): Record<string, unknown> {
  const unused = async () => {
    throw new Error('not reached in host composition tests');
  };
  return {
    repository: { withTx: unused, inTransaction: () => false },
    // Deny-by-default PDP double: proves the request reached CMP-007 with server context.
    authorizer: {
      decide: async () => ({
        allow: false,
        reason_code: 'DENY_DEFAULT',
        policy_revision: 'test',
        decision_id: DOC,
      }),
    },
    catalogue: { candidates: unused },
    consent: { check: unused },
    profile: { signals: unused },
    gateway: { invoke: unused },
  };
}

function stubAnalyticsService() {
  return { getDefinition: echo('analytics'), listDefinitions: echo('analytics') };
}

function stubOpsService() {
  return { listViews: echo('ops'), getView: echo('ops') };
}

function stubRetentionService() {
  return { getPolicy: echo('retention'), getSubject: echo('retention') };
}

function stubDiscoveryService() {
  return { getQuery: echo('discovery'), query: echo('discovery') };
}

function m08Mounts(): M08PluginMounts {
  const resolveContext = async () => CTX;
  return {
    search: { service: stubSearchService(), resolveContext },
    recommendation: { options: recommendationOptions(), resolveContext },
    analytics: { service: stubAnalyticsService(), resolveContext },
    ops: { service: stubOpsService(), resolveContext },
    retention: { service: stubRetentionService(), resolveContext },
    discovery: { service: stubDiscoveryService(), resolveContext },
  };
}

function m06Mounts(): M06PluginMounts {
  const resolveContext = async () => CTX;
  return {
    fee: {
      service: { quote: echo('fee'), get: echo('fee'), listForApplication: echo('fee') },
      resolveContext,
    },
  };
}

async function expectTen002(app: FastifyInstance, method: 'GET' | 'POST', url: string) {
  const forged = await app.inject({ method, url, headers: { 'x-tenant-id': CANARY } });
  expect(forged.statusCode).toBe(403);
  expect(validate('error-response', forged.json()).valid).toBe(true);
  expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
  expect(forged.body).not.toContain(CANARY);
}

function countPluginName(printed: string, name: string): number {
  return printed.split(name).length - 1;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host M08 mounts (REQ: host-mount-m08, INT-011)', () => {
  it('starts without m08 deps and leaves prior decoration unchanged', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect(app.m08Mounted).toBeUndefined();
    expect(app.m06Mounted).toBeUndefined();
    expect(app.wave1Mounted).toEqual([]);
    expect(app.wave2Mounted).toEqual([]);
    expect(app.m02Mounted).toEqual([]);

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    const meta = await app.inject({ method: 'GET', url: '/v1/meta' });
    expect(meta.statusCode).toBe(200);
  });

  it('mounts each M08 component independently', async () => {
    const full = m08Mounts();
    const singles: Array<[keyof M08PluginMounts, (typeof M08_EXPECTED)[number]]> = [
      ['search', 'CMP-035'],
      ['recommendation', 'CMP-007'],
      ['analytics', 'CMP-045'],
      ['ops', 'CMP-046'],
      ['retention', 'CMP-049'],
      ['discovery', 'CMP-006'],
    ];
    for (const [key, cmp] of singles) {
      await app?.close();
      app = await buildApp(config, { logger: silentLogger(), m08: { [key]: full[key] } });
      expect(app.m08Mounted).toEqual([cmp]);
      expect(app.m08Mounted).not.toContain('CMP-036');
    }
  });

  it('mounts all six M08 components with a deterministic CMP list', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    expect(app.m08Mounted).toEqual([...M08_EXPECTED]);
    expect(app.m08Mounted).not.toContain('CMP-036');
  });

  it('registers CMP-036 exactly once and does not remount it from M08 composition', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    expect(countPluginName(app.printPlugins(), 'cmp-036-api-gateway')).toBe(1);

    const appSrc = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(appSrc.match(/register\(apiGatewayPlugin/g)?.length).toBe(1);

    const m08Src = await readFile(new URL('../src/composition/m08.ts', import.meta.url), 'utf8');
    expect(m08Src).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
    expect(m08Src).toMatch(/SF-M06-005/);
  });

  it('exposes M08 routes under /v1 that reach each component with server-derived context', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    for (const probe of M08_PROBE_ROUTES) {
      expect(probe.url.startsWith('/v1/')).toBe(true);
      const res = await app.inject({ method: probe.method, url: probe.url });
      expect(res.statusCode, `${probe.cmp} ${probe.url}`).not.toBe(404);
      if (probe.cmp === 'CMP-007') {
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
      } else {
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id: DOC });
      }
    }
  });

  it('rejects forged tenant headers on every M08 route (SF-TEN-002)', async () => {
    app = await buildApp(config, { logger: silentLogger(), m08: m08Mounts() });
    for (const probe of M08_PROBE_ROUTES) {
      await expectTen002(app, probe.method, probe.url);
      const raw = await app.inject({
        method: probe.method,
        url: probe.url,
        headers: { 'X-Tenant-ID': CANARY, 'x-tenant': CANARY },
      });
      expect(raw.statusCode).toBe(403);
      expect(raw.json()).toMatchObject({ error_code: 'SF-TEN-002' });
      expect(raw.body).not.toContain(CANARY);
    }
  });

  it('coexists with M06 mounts without regressing them (hard serial vs SF-M06-005)', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts(), m08: m08Mounts() });
    expect(app.m06Mounted).toEqual(['CMP-020']);
    expect(app.m08Mounted).toEqual([...M08_EXPECTED]);
    expect(countPluginName(app.printPlugins(), 'cmp-036-api-gateway')).toBe(1);
    const fee = await app.inject({ method: 'GET', url: `/v1/fee-quotes/${DOC}` });
    expect(fee.statusCode).toBe(200);
    const ops = await app.inject({ method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' });
    expect(ops.statusCode).toBe(200);
  });

  it('keeps host composition free of cross-component SQL and retention periods', async () => {
    const m08Src = await readFile(new URL('../src/composition/m08.ts', import.meta.url), 'utf8');
    expect(m08Src).toMatch(/No domain logic, no cross-component SQL/);
    expect(m08Src).not.toMatch(/\bSELECT\s+.+\s+FROM\b|\bJOIN\s+sf_/i);
    expect(m08Src).not.toMatch(/\b\d+\s*(days?|months?|years?)\b/i);
    const appSrc = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(appSrc).toContain('registerM08Plugins');
    expect(appSrc).toContain('m08Mounted');
    expect(appSrc).toContain('registerM06Plugins');
  });
});
