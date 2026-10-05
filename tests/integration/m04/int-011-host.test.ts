import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { registerM04Plugins, type M04PluginMounts } from '../../../apps/api/src/composition/m04.js';
import { BINDING, CANARY, DOC, T1 } from './pg-harness.js';

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
  return createLogger({ service: 'm04-int', version: 'test', level: 'info', destination });
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

const M04_EXPECTED = ['CMP-039', 'CMP-008', 'CMP-011', 'CMP-013', 'CMP-009', 'CMP-014'] as const;

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

function m04Mounts(): M04PluginMounts {
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  return {
    aiGateway: { pool: {} as never, resolveContext, authorizer, providers: new Map() },
    rules: { pool: {} as never, resolveContext, authorizer },
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
    forms: { pool: {} as never, resolveContext, authorizer },
    documentIntelligence: {
      environment: 'CI',
      repository: {} as never,
      resolveContext,
      authorizer,
      sources: { resolve: async () => null },
      sourceAcl: { canRead: async () => false },
      ocr: sandboxOcr(),
      gateway: {
        invoke: async () => ({ ok: false as const, kind: 'DENIED' as const, reason_code: 'HOST' }),
      },
    },
  };
}

const PROBES: Array<['GET' | 'POST', string]> = [
  ['GET', '/v1/ai/models/capabilities'],
  ['GET', `/v1/evaluations/${DOC}`],
  ['GET', `/v1/evidence-policies/${DOC}`],
  ['GET', `/v1/upload-policies/${DOC}`],
  ['GET', `/v1/executions/${DOC}`],
  ['GET', `/v1/intelligence-jobs/${DOC}`],
];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('INT-011 host M04 mounts (independent stitcher)', () => {
  it('mounts all six together; CMP-036 is single-mounted; forged X-Tenant-ID is SF-TEN-002', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    expect(app.m04Mounted).toEqual([...M04_EXPECTED]);
    expect(app.m04Mounted).not.toContain('CMP-036');
    const plugins = app.printPlugins();
    expect(plugins.split('cmp-036-api-gateway').length - 1).toBe(1);

    for (const [method, url] of PROBES) {
      const forged = await app.inject({
        method,
        url,
        headers: { 'x-tenant-id': CANARY, 'X-Tenant-ID': CANARY },
      });
      expect(forged.statusCode).toBe(403);
      expect(validate('error-response', forged.json()).valid).toBe(true);
      expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
      expect(forged.body).not.toContain(CANARY);
    }
  });

  it('tenant context is server-derived; unauthenticated M04 routes stay deny-by-default', async () => {
    app = await buildApp(config, { logger: silentLogger(), m04: m04Mounts() });
    const noHeader = await app.inject({ method: 'GET', url: `/v1/evaluations/${DOC}` });
    expect(noHeader.statusCode).toBe(403);
    expect(validate('error-response', noHeader.json()).valid).toBe(true);
    expect(noHeader.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(noHeader.body).not.toContain(CANARY);

    const ai = await app.inject({ method: 'GET', url: '/v1/ai/models/capabilities' });
    expect(ai.statusCode).toBe(403);
    expect(ai.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
  });

  it('M04 composition has no SQL, no provider SDK, and CMP-014 uses AiGatewayPort only', async () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../apps/api/src/composition/m04.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(src).toContain('import(specifier)');
    expect(src).toMatch(/AiGatewayPort/);
    expect(src).not.toMatch(/openai|anthropic|bedrock|vertexai|@ai-sdk/i);
    expect(src).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
    expect(typeof registerM04Plugins).toBe('function');
  });
});
