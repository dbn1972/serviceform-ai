import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import type { M05PluginMounts } from '../../../apps/api/src/composition/m05.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-sec',
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

const DENY = {
  allow: false as const,
  reason_code: 'ROLE_DENIED',
  policy_revision: 'test-1',
  decision_id: '00000000-0000-4000-8000-0000000000bb',
};

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm05-sec', version: 'test', level: 'silent', destination });
}

function stubService() {
  const result = (status: number, body: unknown) => ({ status, body });
  return {
    createTask: async () => result(201, { ok: true }),
    listAvailable: async () => ({ items: [] }),
    getTask: async () => ({ id: DOC }),
    getHistory: async () => ({ items: [] }),
    claimTask: async () => result(200, { ok: true }),
    unclaimTask: async () => result(200, { ok: true }),
    reassignTask: async () => result(200, { ok: true }),
    completeTask: async () => result(200, { ok: true }),
    cancelCloseTask: async () => result(200, { ok: true }),
    createInspection: async () => result(201, { ok: true }),
    getInspection: async () => ({ id: DOC }),
    getDetail: async () => ({ id: DOC }),
    schedule: async () => result(200, { ok: true }),
    reassign: async () => result(200, { ok: true }),
    start: async () => result(200, { ok: true }),
    recordChecklist: async () => result(200, { ok: true }),
    recordObservation: async () => result(200, { ok: true }),
    attachEvidence: async () => result(200, { ok: true }),
    recordFinding: async () => result(200, { ok: true }),
    recordResult: async () => result(200, { ok: true }),
    complete: async () => result(200, { ok: true }),
    cancel: async () => result(200, { ok: true }),
    reinspect: async () => result(200, { ok: true }),
    fileAppeal: async () => result(201, { ok: true }),
    getAppeal: async () => ({ id: DOC }),
    recordAdmissibility: async () => result(200, { ok: true }),
    assign: async () => result(200, { ok: true }),
    recordReview: async () => result(200, { ok: true }),
    recordHearing: async () => result(200, { ok: true }),
    recordDecision: async () => result(200, { ok: true }),
    withdrawOrCancel: async () => result(200, { ok: true }),
    linkWorkflow: async () => result(200, { ok: true }),
    addAssistNote: async () => result(200, { ok: true }),
    createDraft: async () => ({ status: 201, body: { ok: true }, replayed: false }),
    getApplication: async () => ({ status: 200, body: { id: DOC }, replayed: false }),
    listTransitions: async () => ({ status: 200, body: { items: [] }, replayed: false }),
    executeCommand: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    registerRequest: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    updateRequestStatus: async () => ({ status: 200, body: { ok: true }, replayed: false }),
    file: async () => ({ status: 201, body: { ok: true }, replayed: false }),
    get: async () => ({ status: 200, body: { id: DOC }, replayed: false }),
    listResponses: async () => ({ status: 200, body: { items: [] }, replayed: false }),
    recordAiAssist: async () => ({ status: 200, body: { ok: true }, replayed: false }),
  };
}

function m05Mounts(): M05PluginMounts {
  const resolveContext = async () => CTX;
  const authorizer = { decide: async () => DENY };
  const service = stubService();
  return {
    applicationCase: { service, resolveContext },
    tasks: { service, resolveContext },
    inspection: { service, resolveContext },
    deficiency: {
      repository: {
        get: async () => null,
        listForApplication: async () => [],
        open: async () => ({ status: 201, body: { ok: true } }),
        withTx: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      },
      resolveContext,
      authorizer,
    },
    grievance: { service, resolveContext },
    appeal: { service, resolveContext },
    sla: {
      repository: {
        getClock: async () => null,
        getHistory: async () => [],
        clocksForApplication: async () => [],
        withTx: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      },
      resolveContext,
      authorizer,
    },
  };
}

async function expectTen002(app: FastifyInstance, method: 'GET' | 'POST', url: string) {
  const forged = await app.inject({
    method,
    url,
    headers: { authorization: 'Bearer officer-t1', 'x-tenant-id': CANARY },
  });
  expect(forged.statusCode).toBe(403);
  expect(validate('error-response', forged.json()).valid).toBe(true);
  expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
  expect(forged.body).not.toContain(CANARY);
  expect(JSON.stringify(forged.json())).not.toContain(CANARY);
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M05-SEC INT-011 forged-tenant HTTP (not CERTIFIED)', () => {
  it('rejects client-controlled tenant headers on all M05 HTTP mounts with zero leakage', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    expect(app.m05Mounted).toEqual(
      expect.arrayContaining([
        'CMP-015',
        'CMP-017',
        'CMP-018',
        'CMP-019',
        'CMP-027',
        'CMP-028',
        'CMP-029',
      ]),
    );
    expect(app.m05Mounted).not.toContain('CMP-016');
    expect(app.m05Mounted).not.toContain('CMP-036');

    await expectTen002(app, 'GET', `/v1/applications/${DOC}`);
    await expectTen002(app, 'GET', '/v1/tasks/available');
    await expectTen002(app, 'GET', `/v1/inspections/${DOC}`);
    await expectTen002(app, 'GET', `/v1/deficiencies/${DOC}`);
    await expectTen002(app, 'GET', `/v1/grievances/${DOC}`);
    await expectTen002(app, 'GET', `/v1/appeals/${DOC}`);
    await expectTen002(app, 'GET', `/v1/sla-clocks/${DOC}`);
  });

  it('rejects alternate tenant header spellings without echoing canary', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const hdrs = ['x-sf-tenant', 'x-tenant', 'sf-tenant-id', 'X-Tenant-ID'];
    for (const name of hdrs) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/applications/${DOC}`,
        headers: { authorization: 'Bearer officer-t1', [name]: CANARY },
      });
      expect(res.statusCode, name).toBe(403);
      expect(res.body, name).not.toContain(CANARY);
      expect((res.json() as { error_code: string }).error_code).toBe('SF-TEN-002');
    }
  });

  it('tenant_id in JSON body is not trusted as server tenant context', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: 'Bearer officer-t1',
        'content-type': 'application/json',
        'idempotency-key': 'sec-body-m05-1',
      },
      payload: {
        tenant_id: CANARY,
        application_id: DOC,
        role_code: 'SCRUTINY_OFFICER',
      },
    });
    // Body tenant_id must never become authoritative: canary absent from response.
    // Stub handlers may still 2xx after gateway accepts a request without forged headers.
    expect(res.body).not.toContain(CANARY);
    expect(JSON.stringify(res.json())).not.toContain(CANARY);
    // Forged header still fail-closed on the same mount.
    await expectTen002(app, 'GET', `/v1/applications/${DOC}`);
  });

  it('tenant query manipulation does not become trusted server context', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/applications/${DOC}?tenant_id=${CANARY}`,
      headers: { authorization: 'Bearer officer-t1' },
    });
    // Query tenant_id is not a client tenant header; must not echo canary as context.
    expect(res.body).not.toContain(CANARY);
    expect(JSON.stringify(res.json())).not.toContain(CANARY);
    // Header forgery remains the authoritative denial path.
    await expectTen002(app, 'GET', `/v1/applications/${DOC}`);
  });

  it('forged tenant is never authoritative even when resolveContext would return T1', async () => {
    // Host gateway refuses client tenant headers before component resolveContext runs.
    app = await buildApp(config, {
      logger: silentLogger(),
      m05: {
        ...m05Mounts(),
        applicationCase: {
          service: stubService(),
          resolveContext: async () => CTX,
        },
      },
    });
    await expectTen002(app, 'GET', `/v1/applications/${DOC}`);
  });
});
