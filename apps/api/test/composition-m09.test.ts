import { Writable } from 'node:stream';
import type { RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { M09PluginMounts } from '../src/composition/m09.js';

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

const M09_EXPECTED = ['CMP-056', 'CMP-057', 'CMP-058', 'CMP-059', 'CMP-060', 'CMP-061'] as const;

const echo = (name: string) => async () => ({ status: 200, body: { id: DOC, echo: name } });
const unreached = async () => {
  throw new Error('command must not be reached without required auth/idempotency');
};

function stubSchedulerService() {
  return {
    getAppointment: echo('scheduler'),
    listSlots: echo('scheduler'),
    book: unreached,
    registerType: unreached,
    publishSlot: unreached,
    reschedule: unreached,
    cancel: unreached,
    complete: unreached,
    noShow: unreached,
  };
}

function stubAssistedService() {
  return {
    readSession: echo('assisted'),
    start: unreached,
    bindApplicant: unreached,
    verifyRepresentation: unreached,
    submit: unreached,
    handoff: unreached,
    resume: unreached,
    close: unreached,
  };
}

function stubPrivacyService() {
  return {
    getMe: echo('privacy'),
    getConsents: echo('privacy'),
    getRequest: echo('privacy'),
    submitRequest: unreached,
    requestOwnerTasks: unreached,
    withdrawRequest: unreached,
    denyRequest: unreached,
    completeRequest: unreached,
    recordTaskOutcome: unreached,
  };
}

function m09Mounts(
  resolveContext: () => Promise<RequestContext | null> = async () => CTX,
): M09PluginMounts {
  return {
    scheduler: { service: stubSchedulerService(), resolveContext },
    assisted: { service: stubAssistedService(), resolveContext },
    semantic: {
      options: {
        pool: {
          query: async () => ({ rows: [], rowCount: 0 }),
          connect: async () => ({
            query: async () => ({ rows: [], rowCount: 0 }),
            release: () => undefined,
          }),
          end: async () => undefined,
          on: () => undefined,
        },
        authorizer: { decide: async () => ({ allow: false }) },
      },
      resolveContext,
    },
    migration: {
      options: {
        pool: {
          query: async () => ({ rows: [], rowCount: 0 }),
          connect: async () => ({
            query: async () => ({ rows: [], rowCount: 0 }),
            release: () => undefined,
          }),
          end: async () => undefined,
          on: () => undefined,
        },
        authorizer: { decide: async () => ({ allow: false }) },
      },
      resolveContext,
    },
    risk: {
      options: {
        pool: {
          query: async () => ({ rows: [], rowCount: 0 }),
          connect: async () => ({
            query: async () => ({ rows: [], rowCount: 0 }),
            release: () => undefined,
          }),
          end: async () => undefined,
          on: () => undefined,
        },
      },
      resolveContext,
    },
    privacy: { service: stubPrivacyService(), resolveContext },
  };
}

describe('SF-M09-HOST composition mounts', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('registers all six M09 component mounts when supplied', async () => {
    app = await buildApp(config, { logger: silentLogger(), m09: m09Mounts() });
    expect(app.m09Mounted).toEqual([...M09_EXPECTED]);
  });

  it('leaves m09Mounted undefined when mounts are omitted', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect(app.m09Mounted).toBeUndefined();
  });

  it('probes neutral GET routes for CMP-056/057/061', async () => {
    app = await buildApp(config, { logger: silentLogger(), m09: m09Mounts() });
    const probes = [
      { url: `/v1/appointments/${DOC}`, echo: 'scheduler' },
      { url: `/v1/assisted/sessions/${DOC}`, echo: 'assisted' },
      { url: '/v1/privacy/me', echo: 'privacy' },
    ] as const;
    for (const p of probes) {
      const res = await app.inject({ method: 'GET', url: p.url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ echo: p.echo });
    }
  });
});
