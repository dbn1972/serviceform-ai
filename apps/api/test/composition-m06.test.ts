import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { M06PluginMounts } from '../src/composition/m06.js';

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

const M06_EXPECTED = ['CMP-020', 'CMP-021', 'CMP-025', 'CMP-026'] as const;

const M06_PROBE_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; url: string }> = [
  { method: 'GET', url: `/v1/fee-quotes/${DOC}` },
  { method: 'GET', url: `/v1/payment-intents/${DOC}` },
  { method: 'GET', url: `/v1/notifications/${DOC}` },
  { method: 'GET', url: `/v1/threads/${DOC}` },
];

function stubFeeService() {
  return {
    quote: async () => ({ status: 201, body: { id: DOC, echo: 'fee' } }),
    get: async () => ({ status: 200, body: { id: DOC, echo: 'fee' } }),
    listForApplication: async () => ({ status: 200, body: { items: [] } }),
  };
}

function stubPaymentService() {
  return {
    createIntent: async () => ({
      status: 201,
      body: { id: DOC, echo: 'payment', mode: 'SIMULATED' },
    }),
    getIntent: async () => ({ status: 200, body: { id: DOC, echo: 'payment', mode: 'SIMULATED' } }),
    applyCallback: async () => ({ status: 200, body: { ok: true, mode: 'SIMULATED' } }),
  };
}

function stubNotificationService() {
  return {
    dispatch: async () => ({
      status: 201,
      body: { id: DOC, echo: 'notification', mode: 'SIMULATED' },
    }),
    get: async () => ({ status: 200, body: { id: DOC, echo: 'notification', mode: 'SIMULATED' } }),
    recordReceipt: async () => ({ status: 200, body: { ok: true } }),
    publishTemplate: async () => ({ status: 201, body: { ok: true } }),
    listTemplateVersions: async () => ({ status: 200, body: { items: [] } }),
  };
}

function stubMessagingService() {
  const ok = (body: unknown) => ({ status: 200, body, replayed: false });
  return {
    openThread: async () => ({
      status: 201,
      body: { id: DOC, echo: 'messaging' },
      replayed: false,
    }),
    listThreadsForApplication: async () => ok({ items: [] }),
    getThread: async () => ok({ id: DOC, echo: 'messaging' }),
    listTransitions: async () => ok({ items: [] }),
    executeCommand: async () => ok({ ok: true }),
    addParticipant: async () => ok({ ok: true }),
    removeParticipant: async () => ok({ ok: true }),
    sendMessage: async () => ({ status: 201, body: { ok: true }, replayed: false }),
    listMessages: async () => ok({ items: [] }),
    retractMessage: async () => ok({ ok: true }),
    acknowledgeNotice: async () => ok({ ok: true }),
    markRead: async () => ok({ ok: true }),
    getAttachmentAccess: async () => ok({ url: 'https://objects.example.test/a' }),
  };
}

function m06Mounts(): M06PluginMounts {
  const resolveContext = async () => CTX;
  return {
    fee: { service: stubFeeService(), resolveContext },
    payment: { service: stubPaymentService(), resolveContext },
    notification: { service: stubNotificationService(), resolveContext },
    messaging: { service: stubMessagingService(), resolveContext },
  };
}

async function expectTen002(app: FastifyInstance, method: 'GET' | 'POST', url: string) {
  const forged = await app.inject({
    method,
    url,
    headers: { 'x-tenant-id': CANARY },
  });
  expect(forged.statusCode).toBe(403);
  expect(validate('error-response', forged.json()).valid).toBe(true);
  expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
  expect(forged.body).not.toContain(CANARY);
  return forged;
}

function countPluginName(printed: string, name: string): number {
  return printed.split(name).length - 1;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host M06 mounts (REQ: host-mount-m06, INT-011, SIMULATED connectors)', () => {
  it('starts without m06 deps and leaves prior decoration unchanged', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect((app as FastifyInstance & { m06Mounted?: string[] }).m06Mounted).toBeUndefined();
    expect(app.wave1Mounted).toEqual([]);
    expect(app.wave2Mounted).toEqual([]);
    expect(app.m02Mounted).toEqual([]);
    expect(app.m03Mounted).toBeUndefined();
    expect(app.m04Mounted).toBeUndefined();
    expect(app.m05Mounted).toBeUndefined();

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    const meta = await app.inject({ method: 'GET', url: '/v1/meta' });
    expect(meta.statusCode).toBe(200);
  });

  it('mounts each M06 HTTP component independently', async () => {
    const full = m06Mounts();
    const singles: Array<[keyof M06PluginMounts, (typeof M06_EXPECTED)[number]]> = [
      ['fee', 'CMP-020'],
      ['payment', 'CMP-021'],
      ['notification', 'CMP-025'],
      ['messaging', 'CMP-026'],
    ];
    for (const [key, cmp] of singles) {
      await app?.close();
      app = await buildApp(config, {
        logger: silentLogger(),
        m06: { [key]: full[key] },
      });
      expect(app.m06Mounted).toEqual([cmp]);
      expect(app.m06Mounted).not.toContain('CMP-036');
    }
  });

  it('mounts all four M06 components with a deterministic CMP list', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts() });
    expect(app.m06Mounted).toEqual([...M06_EXPECTED]);
    expect(app.m06Mounted).not.toContain('CMP-036');
  });

  it('registers CMP-036 exactly once and does not remount it from M06 composition', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts() });
    const plugins = app.printPlugins();
    expect(countPluginName(plugins, 'cmp-036-api-gateway')).toBe(1);

    const appSrc = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(appSrc.match(/register\(apiGatewayPlugin/g)?.length).toBe(1);

    const m06Src = await readFile(new URL('../src/composition/m06.ts', import.meta.url), 'utf8');
    expect(m06Src).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
    expect(m06Src).toMatch(/SIMULATED/);
    expect(m06Src).toMatch(/SF-M08-007/);
  });

  it('exposes M06 routes under /v1 and rejects forged tenant headers', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts() });
    for (const probe of M06_PROBE_ROUTES) {
      expect(probe.url.startsWith('/v1/')).toBe(true);
      await expectTen002(app, probe.method, probe.url);
      const raw = await app.inject({
        method: probe.method,
        url: probe.url,
        headers: { 'X-Tenant-ID': CANARY },
      });
      expect(raw.statusCode).toBe(403);
      expect(raw.json()).toMatchObject({ error_code: 'SF-TEN-002' });
      expect(raw.body).not.toContain(CANARY);
    }
  });

  it('uses server-derived context; forged X-Tenant-ID is not authoritative', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts() });
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/fee-quotes/${DOC}`,
      headers: { 'x-tenant-id': CANARY, 'x-tenant': CANARY },
    });
    expect(denied.statusCode).toBe(403);
    expect(validate('error-response', denied.json()).valid).toBe(true);
    expect(denied.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(denied.body).not.toContain(CANARY);

    const ok = await app.inject({ method: 'GET', url: `/v1/payment-intents/${DOC}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: DOC, mode: 'SIMULATED' });
    expect(ok.body).not.toContain(CANARY);
  });

  it('preserves Wave1–M05 absence when only M06 is supplied', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts() });
    expect(app.wave1Mounted).toEqual([]);
    expect(app.wave2Mounted).toEqual([]);
    expect(app.m02Mounted).toEqual([]);
    expect(app.m03Mounted).toBeUndefined();
    expect(app.m04Mounted).toBeUndefined();
    expect(app.m05Mounted).toBeUndefined();
    expect(app.m06Mounted).toEqual([...M06_EXPECTED]);
  });

  it('documents SIMULATED payment/SMS/email boundaries in composition source', async () => {
    const m06Src = await readFile(new URL('../src/composition/m06.ts', import.meta.url), 'utf8');
    expect(m06Src).toMatch(/SimulatedPspConnector/);
    expect(m06Src).toMatch(/SimulatedChannelConnector/);
    expect(m06Src).toMatch(/REAL HubPsp deferred|REAL hub deferred/);
    expect(m06Src).not.toMatch(/REAL_PSP_SDK|stripe\.|razorpay/i);
  });

  it('does not introduce cross-component SQL in host composition', async () => {
    const m06Src = await readFile(new URL('../src/composition/m06.ts', import.meta.url), 'utf8');
    expect(m06Src).toMatch(/No domain logic, no cross-component SQL/);
    expect(m06Src).not.toMatch(/\bFROM\s+sf_fee\b|\bJOIN\s+sf_payment\b|\bSELECT\s+.+\s+FROM\b/i);
    const appSrc = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(appSrc).toContain('registerM06Plugins');
    expect(appSrc).toContain('m06Mounted');
  });
});
