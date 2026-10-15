import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import type { M09PluginMounts } from '../../../apps/api/src/composition/m09.js';
import { ROUTE_DESCRIPTORS as SCHEDULER_ROUTES } from '../../../services/cmp-056-scheduler/src/index.js';
import { ROUTE_DESCRIPTORS as ASSISTED_ROUTES } from '../../../services/cmp-057-assisted-service/src/index.js';
import { ROUTE_DESCRIPTORS as PRIVACY_ROUTES } from '../../../services/cmp-061-privacy-centre/src/index.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m09-sec',
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

type Method = 'GET' | 'POST' | 'DELETE';
type Probe = { cmp: string; method: Method; url: string };

function concrete(path: string): string {
  return path
    .replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
    .replace(/:[A-Za-z0-9_]+/g, (seg) => (seg === ':version' ? '1' : DOC));
}

function fromDescriptors(
  cmp: string,
  routes: ReadonlyArray<{ method: string; path: string }>,
): Probe[] {
  return routes.map((r) => ({ cmp, method: r.method as Method, url: concrete(r.path) }));
}

/** CMP-058 / CMP-059 register relative to the host `/v1` prefix; CMP-060 registers absolute paths. */
const PLUGIN_PROBES: Probe[] = [
  { cmp: 'CMP-058', method: 'GET', url: '/v1/elements' },
  { cmp: 'CMP-058', method: 'GET', url: '/v1/elements/:id' },
  { cmp: 'CMP-058', method: 'GET', url: '/v1/elements/:id/versions/:version' },
  { cmp: 'CMP-058', method: 'POST', url: '/v1/elements' },
  { cmp: 'CMP-058', method: 'POST', url: '/v1/elements/:id/publish' },
  { cmp: 'CMP-058', method: 'POST', url: '/v1/elements/:id/deprecate' },
  { cmp: 'CMP-058', method: 'GET', url: '/v1/bindings' },
  { cmp: 'CMP-058', method: 'GET', url: '/v1/bindings/:id' },
  { cmp: 'CMP-058', method: 'POST', url: '/v1/bindings' },
  { cmp: 'CMP-058', method: 'DELETE', url: '/v1/bindings/:id' },
  { cmp: 'CMP-058', method: 'POST', url: '/v1/mappings/validate' },
  { cmp: 'CMP-058', method: 'GET', url: '/v1/usage/:id' },
  { cmp: 'CMP-059', method: 'POST', url: '/v1/migrations/projects' },
  { cmp: 'CMP-059', method: 'POST', url: '/v1/migrations/:id/profile' },
  { cmp: 'CMP-059', method: 'POST', url: '/v1/migrations/:id/map' },
  { cmp: 'CMP-059', method: 'POST', url: '/v1/migrations/:id/dry-run' },
  { cmp: 'CMP-059', method: 'POST', url: '/v1/migrations/:id/execute' },
  { cmp: 'CMP-059', method: 'GET', url: '/v1/migrations/:id/reconciliation' },
  { cmp: 'CMP-060', method: 'POST', url: '/v1/risk/assessments' },
  { cmp: 'CMP-060', method: 'GET', url: '/v1/risk/assessments/:assessmentId' },
  { cmp: 'CMP-060', method: 'POST', url: '/v1/risk/assessments/:assessmentId/review' },
];

/** Every published M09 route on the host (neutral descriptors + Fastify plugin routes). */
const PROBES: Probe[] = [
  ...fromDescriptors('CMP-056', SCHEDULER_ROUTES),
  ...fromDescriptors('CMP-057', ASSISTED_ROUTES),
  ...PLUGIN_PROBES.map((p) => ({ ...p, url: concrete(p.url) })),
  ...fromDescriptors('CMP-061', PRIVACY_ROUTES),
];

const PLUGIN_ROUTE_DIRS: Record<string, string> = {
  'CMP-058': 'services/cmp-058-semantic-registry/src/routes',
  'CMP-059': 'services/cmp-059-migration-workbench/src/routes',
  'CMP-060': 'services/cmp-060-risk-integrity/src/routes',
};

function registeredRouteCount(dir: string): number {
  let n = 0;
  for (const f of readdirSync(join(ROOT, dir))) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(join(ROOT, dir, f), 'utf8');
    n += [...src.matchAll(/\b(?:app|fastify)\.(?:get|post|put|patch|delete)\b/g)].length;
  }
  return n;
}

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

function recordingPool(calls: string[], label: string) {
  const query = async () => {
    calls.push(`${label}.query`);
    return { rows: [], rowCount: 0 };
  };
  return {
    query,
    connect: async () => {
      calls.push(`${label}.connect`);
      return { query, release: () => undefined };
    },
    end: async () => undefined,
    on: () => undefined,
  };
}

function recordingAuthorizer(calls: string[], label: string) {
  return {
    decide: async () => {
      calls.push(`${label}.authorizer`);
      return {
        allow: false,
        reason_code: 'DENY_DEFAULT',
        policy_revision: 'test',
        decision_id: DOC,
      };
    },
  };
}

function m09Mounts(calls: string[]): M09PluginMounts {
  const resolveContext = async () => {
    calls.push('resolveContext');
    return CTX;
  };
  return {
    scheduler: { service: recordingDouble(calls, 'scheduler'), resolveContext },
    assisted: { service: recordingDouble(calls, 'assisted'), resolveContext },
    semantic: {
      options: {
        pool: recordingPool(calls, 'semantic.pool'),
        authorizer: recordingAuthorizer(calls, 'semantic'),
      },
      resolveContext,
    },
    migration: {
      options: {
        pool: recordingPool(calls, 'migration.pool'),
        authorizer: recordingAuthorizer(calls, 'migration'),
      },
      resolveContext,
    },
    risk: {
      options: {
        pool: recordingPool(calls, 'risk.pool'),
        authz: {
          canActOnRisk: async () => {
            calls.push('risk.authz');
            return false;
          },
        },
      },
      resolveContext,
    },
    privacy: { service: recordingDouble(calls, 'privacy'), resolveContext },
  };
}

function captureLogger(lines: string[]) {
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return createLogger({ service: 'm09-sec', version: 'test', level: 'info', destination });
}

const FORGED_HEADER_SETS: ReadonlyArray<Record<string, string>> = [
  { 'x-tenant-id': CANARY },
  { 'X-Tenant-ID': CANARY },
  { 'x-tenant': CANARY },
  { 'x-tenant-id': T1 },
  { 'x-sf-tenant': CANARY },
  { forwarded: `for=192.0.2.1;tenant=${CANARY}` },
];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M09-SEC forged tenant HTTP (fail-closed)', () => {
  it('covers every published M09 route and every M09 component', () => {
    const cmps = new Set(PROBES.map((p) => p.cmp));
    expect([...cmps].sort()).toEqual(
      ['CMP-056', 'CMP-057', 'CMP-058', 'CMP-059', 'CMP-060', 'CMP-061'].sort(),
    );
    for (const [cmp, dir] of Object.entries(PLUGIN_ROUTE_DIRS)) {
      expect(
        PLUGIN_PROBES.filter((p) => p.cmp === cmp).length,
        `${cmp} probes vs registered routes in ${dir}`,
      ).toBe(registeredRouteCount(dir));
    }
    expect(PROBES.length).toBe(
      SCHEDULER_ROUTES.length +
        ASSISTED_ROUTES.length +
        PRIVACY_ROUTES.length +
        PLUGIN_PROBES.length,
    );
    for (const p of PROBES) expect(p.url.startsWith('/v1/')).toBe(true);
  });

  it('every probed route is registered on the host and live (not 404) without forged headers', async () => {
    const calls: string[] = [];
    app = await buildApp(config, { logger: captureLogger([]), m09: m09Mounts(calls) });
    expect(app.m09Mounted).toEqual([
      'CMP-056',
      'CMP-057',
      'CMP-058',
      'CMP-059',
      'CMP-060',
      'CMP-061',
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

  it('denies forged tenant headers on all M09 routes with SF-TEN-002; CROSS_TENANT_LEAKAGE=0', async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    app = await buildApp(config, { logger: captureLogger(logs), m09: m09Mounts(calls) });
    let leakage = 0;
    let probes = 0;
    for (const p of PROBES) {
      for (const headers of FORGED_HEADER_SETS) {
        const res = await app.inject({
          method: p.method,
          url: p.url,
          headers,
          payload: p.method === 'POST' ? { tenant_id: CANARY } : undefined,
        });
        probes += 1;
        expect(res.statusCode, `${p.method} ${p.url} ${JSON.stringify(headers)}`).toBe(403);
        const body = res.json();
        expect(validate('error-response', body).valid).toBe(true);
        expect(body).toMatchObject({ error_code: 'SF-TEN-002' });
        if (res.body.includes(CANARY)) leakage += 1;
      }
    }
    expect(probes).toBe(PROBES.length * FORGED_HEADER_SETS.length);
    expect(leakage).toBe(0);
    expect(
      calls,
      'forged requests must not reach resolveContext or any M09 component port',
    ).toEqual([]);
    expect(logs.join('').includes(CANARY)).toBe(false);
  });

  it('does not admit or echo a foreign tenant_id supplied in a request body', async () => {
    const calls: string[] = [];
    app = await buildApp(config, { logger: captureLogger([]), m09: m09Mounts(calls) });
    for (const url of [
      '/v1/appointments',
      '/v1/assisted/sessions',
      '/v1/privacy/requests',
      '/v1/risk/assessments',
      '/v1/migrations/projects',
      '/v1/bindings',
    ]) {
      const res = await app.inject({ method: 'POST', url, payload: { tenant_id: CANARY } });
      expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(res.body.includes(CANARY), url).toBe(false);
    }
  });
});
