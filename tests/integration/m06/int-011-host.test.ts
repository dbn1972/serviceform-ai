import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import type { M06PluginMounts } from '../../../apps/api/src/composition/m06.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m06-int',
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

const M06_EXPECTED = ['CMP-020', 'CMP-021', 'CMP-025', 'CMP-026'] as const;

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm06-int', version: 'test', level: 'silent', destination });
}

function m06Mounts(): M06PluginMounts {
  const resolveContext = async () => CTX;
  return {
    fee: {
      service: {
        quote: async () => ({ status: 201, body: { id: DOC } }),
        get: async () => ({ status: 200, body: { id: DOC } }),
        listForApplication: async () => ({ status: 200, body: { items: [] } }),
      },
      resolveContext,
    },
    payment: {
      service: {
        createIntent: async () => ({ status: 201, body: { id: DOC, mode: 'SIMULATED' } }),
        getIntent: async () => ({ status: 200, body: { id: DOC, mode: 'SIMULATED' } }),
        applyCallback: async () => ({ status: 200, body: { ok: true } }),
      },
      resolveContext,
    },
    notification: {
      service: {
        dispatch: async () => ({ status: 201, body: { id: DOC, mode: 'SIMULATED' } }),
        get: async () => ({ status: 200, body: { id: DOC } }),
        recordReceipt: async () => ({ status: 200, body: { ok: true } }),
        publishTemplate: async () => ({ status: 201, body: { ok: true } }),
        listTemplateVersions: async () => ({ status: 200, body: { items: [] } }),
      },
      resolveContext,
    },
    messaging: {
      service: {
        openThread: async () => ({ status: 201, body: { id: DOC }, replayed: false }),
        listThreadsForApplication: async () => ({ status: 200, body: { items: [] } }),
        getThread: async () => ({ status: 200, body: { id: DOC } }),
        listTransitions: async () => ({ status: 200, body: { items: [] } }),
        executeCommand: async () => ({ status: 200, body: { ok: true } }),
        addParticipant: async () => ({ status: 200, body: { ok: true } }),
        removeParticipant: async () => ({ status: 200, body: { ok: true } }),
        sendMessage: async () => ({ status: 201, body: { ok: true } }),
        listMessages: async () => ({ status: 200, body: { items: [] } }),
        retractMessage: async () => ({ status: 200, body: { ok: true } }),
        acknowledgeNotice: async () => ({ status: 200, body: { ok: true } }),
        markRead: async () => ({ status: 200, body: { ok: true } }),
        getAttachmentAccess: async () => ({ status: 200, body: { url: 'https://example.test/a' } }),
      },
      resolveContext,
    },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('INT-011 M06 host admission + forged tenant denial', () => {
  it('admits four M06 mounts; CMP-036 once; forged X-Tenant-ID denied without canary leak', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts() });
    expect(app.m06Mounted).toEqual([...M06_EXPECTED]);
    expect(app.printPlugins().split('cmp-036-api-gateway').length - 1).toBe(1);

    for (const url of [
      `/v1/fee-quotes/${DOC}`,
      `/v1/payment-intents/${DOC}`,
      `/v1/notifications/${DOC}`,
      `/v1/threads/${DOC}`,
    ]) {
      const forged = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-tenant-id': CANARY },
      });
      expect(forged.statusCode).toBe(403);
      expect(validate('error-response', forged.json()).valid).toBe(true);
      expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
      expect(forged.body).not.toContain(CANARY);
    }
  });

  it('serves payment intent with server-derived context (SIMULATED mode marker)', async () => {
    app = await buildApp(config, { logger: silentLogger(), m06: m06Mounts() });
    const res = await app.inject({ method: 'GET', url: `/v1/payment-intents/${DOC}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: DOC, mode: 'SIMULATED' });
    expect(res.body).not.toContain(CANARY);
  });
});
