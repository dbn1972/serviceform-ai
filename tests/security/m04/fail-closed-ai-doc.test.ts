import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import {
  authorize,
  authzInput,
  denyAllAuthz,
} from '../../../services/cmp-039-ai-gateway/src/authz.js';
import { Cmp039Error } from '../../../services/cmp-039-ai-gateway/src/errors.js';
import {
  assertsBindingDecision,
  isAllowedTaskKind,
  isStatutoryDecisionKind,
} from '../../../services/cmp-039-ai-gateway/src/domain/statutory-guard.js';
import { redactText } from '../../../services/cmp-039-ai-gateway/src/domain/redaction.js';
import {
  denyAllPurposeConsent,
  denyAllSourceAcl,
} from '../../../services/cmp-039-ai-gateway/src/ports/policy-ports.js';
import { authorize as authorize014 } from '../../../services/cmp-014-document-intelligence/src/authz.js';
import { Cmp014Error } from '../../../services/cmp-014-document-intelligence/src/errors.js';
import { assertSimulationPolicy as assert014Sim } from '../../../services/cmp-014-document-intelligence/src/domain/simulation.js';
import { assertSimulationPolicy as assert013Sim } from '../../../services/cmp-013-document-upload/src/domain/simulation.js';
import { buildIntelligenceService } from '../../../services/cmp-014-document-intelligence/src/plugin.js';
import { buildUploadService } from '../../../services/cmp-013-document-upload/src/plugin.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-sec',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

const T1 = '11111111-1111-4111-8111-111111111111';
const DOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANARY = 'CANARY-PII-555-0100';
const SECRET = 'sk-sec-canary-not-for-logs';
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

function capturingLogger(lines: string[]) {
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return createLogger({ service: 'm04-sec', version: 'test', level: 'info', destination });
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

function m04Mounts(authorizer = { decide: async () => DENY }) {
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
      storage: sandboxStorage(),
      scanner: sandboxScanner(),
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
      ocr: sandboxOcr(),
      gateway: {
        invoke: async () => ({ ok: false as const, kind: 'DENIED' as const, reason_code: 'SEC' }),
      },
    },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M04-SEC fail-closed / AI / document security (not CERTIFIED)', () => {
  it('OPA deny and unavailable PDP fail closed (never allow)', async () => {
    await expect(
      authorize(denyAllAuthz(), authzInput(CTX, 'AI_INVOKE', 'AiGateway')),
    ).rejects.toBeInstanceOf(Cmp039Error);
    await expect(
      authorize(
        {
          decide: async () => {
            throw new Error('opa down');
          },
        },
        authzInput(CTX, 'AI_INVOKE', 'AiGateway'),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });

    await expect(
      authorize014(
        {
          decide: async () => {
            throw new Error('opa down');
          },
        },
        {
          subject: {
            user_id: CTX.actor.id,
            actor_type: CTX.actor.type,
            tenant_id: T1,
            roles: CTX.roles,
            jurisdiction_ids: CTX.jurisdiction_ids,
          },
          resource: {
            resource_type: 'IntelligenceJob',
            tenant_id: T1,
            classification: 'TENANT_SCOPED',
          },
          action: 'READ',
          environment: { request_time: new Date().toISOString() },
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });

    const lines: string[] = [];
    app = await buildApp(config, {
      logger: capturingLogger(lines),
      m04: m04Mounts(),
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/ai/models/capabilities',
      headers: { authorization: 'Bearer officer-t1' },
    });
    expect(denied.statusCode).toBe(403);
    expect(validate('error-response', denied.json()).valid).toBe(true);
    expect(denied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(denied.body).not.toContain(CANARY);
    expect(denied.body).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('null context is unauthenticated fail-closed on M04 mounts', async () => {
    app = await buildApp(config, {
      logger: capturingLogger([]),
      m04: {
        ...m04Mounts(),
        aiGateway: {
          pool: {} as never,
          resolveContext: async () => null,
          authorizer: { decide: async () => DENY },
          providers: new Map(),
        },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ai/models/capabilities',
      headers: { authorization: 'Bearer officer-t1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    expect(validate('error-response', res.json()).valid).toBe(true);
  });

  it('statutory AI paths are zero: decision kinds and binding phrases rejected', () => {
    expect(isAllowedTaskKind('EXTRACT')).toBe(true);
    expect(isAllowedTaskKind('ELIGIBILITY_DECISION')).toBe(false);
    expect(isAllowedTaskKind('APPROVE')).toBe(false);
    expect(isAllowedTaskKind('REJECT')).toBe(false);
    expect(isStatutoryDecisionKind('ELIGIBILITY_DECISION')).toBe(true);
    expect(isStatutoryDecisionKind('APPROVE_APPLICATION')).toBe(true);
    expect(isStatutoryDecisionKind('EXTRACT')).toBe(false);
    expect(assertsBindingDecision('The application is approved')).toBe(true);
    expect(assertsBindingDecision('applicant is eligible')).toBe(true);
    expect(assertsBindingDecision('Extract fields from the document')).toBe(false);
  });

  it('purpose/consent and source ACL default deny; redaction strips secrets', async () => {
    expect(
      await denyAllPurposeConsent().permits({
        tenantId: T1,
        actorId: CTX.actor.id,
        purpose: 'ASSIST',
        classification: 'PERSONAL',
      }),
    ).toBe(false);
    expect(
      await denyAllSourceAcl().canRead({
        tenantId: T1,
        actorId: CTX.actor.id,
        sourceId: DOC,
      }),
    ).toBe(false);
    const redacted = redactText(`Bearer ${SECRET} contact ${CANARY}@example.test`);
    expect(redacted.text).not.toContain(SECRET);
    expect(redacted.total).toBeGreaterThan(0);
  });

  it('PRODUCTION SIMULATED critical connectors fail closed for CMP-013 and CMP-014', () => {
    const sim = {
      critical: true,
      mode: 'SIMULATED' as const,
      environment: 'PRODUCTION',
      connector_binding_id: BINDING,
    };
    expect(() => assert013Sim([sim])).toThrow();
    expect(() => assert014Sim([sim])).toThrow();
    try {
      buildUploadService({
        environment: 'PRODUCTION',
        repository: {} as never,
        resolveContext: async () => CTX,
        authorizer: { decide: async () => DENY },
        storage: { ...sandboxStorage(), mode: 'SIMULATED' },
        scanner: { ...sandboxScanner(), mode: 'SIMULATED' },
        workerActorId: CTX.actor.id,
      });
      expect.fail('CMP-013 PRODUCTION SIMULATED should refuse');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('SF-INT-001');
    }
    expect(() =>
      buildIntelligenceService({
        environment: 'PRODUCTION',
        repository: {} as never,
        resolveContext: async () => CTX,
        authorizer: { decide: async () => DENY },
        sources: { resolve: async () => null },
        sourceAcl: { canRead: async () => false },
        ocr: { ...sandboxOcr(), mode: 'SIMULATED', simulation: { simulation: true } as never },
        gateway: {
          invoke: async () => ({ ok: false as const, kind: 'DENIED' as const, reason_code: 'X' }),
        },
      }),
    ).toThrow(Cmp014Error);
  });

  it('CMP-014 gateway port is the only inference path; host has no duplicate CMP-036', async () => {
    const mounts = m04Mounts();
    expect(typeof mounts.documentIntelligence?.gateway.invoke).toBe('function');
    expect(JSON.stringify(mounts.documentIntelligence?.gateway)).not.toMatch(
      /openai|anthropic|bedrock|api[_-]?key/i,
    );
    app = await buildApp(config, { logger: capturingLogger([]), m04: mounts });
    expect(app.m04Mounted).not.toContain('CMP-036');
    expect(app.printPlugins().split('cmp-036-api-gateway').length - 1).toBe(1);
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/evaluations/${DOC}`,
      headers: { authorization: 'Bearer officer-t1' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(denied.body).not.toContain(SECRET);
    const intel = await app.inject({
      method: 'GET',
      url: `/v1/intelligence-jobs/${DOC}`,
      headers: { authorization: 'Bearer officer-t1', 'x-tenant-id': T1 },
    });
    expect(intel.statusCode).toBe(403);
    expect(intel.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(intel.body).not.toContain(SECRET);
  });
});
