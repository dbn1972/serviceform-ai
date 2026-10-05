import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-sec',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

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

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm04-sec', version: 'test', level: 'silent', destination });
}

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
    scan: async () => ({ verdict: 'CLEAN' as const, engine_ref: 'sec-test' }),
  };
}

function sandboxOcr() {
  return {
    mode: 'SANDBOX' as const,
    connectorBindingId: BINDING,
    recognize: async () => ({ scenario: 'none', text: '', confidence: 0, pageCount: 0 }),
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
      environment: 'CI' as const,
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
      environment: 'CI' as const,
      repository: {} as never,
      resolveContext,
      authorizer,
      sources: { resolve: async () => null },
      sourceAcl: { canRead: async () => false },
      ocr: sandboxOcr(),
      gateway: {
        invoke: async () => ({ ok: false as const, kind: 'DENIED' as const, reason_code: 'SEC' }),
      },
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

describe('SF-M04-SEC INT-011 forged-tenant HTTP (not CERTIFIED)', () => {
  it('rejects client-controlled tenant headers on all M04 Fastify mounts with zero leakage', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    expect(app.m04Mounted).toEqual(
      expect.arrayContaining(['CMP-039', 'CMP-008', 'CMP-011', 'CMP-013', 'CMP-009', 'CMP-014']),
    );
    expect(app.m04Mounted).not.toContain('CMP-036');

    await expectTen002(app, 'GET', '/v1/ai/models/capabilities');
    await expectTen002(app, 'GET', `/v1/evaluations/${DOC}`);
    await expectTen002(app, 'GET', `/v1/evidence-policies/${DOC}`);
    await expectTen002(app, 'GET', `/v1/upload-policies/${DOC}`);
    await expectTen002(app, 'GET', `/v1/executions/${DOC}`);
    await expectTen002(app, 'GET', `/v1/intelligence-jobs/${DOC}`);
  });

  it('rejects x-sf-tenant and tenant-id body-adjacent headers without echoing canary', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    const hdrs = ['x-sf-tenant', 'x-tenant', 'sf-tenant-id', 'X-Tenant-ID'];
    for (const name of hdrs) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/ai/models/capabilities',
        headers: { authorization: 'Bearer officer-t1', [name]: CANARY },
      });
      expect(res.statusCode, name).toBe(403);
      expect(res.body, name).not.toContain(CANARY);
      expect((res.json() as { error_code: string }).error_code).toBe('SF-TEN-002');
    }
  });

  it('tenant_id in JSON body is not trusted as server tenant context', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/invoke',
      headers: {
        authorization: 'Bearer officer-t1',
        'content-type': 'application/json',
        'idempotency-key': 'sec-body-1',
      },
      payload: {
        tenant_id: CANARY,
        policy_id: 'assistive.extract',
        policy_version: 1,
        purpose: 'assistive extraction',
        data_classification: 'INTERNAL',
        variables: {},
        sources: [],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(res.body).not.toContain(CANARY);
    expect(JSON.stringify(res.json())).not.toContain(CANARY);
  });

  it('tenant query/path manipulation does not become trusted server context', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/evaluations/${DOC}?tenant_id=${CANARY}`,
      headers: { authorization: 'Bearer officer-t1' },
    });
    expect(res.statusCode).toBe(403);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(res.body).not.toContain(CANARY);
    const forgedPath = await app.inject({
      method: 'GET',
      url: `/v1/ai/models/capabilities`,
      headers: { authorization: 'Bearer officer-t1', 'x-tenant-id': CANARY },
    });
    expect(forgedPath.statusCode).toBe(403);
    expect(forgedPath.body).not.toContain(CANARY);
  });
});
