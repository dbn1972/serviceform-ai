import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { M05PluginMounts } from '../src/composition/m05.js';
import type { M06PluginMounts } from '../src/composition/m06.js';
import type { M07PluginMounts } from '../src/composition/m07.js';
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

const M07_EXPECTED = ['CMP-022', 'CMP-024', 'CMP-023', 'CMP-012'] as const;
type M07Cmp = (typeof M07_EXPECTED)[number];

const M07_PROBE_ROUTES: ReadonlyArray<{ cmp: M07Cmp; method: 'GET' | 'POST'; url: string }> = [
  { cmp: 'CMP-022', method: 'GET', url: `/v1/credentials/${DOC}` },
  { cmp: 'CMP-022', method: 'GET', url: `/v1/applications/${DOC}/credentials` },
  { cmp: 'CMP-024', method: 'GET', url: `/v1/credential-registry/credentials/${DOC}/status` },
  { cmp: 'CMP-023', method: 'GET', url: `/v1/qr/tokens/${DOC}` },
  { cmp: 'CMP-012', method: 'GET', url: `/v1/digilocker-publish/${DOC}` },
];

const M07_COMMAND_ROUTES: ReadonlyArray<{ cmp: M07Cmp; url: string }> = [
  { cmp: 'CMP-022', url: '/v1/credentials' },
  { cmp: 'CMP-024', url: '/v1/credential-registry/credentials' },
  { cmp: 'CMP-023', url: '/v1/qr/tokens' },
  { cmp: 'CMP-012', url: '/v1/digilocker-publish' },
];

const echo = (name: string) => async () => ({ status: 200, body: { id: DOC, echo: name } });
const unreached = async () => {
  throw new Error('command service must not be reached without an idempotency key');
};

function stubCredentialService() {
  return {
    get: echo('credential'),
    listSigningRecords: echo('credential'),
    listForApplication: echo('credential'),
    issue: unreached,
    recordDownstreamOutcome: unreached,
  };
}

function stubRegistryService() {
  return { readStatus: echo('registry'), register: unreached, transition: unreached };
}

function stubQrService() {
  return { getToken: echo('qr'), verify: echo('qr'), issueToken: unreached };
}

function stubDigilockerService() {
  return { getPublishRecord: echo('digilocker'), publishCredential: unreached };
}

function m07Mounts(resolveContext: () => Promise<RequestContext | null> = async () => CTX) {
  return {
    credential: { service: stubCredentialService(), resolveContext },
    registry: { service: stubRegistryService(), resolveContext },
    qr: { service: stubQrService(), resolveContext },
    digilocker: { service: stubDigilockerService(), resolveContext },
  } satisfies M07PluginMounts;
}

function m05Mounts(): M05PluginMounts {
  const resolveContext = async () => CTX;
  const service = {
    getApplication: async () => ({ status: 200, body: { id: DOC }, replayed: false }),
    listTransitions: async () => ({ status: 200, body: { items: [] }, replayed: false }),
    executeCommand: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    registerRequest: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    updateRequestStatus: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    createDraft: async () => ({ status: 201, body: { ok: true }, replayed: false }),
  };
  return { applicationCase: { service, resolveContext } };
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

function m08Mounts(): M08PluginMounts {
  const resolveContext = async () => CTX;
  return {
    ops: { service: { listViews: echo('ops'), getView: echo('ops') }, resolveContext },
  };
}

function countPluginName(printed: string, name: string): number {
  return printed.split(name).length - 1;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host M07 mounts (REQ: host-mount-m07, INT-011)', () => {
  it('starts without m07 deps and leaves prior decoration unchanged', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect(app.m07Mounted).toBeUndefined();
    expect(app.m06Mounted).toBeUndefined();
    expect(app.m08Mounted).toBeUndefined();
    expect(app.wave1Mounted).toEqual([]);
    expect(app.wave2Mounted).toEqual([]);
    expect(app.m02Mounted).toEqual([]);

    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/meta' })).statusCode).toBe(200);
    const unmounted = await app.inject({ method: 'GET', url: `/v1/credentials/${DOC}` });
    expect(unmounted.statusCode).toBe(404);
  });

  it('mounts each M07 component independently', async () => {
    const full = m07Mounts();
    const singles: Array<[keyof M07PluginMounts, M07Cmp]> = [
      ['credential', 'CMP-022'],
      ['registry', 'CMP-024'],
      ['qr', 'CMP-023'],
      ['digilocker', 'CMP-012'],
    ];
    for (const [key, cmp] of singles) {
      await app?.close();
      app = await buildApp(config, { logger: silentLogger(), m07: { [key]: full[key] } });
      expect(app.m07Mounted).toEqual([cmp]);
      for (const probe of M07_PROBE_ROUTES) {
        const res = await app.inject({ method: probe.method, url: probe.url });
        if (probe.cmp === cmp) expect(res.statusCode, probe.url).toBe(200);
        else expect(res.statusCode, probe.url).toBe(404);
      }
    }
  });

  it('mounts all four M07 components with a deterministic CMP list', async () => {
    app = await buildApp(config, { logger: silentLogger(), m07: m07Mounts() });
    expect(app.m07Mounted).toEqual([...M07_EXPECTED]);
    expect(app.m07Mounted).not.toContain('CMP-036');
  });

  it('registers CMP-036 exactly once and does not remount it from M07 composition', async () => {
    app = await buildApp(config, { logger: silentLogger(), m07: m07Mounts() });
    expect(countPluginName(app.printPlugins(), 'cmp-036-api-gateway')).toBe(1);

    const appSrc = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(appSrc.match(/register\(apiGatewayPlugin/g)?.length).toBe(1);

    const m07Src = await readFile(new URL('../src/composition/m07.ts', import.meta.url), 'utf8');
    expect(m07Src).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
  });

  it('exposes M07 read routes under /v1 that reach each component with server context', async () => {
    app = await buildApp(config, { logger: silentLogger(), m07: m07Mounts() });
    for (const probe of M07_PROBE_ROUTES) {
      expect(probe.url.startsWith('/v1/')).toBe(true);
      const res = await app.inject({ method: probe.method, url: probe.url });
      expect(res.statusCode, `${probe.cmp} ${probe.url}`).toBe(200);
      expect(res.json()).toMatchObject({ id: DOC });
    }
  });

  it('fails closed when the server context resolver yields no tenant context', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      m07: m07Mounts(async () => null),
    });
    for (const probe of M07_PROBE_ROUTES) {
      const res = await app.inject({ method: probe.method, url: probe.url });
      expect([401, 403], `${probe.cmp} ${probe.url}`).toContain(res.statusCode);
      expect(res.json()).toMatchObject({ error_code: expect.stringMatching(/^SF-(AUTH|TEN)-00/) });
    }
  });

  it('rejects M07 commands without an Idempotency-Key before reaching the service', async () => {
    app = await buildApp(config, { logger: silentLogger(), m07: m07Mounts() });
    for (const route of M07_COMMAND_ROUTES) {
      const res = await app.inject({ method: 'POST', url: route.url, payload: {} });
      expect(res.statusCode, `${route.cmp} ${route.url}`).toBe(400);
      expect(validate('error-response', res.json()).valid).toBe(true);
      expect(res.json()).toMatchObject({ error_code: 'SF-SYS-003' });
    }
  });

  it('rejects forged tenant headers on every M07 route (SF-TEN-002)', async () => {
    app = await buildApp(config, { logger: silentLogger(), m07: m07Mounts() });
    const all = [
      ...M07_PROBE_ROUTES,
      ...M07_COMMAND_ROUTES.map((r) => ({ ...r, method: 'POST' as const })),
    ];
    for (const probe of all) {
      for (const headers of [
        { 'x-tenant-id': CANARY },
        { 'X-Tenant-ID': CANARY, 'x-tenant': CANARY },
      ]) {
        const res = await app.inject({ method: probe.method, url: probe.url, headers });
        expect(res.statusCode, `${probe.cmp} ${probe.url}`).toBe(403);
        expect(validate('error-response', res.json()).valid).toBe(true);
        expect(res.json()).toMatchObject({ error_code: 'SF-TEN-002' });
        expect(res.body).not.toContain(CANARY);
      }
    }
  });

  it('coexists with M05/M06/M08 mounts without route collisions or regressions', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      m05: m05Mounts(),
      m06: m06Mounts(),
      m07: m07Mounts(),
      m08: m08Mounts(),
    });
    expect(app.m05Mounted).toEqual(['CMP-015']);
    expect(app.m06Mounted).toEqual(['CMP-020']);
    expect(app.m07Mounted).toEqual([...M07_EXPECTED]);
    expect(app.m08Mounted).toEqual(['CMP-046']);
    expect(countPluginName(app.printPlugins(), 'cmp-036-api-gateway')).toBe(1);

    for (const probe of M07_PROBE_ROUTES) {
      const res = await app.inject({ method: probe.method, url: probe.url });
      expect(res.statusCode, probe.url).toBe(200);
    }
    const application = await app.inject({ method: 'GET', url: `/v1/applications/${DOC}` });
    expect(application.statusCode).not.toBe(404);
    expect((await app.inject({ method: 'GET', url: `/v1/fee-quotes/${DOC}` })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' })).statusCode).toBe(
      200,
    );
  });

  it('keeps host composition free of cross-component SQL and domain authority', async () => {
    const m07Src = await readFile(new URL('../src/composition/m07.ts', import.meta.url), 'utf8');
    expect(m07Src).toMatch(/No domain logic, no cross-component SQL/);
    expect(m07Src).not.toMatch(/\bSELECT\s+.+\s+FROM\b|\bJOIN\s+sf_|\bpg\b.*Pool/i);
    expect(m07Src).not.toMatch(/SF_ENVIRONMENT\s*===|tenant_id\s*:/);
    const appSrc = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(appSrc).toContain('registerM07Plugins');
    expect(appSrc).toContain('m07Mounted');
    for (const prior of ['registerM05Plugins', 'registerM06Plugins', 'registerM08Plugins']) {
      expect(appSrc).toContain(prior);
    }
  });
});
