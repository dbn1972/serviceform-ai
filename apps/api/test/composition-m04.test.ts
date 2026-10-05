import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { registerM04Plugins, type M04PluginMounts } from '../src/composition/m04.js';

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
const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

const DENY = {
  allow: false as const,
  reason_code: 'ROLE_DENIED',
  policy_revision: 'test-1',
  decision_id: '00000000-0000-4000-8000-0000000000bb',
};

const M04_EXPECTED = ['CMP-039', 'CMP-008', 'CMP-011', 'CMP-013', 'CMP-009', 'CMP-014'] as const;
const M02_EXPECTED = ['CMP-004', 'CMP-005'] as const;
const M03_EXPECTED = ['CMP-001', 'CMP-033', 'CMP-034', 'CMP-051', 'CMP-052', 'CMP-053'] as const;

const M04_PROBE_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; url: string }> = [
  { method: 'GET', url: '/v1/ai/models/capabilities' },
  { method: 'GET', url: `/v1/evaluations/${DOC}` },
  { method: 'GET', url: `/v1/evidence-policies/${DOC}` },
  { method: 'GET', url: `/v1/upload-policies/${DOC}` },
  { method: 'GET', url: `/v1/executions/${DOC}` },
  { method: 'GET', url: `/v1/intelligence-jobs/${DOC}` },
];

function sandboxStorage() {
  return {
    mode: 'SANDBOX' as const,
    connectorBindingId: BINDING,
    issueUploadTarget: async () => ({
      method: 'PUT' as const,
      url: 'https://objects.example.test/u',
      expires_at: '2099-01-01T00:00:00.000Z',
      required_headers: {},
    }),
    inspectObject: async () => null,
    releaseFromQuarantine: async () => {},
    discard: async () => {},
    issueDownloadAccess: async () => ({
      method: 'GET' as const,
      url: 'https://objects.example.test/d',
      expires_at: '2099-01-01T00:00:00.000Z',
    }),
  };
}

function sandboxScanner() {
  return {
    mode: 'SANDBOX' as const,
    connectorBindingId: BINDING,
    scan: async () => ({ verdict: 'CLEAN' as const, engine_ref: 'host-test' }),
  };
}

function sandboxOcr() {
  return {
    mode: 'SANDBOX' as const,
    connectorBindingId: BINDING,
    recognize: async () => ({ scenario: 'none', text: '', confidence: 0, pageCount: 0 }),
  };
}

function gatewayPort() {
  return {
    invoke: async () => ({ ok: false as const, kind: 'DENIED' as const, reason_code: 'HOST_TEST' }),
  };
}

function m04Mounts(): M04PluginMounts {
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  return {
    aiGateway: {
      pool: {} as never,
      resolveContext,
      authorizer,
      providers: new Map(),
    },
    rules: {
      pool: {} as never,
      resolveContext,
      authorizer,
    },
    evidence: {
      pool: {} as never,
      resolveContext,
      authorizer,
      bindingPins: { resolveEvidencePin: async () => null },
    },
    documentUpload: {
      environment: 'CI',
      repository: {} as never,
      resolveContext,
      authorizer,
      storage: sandboxStorage(),
      scanner: sandboxScanner(),
      workerActorId: CTX.actor.id,
    },
    forms: {
      pool: {} as never,
      resolveContext,
      authorizer,
    },
    documentIntelligence: {
      environment: 'CI',
      repository: {} as never,
      resolveContext,
      authorizer,
      sources: { resolve: async () => null },
      sourceAcl: { canRead: async () => false },
      ocr: sandboxOcr(),
      gateway: gatewayPort(),
    },
  };
}

function m02Mounts() {
  return {
    identityAccess: {
      commands: {},
      verifier: { verify: async () => null },
      resolveContext: { resolve: async () => null },
      cellId: 'cell-local',
      rateLimitMax: 10_000,
    },
    citizenProfile: {
      pool: {} as never,
      resolveContext: async () => CTX,
      authorizer: { decide: async () => DENY },
      consentAccess: { check: async () => ({ allowed: true, reason_code: 'OK' }) },
      subjectDirectory: { exists: async () => true },
      deploymentEnvironment: 'CI' as const,
      digiLockerBinding: {
        connector_binding_id: BINDING,
        tenant_id: T1,
        connector_type: 'DIGILOCKER' as const,
        mode: 'SIMULATED' as const,
        environment: 'CI' as const,
        critical: true,
        secret_ref: null,
        simulator_version: 'sim-1',
      },
      rateLimitMax: 10_000,
    },
  };
}

function m03Mounts() {
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  return {
    catalogue: { pool: {} as never, resolveContext, authorizer },
    metadata: { pool: {} as never, resolveContext, authorizer },
    masterData: { pool: {} as never, resolveContext, authorizer },
    makerChecker: { pool: {} as never, resolveContext, authorizer },
    versioning: { pool: {} as never, resolveContext, authorizer },
    localization: {
      pool: {} as never,
      resolveContext,
      authorizer,
      deploymentEnvironment: 'CI' as const,
    },
  };
}

function wave1Mounts() {
  return {
    tenantOrganisation: {
      pool: {} as never,
      resolveContext: async () => CTX,
      authorizer: { decide: async () => DENY },
    },
  };
}

function wave2Mounts() {
  return {
    jurisdiction: {
      pool: {} as never,
      resolveContext: async () => CTX,
      authorizer: { decide: async () => DENY },
    },
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

async function collectMountedRouteKeys(mounts: M04PluginMounts): Promise<string[]> {
  const probe = Fastify({ logger: false });
  const keys: string[] = [];
  probe.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD') continue;
      keys.push(`${method} ${route.url}`);
    }
  });
  await registerM04Plugins(probe, mounts);
  await probe.ready();
  await probe.close();
  return keys;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host M04 mounts (REQ: host-mount-m04, INT-011, PLAN-REVIEW-single-writer-apps-api)', () => {
  it('starts without m04 deps and leaves Wave1/2/M02/M03 decoration unchanged', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect((app as FastifyInstance & { m04Mounted?: string[] }).m04Mounted).toBeUndefined();
    expect(app.wave1Mounted).toEqual([]);
    expect(app.wave2Mounted).toEqual([]);
    expect(app.m02Mounted).toEqual([]);
    expect(app.m03Mounted).toBeUndefined();

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    const meta = await app.inject({ method: 'GET', url: '/v1/meta' });
    expect(meta.statusCode).toBe(200);
  });

  it('mounts each M04 component independently', async () => {
    const full = m04Mounts();
    const singles: Array<[keyof M04PluginMounts, (typeof M04_EXPECTED)[number]]> = [
      ['aiGateway', 'CMP-039'],
      ['rules', 'CMP-008'],
      ['evidence', 'CMP-011'],
      ['documentUpload', 'CMP-013'],
      ['forms', 'CMP-009'],
      ['documentIntelligence', 'CMP-014'],
    ];
    for (const [key, cmp] of singles) {
      await app?.close();
      app = await buildApp(config, {
        logger: silentLogger(),
        m04: { [key]: full[key] },
      });
      expect(app.m04Mounted).toEqual([cmp]);
      expect(app.m04Mounted).not.toContain('CMP-036');
    }
  });

  it('mounts all six together with a deterministic CMP list (CMP-036 excluded)', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    expect(app.m04Mounted).toEqual([...M04_EXPECTED]);
    expect(app.m04Mounted).not.toContain('CMP-036');
  });

  it('registers CMP-036 exactly once and does not remount it from M04 composition', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    const plugins = app.printPlugins();
    expect(countPluginName(plugins, 'cmp-036-api-gateway')).toBe(1);

    const appSrc = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/app.ts', import.meta.url), 'utf8'),
    );
    expect(appSrc.match(/register\(apiGatewayPlugin/g)?.length).toBe(1);
    expect(appSrc).toContain("from '@serviceform/cmp-036-api-gateway'");

    const m04Src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/composition/m04.ts', import.meta.url), 'utf8'),
    );
    expect(m04Src).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
  });

  it('keeps M01/M02/M03 mount lists unchanged when M04 is registered', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      wave1: wave1Mounts(),
      wave2: wave2Mounts(),
      m02: m02Mounts(),
      m03: m03Mounts(),
      m04: m04Mounts(),
    });
    expect(app.wave1Mounted).toEqual(['CMP-002']);
    expect(app.wave2Mounted).toEqual(['CMP-003']);
    expect(app.m02Mounted).toEqual([...M02_EXPECTED]);
    expect(app.m03Mounted).toEqual([...M03_EXPECTED]);
    expect(app.m04Mounted).toEqual([...M04_EXPECTED]);
  });

  it('exposes M04 routes under /v1 and rejects forged tenant headers', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    for (const probe of M04_PROBE_ROUTES) {
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

  it('fails when duplicate or unexpected M04 routes collide', async () => {
    const keys = await collectMountedRouteKeys(m04Mounts());
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const [key, n] of counts) {
      expect(n, key).toBe(1);
    }
    expect(keys.some((k) => k.includes(' /v1/'))).toBe(true);
    expect(keys.some((k) => k.includes(' /v1/ai/'))).toBe(true);
    expect(keys.some((k) => k.includes(' /v1/evaluations'))).toBe(true);
    expect(keys.some((k) => k.includes(' /v1/evidence-policies'))).toBe(true);
    expect(keys.some((k) => k.includes(' /v1/upload-policies'))).toBe(true);
    expect(keys.some((k) => k.includes(' /v1/executions'))).toBe(true);
    expect(keys.some((k) => k.includes(' /v1/intelligence-jobs'))).toBe(true);
    expect(keys.some((k) => k.includes(' /v1/tenants'))).toBe(false);
    expect(keys.some((k) => k.includes(' /v1/categories'))).toBe(false);
    expect(keys.some((k) => k.includes(' /v1/identity'))).toBe(false);

    app = await buildApp(config, {
      logger: silentLogger(),
      wave1: wave1Mounts(),
      wave2: wave2Mounts(),
      m02: m02Mounts(),
      m03: m03Mounts(),
      m04: m04Mounts(),
    });
    const printed = app.printRoutes({ commonPrefix: false });
    expect(printed).toContain('/v1/tenants');
    expect(printed).toContain('/v1/jurisdiction-types');
    expect(printed).toContain('/v1/identity');
    expect(printed).toContain('/v1/categories');
    expect(printed).toContain('/v1/ai/');
    expect(app.hasRoute({ method: 'GET', url: '/v1/tenants/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/v1/ai/models/capabilities' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/v1/evaluations' })).toBe(true);
  });

  it('does not trust a raw tenant header as host context and never echoes the canary', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/ai/models/capabilities',
      headers: { 'x-tenant-id': CANARY, 'x-tenant': CANARY },
    });
    expect(denied.statusCode).toBe(403);
    expect(validate('error-response', denied.json()).valid).toBe(true);
    expect(denied.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(denied.body).not.toContain(CANARY);

    const noHeader = await app.inject({ method: 'GET', url: `/v1/evaluations/${DOC}` });
    expect(noHeader.statusCode).toBe(403);
    expect(validate('error-response', noHeader.json()).valid).toBe(true);
    expect(noHeader.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(noHeader.body).not.toContain(CANARY);
  });

  it('has no cross-component SQL and CMP-014 uses a gateway port (no direct provider)', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/composition/m04.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(src).toContain('gateway:');
    expect(src).toMatch(/AiGatewayPort/);
    expect(src).not.toMatch(/openai|anthropic|bedrock|vertexai|@ai-sdk|openai-node/i);
    expect(src).not.toMatch(/registerApiGateway|apiGatewayPlugin/);
    expect(src).not.toMatch(/from ['"]@serviceform\/cmp-014/);
    const mounts = m04Mounts();
    expect(typeof mounts.documentIntelligence?.gateway.invoke).toBe('function');
    expect(JSON.stringify(mounts.documentIntelligence?.gateway)).not.toMatch(
      /openai|anthropic|bedrock/i,
    );
  });
});

describe('registerM04Plugins isolation (REQ: INT-011 CROSS_TENANT_LEAKAGE=0)', () => {
  it('loads plugins without importing sibling service TypeScript into the host graph', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/composition/m04.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('import(specifier)');
    expect(src).not.toMatch(/from '@serviceform\/cmp-039/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-008/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-011/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-013/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-009/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-014/);
    expect(src).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/services\//);
    expect(typeof registerM04Plugins).toBe('function');
  });
});
