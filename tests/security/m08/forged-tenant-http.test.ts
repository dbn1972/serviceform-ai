import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import type { M08PluginMounts } from '../../../apps/api/src/composition/m08.js';
import { ROUTE_DESCRIPTORS as ANALYTICS_ROUTES } from '../../../services/cmp-045-analytics-mis/src/index.js';
import { ROUTE_DESCRIPTORS as OPS_ROUTES } from '../../../services/cmp-046-operational-dashboard/src/index.js';
import { ROUTE_DESCRIPTORS as RETENTION_ROUTES } from '../../../services/cmp-049-data-retention/src/index.js';
import { ROUTE_DESCRIPTORS as DISCOVERY_ROUTES } from '../../../services/cmp-006-service-discovery/src/index.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m08-sec',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

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

type Probe = { cmp: string; method: 'GET' | 'POST'; url: string };

function concrete(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, (seg) => (seg === ':view_code' ? 'SLA_SUMMARY' : DOC));
}

function fromDescriptors(
  cmp: string,
  routes: ReadonlyArray<{ method: string; path: string }>,
): Probe[] {
  return routes.map((r) => ({
    cmp,
    method: r.method as 'GET' | 'POST',
    url: concrete(r.path),
  }));
}

/** Every published M08 route on the host (component descriptors + Fastify plugin routes). */
const PROBES: Probe[] = [
  { cmp: 'CMP-035', method: 'POST', url: '/v1/search/queries' },
  { cmp: 'CMP-035', method: 'GET', url: `/v1/search/documents/${DOC}` },
  { cmp: 'CMP-007', method: 'POST', url: '/v1/recommendations' },
  { cmp: 'CMP-007', method: 'GET', url: `/v1/recommendations/${DOC}` },
  { cmp: 'CMP-007', method: 'POST', url: `/v1/recommendations/${DOC}/disposition` },
  ...fromDescriptors('CMP-045', ANALYTICS_ROUTES),
  ...fromDescriptors('CMP-046', OPS_ROUTES),
  ...fromDescriptors('CMP-049', RETENTION_ROUTES),
  ...fromDescriptors('CMP-006', DISCOVERY_ROUTES),
];

/** Records any service/port invocation; a forged request must never reach one. */
function recordingDouble(calls: string[], label: string): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return async () => {
          calls.push(`${label}.${prop}`);
          return { status: 200, body: { id: DOC } };
        };
      },
    },
  );
}

function m08Mounts(calls: string[]): M08PluginMounts {
  const resolveContext = async () => {
    calls.push('resolveContext');
    return CTX;
  };
  return {
    search: { service: recordingDouble(calls, 'search'), resolveContext },
    recommendation: {
      options: {
        repository: {
          withTx: async () => {
            calls.push('recommendation.repository');
            throw new Error('unreachable');
          },
          inTransaction: () => false,
        },
        authorizer: {
          decide: async () => {
            calls.push('recommendation.authorizer');
            return {
              allow: false,
              reason_code: 'DENY_DEFAULT',
              policy_revision: 'test',
              decision_id: DOC,
            };
          },
        },
        catalogue: recordingDouble(calls, 'recommendation.catalogue'),
        consent: recordingDouble(calls, 'recommendation.consent'),
        profile: recordingDouble(calls, 'recommendation.profile'),
        gateway: recordingDouble(calls, 'recommendation.gateway'),
      },
      resolveContext,
    },
    analytics: { service: recordingDouble(calls, 'analytics'), resolveContext },
    ops: { service: recordingDouble(calls, 'ops'), resolveContext },
    retention: { service: recordingDouble(calls, 'retention'), resolveContext },
    discovery: { service: recordingDouble(calls, 'discovery'), resolveContext },
  };
}

function silentLogger(lines: string[]) {
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return createLogger({ service: 'm08-sec', version: 'test', level: 'info', destination });
}

const FORGED_HEADER_SETS: ReadonlyArray<Record<string, string>> = [
  { 'x-tenant-id': CANARY },
  { 'X-Tenant-ID': CANARY },
  { 'x-tenant': CANARY },
  { 'x-tenant-id': T1 },
];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M08-SEC forged tenant HTTP (fail-closed)', () => {
  it('covers every published M08 route and every M08 component', () => {
    const cmps = new Set(PROBES.map((p) => p.cmp));
    expect([...cmps].sort()).toEqual(
      ['CMP-006', 'CMP-007', 'CMP-035', 'CMP-045', 'CMP-046', 'CMP-049'].sort(),
    );
    expect(PROBES.length).toBe(
      5 +
        ANALYTICS_ROUTES.length +
        OPS_ROUTES.length +
        RETENTION_ROUTES.length +
        DISCOVERY_ROUTES.length,
    );
    for (const p of PROBES) expect(p.url.startsWith('/v1/')).toBe(true);
  });

  it('mounted routes are live (not 404) without forged headers', async () => {
    const calls: string[] = [];
    app = await buildApp(config, { logger: silentLogger([]), m08: m08Mounts(calls) });
    expect(app.m08Mounted).toEqual([
      'CMP-035',
      'CMP-007',
      'CMP-045',
      'CMP-046',
      'CMP-049',
      'CMP-006',
    ]);
    for (const p of PROBES) {
      const res = await app.inject({
        method: p.method,
        url: p.url,
        payload: p.method === 'POST' ? {} : undefined,
      });
      expect(res.statusCode, `${p.method} ${p.url}`).not.toBe(404);
    }
  });

  it('denies forged tenant headers on all M08 routes with SF-TEN-002; CROSS_TENANT_LEAKAGE=0', async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    app = await buildApp(config, { logger: silentLogger(logs), m08: m08Mounts(calls) });
    let leakage = 0;
    for (const p of PROBES) {
      for (const headers of FORGED_HEADER_SETS) {
        const res = await app.inject({
          method: p.method,
          url: p.url,
          headers,
          payload: p.method === 'POST' ? { tenant_id: CANARY } : undefined,
        });
        expect(res.statusCode, `${p.method} ${p.url} ${JSON.stringify(headers)}`).toBe(403);
        const body = res.json();
        expect(validate('error-response', body).valid).toBe(true);
        expect(body).toMatchObject({ error_code: 'SF-TEN-002' });
        if (res.body.includes(CANARY)) leakage += 1;
      }
    }
    expect(leakage).toBe(0);
    expect(calls, 'forged requests must not reach any M08 component port').toEqual([]);
    expect(logs.join('').includes(CANARY)).toBe(false);
  });

  it('does not admit or echo a foreign tenant_id supplied in a request body', async () => {
    const calls: string[] = [];
    app = await buildApp(config, { logger: silentLogger([]), m08: m08Mounts(calls) });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { tenant_id: CANARY },
    });
    expect(res.statusCode).not.toBe(200);
    expect(res.body.includes(CANARY)).toBe(false);
  });
});
