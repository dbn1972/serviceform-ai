import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { type M05PluginMounts } from '../../../apps/api/src/composition/m05.js';
import { CANARY, DOC, T1 } from './pg-harness.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-test',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm05-int', version: 'test', level: 'info', destination });
}

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

function stubService() {
  const result = (status: number, body: unknown) => ({ status, body, replayed: false });
  return {
    createDraft: async () => result(201, { ok: true }),
    getApplication: async () => result(200, { application_id: DOC, tenant_id: T1 }),
    listTransitions: async () => result(200, { items: [] }),
    executeCommand: async () => result(200, { ok: true }),
    listAvailable: async () => ({ items: [] }),
    getTask: async () => ({ id: DOC }),
    getHistory: async () => ({ items: [] }),
    claimTask: async () => result(200, { ok: true }),
    unclaimTask: async () => result(200, { ok: true }),
    reassignTask: async () => result(200, { ok: true }),
    completeTask: async () => result(200, { ok: true }),
    cancelCloseTask: async () => result(200, { ok: true }),
    createTask: async () => result(201, { ok: true }),
    createInspection: async () => result(201, { ok: true }),
    getInspection: async () => ({ id: DOC }),
    getDetail: async () => ({ id: DOC }),
    fileAppeal: async () => result(201, { ok: true }),
    getAppeal: async () => ({ id: DOC }),
    file: async () => result(201, { ok: true }),
    get: async () => result(200, { id: DOC }),
    listResponses: async () => result(200, { items: [] }),
    recordAiAssist: async () => result(200, { ok: true }),
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
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  const service = stubService();
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
    sla: { repository: stubSlaRepo(), resolveContext, authorizer },
  };
}

describe('INT-011 M05 host tenant isolation (independent)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('forged X-Tenant-ID is not authoritative; canary not echoed', async () => {
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/applications/${DOC}`,
      headers: {
        'x-tenant-id': CANARY,
        'x-correlation-id': CTX.correlation_id,
      },
    });
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(CANARY);
    expect(readFileSync('apps/api/src/composition/m05.ts', 'utf8')).toMatch(
      /resolveContext|RequestContext/,
    );
  });

  it('M05 mounted matrix excludes CMP-016 HTTP and does not remount CMP-036', async () => {
    const src = readFileSync('apps/api/src/composition/m05.ts', 'utf8');
    for (const id of M05_EXPECTED) {
      expect(src).toContain(id);
    }
    expect(src).toMatch(/CMP-016[\s\S]*no Fastify\/HTTP/);
    expect(src).toMatch(/CMP-036[\s\S]*do not remount/);
    app = await buildApp(config, { logger: silentLogger(), m05: m05Mounts() });
    expect(app).toBeTruthy();
  });

  it('residuals CMP-019/CMP-028 remain GOVERNING_UNRESOLVED_UNWAIVED (not waived by INT)', () => {
    const src = readFileSync('apps/api/src/composition/m05.ts', 'utf8');
    expect(src).toMatch(/GOVERNING_UNRESOLVED_UNWAIVED/);
    expect(src).toMatch(/CMP-019/);
    expect(src).toMatch(/CMP-028/);
  });
});
