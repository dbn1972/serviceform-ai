import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { registerM05Plugins, type M05PluginMounts } from '../src/composition/m05.js';

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
const IDEM = 'idem-host-m05-000000000000000000000001';

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

const M05_EXPECTED = [
  'CMP-015',
  'CMP-017',
  'CMP-018',
  'CMP-019',
  'CMP-027',
  'CMP-028',
  'CMP-029',
] as const;

const M04_EXPECTED = ['CMP-039', 'CMP-008', 'CMP-011', 'CMP-013', 'CMP-009', 'CMP-014'] as const;
const M02_EXPECTED = ['CMP-004', 'CMP-005'] as const;
const M03_EXPECTED = ['CMP-001', 'CMP-033', 'CMP-034', 'CMP-051', 'CMP-052', 'CMP-053'] as const;

const M05_PROBE_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; url: string }> = [
  { method: 'GET', url: `/v1/applications/${DOC}` },
  { method: 'GET', url: '/v1/tasks/available' },
  { method: 'GET', url: `/v1/inspections/${DOC}` },
  { method: 'GET', url: `/v1/deficiencies/${DOC}` },
  { method: 'GET', url: `/v1/grievances/${DOC}` },
  { method: 'GET', url: `/v1/appeals/${DOC}` },
  { method: 'GET', url: `/v1/sla-clocks/${DOC}` },
];

function stubService(echo?: unknown) {
  // Handler shapes differ: some service methods return ServiceResult `{status,body}`,
  // others return the response body and the handler wraps status.
  const result = (status: number, body: unknown) => ({ status, body });
  return {
    createTask: async (_ctx: unknown, body: unknown) =>
      result(201, { ok: true, received: body, echo }),
    listAvailable: async () => ({ items: [], echo }),
    getTask: async () => ({ id: DOC, echo }),
    getHistory: async () => ({ items: [], echo }),
    claimTask: async () => result(200, { ok: true, echo }),
    unclaimTask: async () => result(200, { ok: true, echo }),
    reassignTask: async () => result(200, { ok: true, echo }),
    completeTask: async () => result(200, { ok: true, echo }),
    cancelCloseTask: async () => result(200, { ok: true, echo }),
    createInspection: async (_ctx: unknown, body: unknown) =>
      result(201, { ok: true, received: body, echo }),
    getInspection: async () => ({ id: DOC, echo }),
    getDetail: async () => ({ id: DOC, echo }),
    schedule: async () => result(200, { ok: true, echo }),
    reassign: async () => result(200, { ok: true, echo }),
    start: async () => result(200, { ok: true, echo }),
    recordChecklist: async () => result(200, { ok: true, echo }),
    recordObservation: async () => result(200, { ok: true, echo }),
    attachEvidence: async () => result(200, { ok: true, echo }),
    recordFinding: async () => result(200, { ok: true, echo }),
    recordResult: async () => result(200, { ok: true, echo }),
    complete: async () => result(200, { ok: true, echo }),
    cancel: async () => result(200, { ok: true, echo }),
    reinspect: async () => result(200, { ok: true, echo }),
    fileAppeal: async (_ctx: unknown, body: unknown) =>
      result(201, { ok: true, received: body, echo }),
    getAppeal: async () => ({ id: DOC, echo }),
    recordAdmissibility: async () => result(200, { ok: true, echo }),
    assign: async () => result(200, { ok: true, echo }),
    recordReview: async () => result(200, { ok: true, echo }),
    recordHearing: async () => result(200, { ok: true, echo }),
    recordDecision: async () => result(200, { ok: true, echo }),
    withdrawOrCancel: async () => result(200, { ok: true, echo }),
    linkWorkflow: async () => result(200, { ok: true, echo }),
    addAssistNote: async () => result(200, { ok: true, echo }),
    // CMP-015 / CMP-027 route services return ServiceResult + replayed
    createDraft: async () => ({ status: 201, body: { ok: true, echo }, replayed: false }),
    getApplication: async () => ({ status: 200, body: { id: DOC, echo }, replayed: false }),
    listTransitions: async () => ({ status: 200, body: { items: [] }, replayed: false }),
    executeCommand: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    registerRequest: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    updateRequestStatus: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    file: async () => ({ status: 201, body: { ok: true, echo }, replayed: false }),
    get: async () => ({ status: 200, body: { id: DOC, echo }, replayed: false }),
    listResponses: async () => ({ status: 200, body: { items: [] }, replayed: false }),
    recordAiAssist: async () => ({ status: 200, body: { ok: true }, replayed: false }),
  };
}

function stubDeficiencyRepo() {
  return {
    get: async () => null,
    listForApplication: async () => [],
    open: async () => ({ status: 201, body: { ok: true } }),
    withTx: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };
}

function stubSlaRepo() {
  return {
    getClock: async () => null,
    getHistory: async () => [],
    clocksForApplication: async () => [],
    withTx: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };
}

function m05Mounts(): M05PluginMounts {
  const resolveContext = async () => CTX;
  const authorizer = { decide: async () => DENY };
  const service = stubService('m05');
  return {
    applicationCase: { service, resolveContext },
    tasks: { service, resolveContext },
    inspection: { service, resolveContext },
    deficiency: {
      repository: stubDeficiencyRepo(),
      resolveContext,
      authorizer,
    },
    grievance: { service, resolveContext },
    appeal: { service, resolveContext },
    sla: {
      repository: stubSlaRepo(),
      resolveContext,
      authorizer,
    },
  };
}

function m04Mounts() {
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  return {
    aiGateway: {
      pool: {} as never,
      resolveContext,
      authorizer,
      providers: new Map(),
    },
    rules: { pool: {} as never, resolveContext, authorizer },
    evidence: {
      pool: {} as never,
      resolveContext,
      authorizer,
      bindingPins: { resolveEvidencePin: async () => null },
    },
    documentUpload: {
      environment: 'CI' as const,
      repository: {} as never,
      resolveContext,
      authorizer,
      storage: {
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
      },
      scanner: {
        mode: 'SANDBOX' as const,
        connectorBindingId: BINDING,
        scan: async () => ({ verdict: 'CLEAN' as const, engine_ref: 'host-test' }),
      },
      workerActorId: CTX.actor.id,
    },
    forms: { pool: {} as never, resolveContext, authorizer },
    documentIntelligence: {
      environment: 'CI' as const,
      repository: {} as never,
      resolveContext,
      authorizer,
      sources: { resolve: async () => null },
      sourceAcl: { canRead: async () => false },
      ocr: {
        mode: 'SANDBOX' as const,
        connectorBindingId: BINDING,
        recognize: async () => ({ scenario: 'none', text: '', confidence: 0, pageCount: 0 }),
      },
      gateway: {
        invoke: async () => ({
          ok: false as const,
          kind: 'DENIED' as const,
          reason_code: 'HOST_TEST',
        }),
      },
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

async function loadCmpModule<T>(pkg: string, fileUrl: string): Promise<T> {
  try {
    return (await import(pkg)) as T;
  } catch {
    return (await import(fileUrl)) as T;
  }
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CMP-036 host M05 mounts (REQ: host-mount-m05, INT-011, PLAN-REVIEW-single-writer-apps-api)', () => {
  it('starts without m05 deps and leaves Wave1/2/M02/M03/M04 decoration unchanged', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect((app as FastifyInstance & { m05Mounted?: string[] }).m05Mounted).toBeUndefined();
    expect(app.wave1Mounted).toEqual([]);
    expect(app.wave2Mounted).toEqual([]);
    expect(app.m02Mounted).toEqual([]);
    expect(app.m03Mounted).toBeUndefined();
    expect(app.m04Mounted).toBeUndefined();

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    const meta = await app.inject({ method: 'GET', url: '/v1/meta' });
    expect(meta.statusCode).toBe(200);
  });

  it('mounts each M05 HTTP component independently (CMP-016 excluded)', async () => {
    const full = m05Mounts();
    const singles: Array<[keyof M05PluginMounts, (typeof M05_EXPECTED)[number]]> = [
      ['applicationCase', 'CMP-015'],
      ['tasks', 'CMP-017'],
      ['inspection', 'CMP-018'],
      ['deficiency', 'CMP-019'],
      ['grievance', 'CMP-027'],
      ['appeal', 'CMP-028'],
      ['sla', 'CMP-029'],
    ];
    for (const [key, cmp] of singles) {
      await app?.close();
      app = await buildApp(config, {
        logger: silentLogger(),
        m05: { [key]: full[key] },
      });
      expect(app.m05Mounted).toEqual([cmp]);
      expect(app.m05Mounted).not.toContain('CMP-016');
      expect(app.m05Mounted).not.toContain('CMP-036');
    }
  });

  it('mounts all seven HTTP components with a deterministic CMP list (CMP-016/036 excluded)', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    expect(app.m05Mounted).toEqual([...M05_EXPECTED]);
    expect(app.m05Mounted).not.toContain('CMP-016');
    expect(app.m05Mounted).not.toContain('CMP-036');
  });

  it('registers CMP-036 exactly once and does not remount it from M05 composition', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const plugins = app.printPlugins();
    expect(countPluginName(plugins, 'cmp-036-api-gateway')).toBe(1);

    const appSrc = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(appSrc.match(/register\(apiGatewayPlugin/g)?.length).toBe(1);
    expect(appSrc).toContain("from '@serviceform/cmp-036-api-gateway'");

    const m05Src = await readFile(new URL('../src/composition/m05.ts', import.meta.url), 'utf8');
    expect(m05Src).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
  });

  it('does not invent a CMP-016 host HTTP API', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const m05Src = await readFile(new URL('../src/composition/m05.ts', import.meta.url), 'utf8');
    expect(m05Src).toMatch(/CMP-016/);
    expect(m05Src).toMatch(/Do not invent a host HTTP API for CMP-016/);
    expect(m05Src).not.toMatch(/registerWorkflow|createWorkflowHandler|cmp-016-workflow-engine/);
    expect(app.m05Mounted).not.toContain('CMP-016');

    const printed = app.printRoutes({ commonPrefix: false });
    expect(printed).not.toMatch(/\/v1\/workflows?(\/|$|\s)/);
    expect(app.hasRoute({ method: 'GET', url: '/v1/workflows' })).toBe(false);
    expect(app.hasRoute({ method: 'POST', url: '/v1/workflows' })).toBe(false);
  });

  it('keeps Wave1/2/M02/M03/M04 mount lists unchanged when M05 is registered', async () => {
    app = await buildApp(config, {
      logger: silentLogger(),
      wave1: wave1Mounts(),
      wave2: wave2Mounts(),
      m02: m02Mounts(),
      m03: m03Mounts(),
      m04: m04Mounts(),
      m05: m05Mounts(),
    });
    expect(app.wave1Mounted).toEqual(['CMP-002']);
    expect(app.wave2Mounted).toEqual(['CMP-003']);
    expect(app.m02Mounted).toEqual([...M02_EXPECTED]);
    expect(app.m03Mounted).toEqual([...M03_EXPECTED]);
    expect(app.m04Mounted).toEqual([...M04_EXPECTED]);
    expect(app.m05Mounted).toEqual([...M05_EXPECTED]);
  });

  it('exposes M05 routes under /v1 and rejects forged tenant headers', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    for (const probe of M05_PROBE_ROUTES) {
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

  it('uses server-derived context authority; forged X-Tenant-ID is not authoritative', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/tasks/available',
      headers: { 'x-tenant-id': CANARY, 'x-tenant': CANARY },
    });
    expect(denied.statusCode).toBe(403);
    expect(validate('error-response', denied.json()).valid).toBe(true);
    expect(denied.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(denied.body).not.toContain(CANARY);

    const noHeader = await app.inject({ method: 'GET', url: `/v1/appeals/${DOC}` });
    // Mount resolveContext returns CTX; stub getAppeal succeeds — proves header was not required.
    expect(noHeader.statusCode).toBe(200);
    expect(noHeader.json()).toMatchObject({ id: DOC });
    expect(noHeader.body).not.toContain(CANARY);
  });

  it('preserves transport-neutral method/path/body/header/status/response semantics', async () => {
    const body = { marker: 'adapter-probe', application_id: DOC };
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': IDEM,
    };

    const tasksMod = await loadCmpModule<{
      createTaskHandler: (deps: {
        service: unknown;
        resolveContext: (req: {
          method: string;
          path: string;
          headers: Record<string, string>;
          body?: unknown;
        }) => Promise<RequestContext | null>;
      }) => (req: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body?: unknown;
      }) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
    }>(
      '@serviceform/cmp-017-work-queue-tasks',
      new URL('../../../services/cmp-017-work-queue-tasks/src/index.ts', import.meta.url).href,
    );
    const inspectionMod = await loadCmpModule<{
      createInspectionHandler: (deps: {
        service: unknown;
        resolveContext: (req: unknown) => Promise<RequestContext | null>;
      }) => (req: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body?: unknown;
      }) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
    }>(
      '@serviceform/cmp-018-inspection-verification',
      new URL('../../../services/cmp-018-inspection-verification/src/index.ts', import.meta.url)
        .href,
    );
    const appealMod = await loadCmpModule<{
      createAppealHandler: (deps: {
        service: unknown;
        resolveContext: (req: unknown) => Promise<RequestContext | null>;
      }) => (req: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body?: unknown;
      }) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
    }>(
      '@serviceform/cmp-028-appeal-review',
      new URL('../../../services/cmp-028-appeal-review/src/index.ts', import.meta.url).href,
    );
    const deficiencyMod = await loadCmpModule<{
      createDeficiencyApi: (opts: {
        service: unknown;
        resolveContext: (headers: unknown) => Promise<RequestContext | null>;
      }) => {
        handle: (req: {
          method: string;
          path: string;
          headers: Record<string, string>;
          body?: unknown;
        }) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
      };
    }>(
      '@serviceform/cmp-019-deficiency',
      new URL('../../../services/cmp-019-deficiency/src/index.ts', import.meta.url).href,
    );
    const slaMod = await loadCmpModule<{
      createSlaApi: (opts: {
        service: unknown;
        resolveContext: (headers: unknown) => Promise<RequestContext | null>;
      }) => {
        handle: (req: {
          method: string;
          path: string;
          headers: Record<string, string>;
          body?: unknown;
        }) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
      };
    }>(
      '@serviceform/cmp-029-sla-escalation',
      new URL('../../../services/cmp-029-sla-escalation/src/index.ts', import.meta.url).href,
    );

    const seen: Array<{ method: string; path: string; body: unknown; hasIdem: boolean }> = [];
    const service = {
      createTask: async (_ctx: unknown, b: unknown, idem: { key: string }) => {
        seen.push({ method: 'POST', path: '/v1/tasks', body: b, hasIdem: Boolean(idem.key) });
        return { status: 201, body: { ok: true, received: b } };
      },
      createInspection: async (_ctx: unknown, b: unknown, idem: { key: string }) => {
        seen.push({
          method: 'POST',
          path: '/v1/inspections',
          body: b,
          hasIdem: Boolean(idem.key),
        });
        return { status: 201, body: { ok: true, received: b } };
      },
      fileAppeal: async (_ctx: unknown, b: unknown, idem: { key: string }) => {
        seen.push({ method: 'POST', path: '/v1/appeals', body: b, hasIdem: Boolean(idem.key) });
        return { status: 201, body: { ok: true, received: b } };
      },
    };

    const taskHandle = tasksMod.createTaskHandler({
      service,
      resolveContext: async () => CTX,
    });
    const inspectionHandle = inspectionMod.createInspectionHandler({
      service,
      resolveContext: async () => CTX,
    });
    const appealHandle = appealMod.createAppealHandler({
      service,
      resolveContext: async () => CTX,
    });

    // Deficiency/SLA: auth-null path compares host inject vs direct handle (no invented semantics).
    const deficiencyApi = deficiencyMod.createDeficiencyApi({
      service: {
        get: async () => ({ status: 200, body: { id: DOC } }),
        open: async () => ({ status: 201, body: { ok: true } }),
        respond: async () => ({ status: 200, body: { ok: true } }),
        close: async () => ({ status: 200, body: { ok: true } }),
        listForApplication: async () => ({ status: 200, body: { items: [] } }),
      },
      resolveContext: async () => null,
    });
    const slaApi = slaMod.createSlaApi({
      service: {
        getClock: async () => ({ status: 200, body: { id: DOC } }),
        getHistory: async () => ({ status: 200, body: { items: [] } }),
        createCalendar: async () => ({ status: 201, body: { ok: true } }),
        createPolicy: async () => ({ status: 201, body: { ok: true } }),
        retirePolicy: async () => ({ status: 200, body: { ok: true } }),
        start: async () => ({ status: 201, body: { ok: true } }),
        pause: async () => ({ status: 200, body: { ok: true } }),
        resume: async () => ({ status: 200, body: { ok: true } }),
        complete: async () => ({ status: 200, body: { ok: true } }),
        evaluate: async () => ({ status: 200, body: { ok: true } }),
        clocksForApplication: async () => ({ status: 200, body: { items: [] } }),
      },
      resolveContext: async () => null,
    });

    app = await buildApp(config, {
      logger: silentLogger(),
      m05: {
        tasks: { service, resolveContext: async () => CTX },
        inspection: { service, resolveContext: async () => CTX },
        appeal: { service, resolveContext: async () => CTX },
        deficiency: {
          repository: stubDeficiencyRepo(),
          resolveContext: async () => null,
          authorizer: { decide: async () => DENY },
        },
        sla: {
          repository: stubSlaRepo(),
          resolveContext: async () => null,
          authorizer: { decide: async () => DENY },
        },
      },
    });
    const host = app;

    const cases: Array<{
      name: string;
      method: 'GET' | 'POST';
      url: string;
      payload?: Record<string, unknown>;
      direct: () => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
    }> = [
      {
        name: 'CMP-017',
        method: 'POST',
        url: '/v1/tasks',
        payload: body,
        direct: () => taskHandle({ method: 'POST', path: '/v1/tasks', headers, body }),
      },
      {
        name: 'CMP-018',
        method: 'POST',
        url: '/v1/inspections',
        payload: body,
        direct: () => inspectionHandle({ method: 'POST', path: '/v1/inspections', headers, body }),
      },
      {
        name: 'CMP-028',
        method: 'POST',
        url: '/v1/appeals',
        payload: body,
        direct: () => appealHandle({ method: 'POST', path: '/v1/appeals', headers, body }),
      },
      {
        name: 'CMP-019',
        method: 'GET',
        url: `/v1/deficiencies/${DOC}`,
        direct: () =>
          deficiencyApi.handle({
            method: 'GET',
            path: `/v1/deficiencies/${DOC}`,
            headers: { 'content-type': 'application/json' },
          }),
      },
      {
        name: 'CMP-029',
        method: 'GET',
        url: `/v1/sla-clocks/${DOC}`,
        direct: () =>
          slaApi.handle({
            method: 'GET',
            path: `/v1/sla-clocks/${DOC}`,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ];

    for (const c of cases) {
      const direct = await c.direct();
      const injected = await host.inject(
        c.payload === undefined
          ? { method: c.method, url: c.url, headers }
          : { method: c.method, url: c.url, headers, payload: c.payload },
      );
      expect(injected.statusCode, c.name).toBe(direct.status);
      const stripCorr = (value: unknown): unknown => {
        if (!value || typeof value !== 'object') return value;
        const { correlation_id: _c, ...rest } = value as Record<string, unknown>;
        return rest;
      };
      // correlation_id is generated per call when context is null; compare semantic body.
      expect(stripCorr(injected.json()), c.name).toEqual(stripCorr(direct.body));
      for (const [name, value] of Object.entries(direct.headers)) {
        const got = String(injected.headers[name.toLowerCase()] ?? '');
        // Fastify may append `; charset=utf-8` to content-type; require prefix match.
        expect(got === value || got.startsWith(`${value};`), c.name).toBe(true);
      }
    }

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((s) => s.hasIdem && s.body && typeof s.body === 'object')).toBe(true);
  });

  it('has no cross-component SQL and couples only via public entry points', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const src = await readFile(new URL('../src/composition/m05.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(src).toContain('import(specifier)');
    expect(src).not.toMatch(/from '@serviceform\/cmp-015/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-017/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-018/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-019/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-027/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-028/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-029/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-016/);
    expect(src).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/services\//);
    expect(src).toContain('registerApplicationCaseRoutes');
    expect(src).toContain('createTaskHandler');
    expect(src).toContain('createInspectionHandler');
    expect(src).toContain('buildDeficiencyApi');
    expect(src).toContain('registerGrievanceRoutes');
    expect(src).toContain('createAppealHandler');
    expect(src).toContain('buildSlaApi');
  });

  it('records CMP-019 and CMP-028 residuals as carried unwaived in composition source', async () => {
    const src = await readFile(new URL('../src/composition/m05.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/GOVERNING_UNRESOLVED_UNWAIVED/);
    expect(src).toMatch(/CMP-019/);
    expect(src).toMatch(/CMP-028/);
    expect(src).toMatch(/do not redesign CMP-015 boundary/i);
  });
});

describe('registerM05Plugins isolation (REQ: INT-011 CROSS_TENANT_LEAKAGE=0)', () => {
  it('loads plugins without importing sibling service TypeScript into the host graph', async () => {
    const src = await readFile(new URL('../src/composition/m05.ts', import.meta.url), 'utf8');
    expect(src).toContain('import(specifier)');
    expect(src).not.toMatch(/from '@serviceform\/cmp-015/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-017/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-018/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-019/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-027/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-028/);
    expect(src).not.toMatch(/from '@serviceform\/cmp-029/);
    expect(src).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/services\//);
    expect(typeof registerM05Plugins).toBe('function');

    const probe = Fastify({ logger: false });
    const mounted = await registerM05Plugins(probe, m05Mounts());
    expect(mounted).toEqual([...M05_EXPECTED]);
    await probe.close();
  });
});
