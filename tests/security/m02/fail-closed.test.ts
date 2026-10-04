import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate, type RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { assertBindingAllowed } from '../../../services/cmp-004-identity-access/src/bindings.js';
import { Cmp004Error } from '../../../services/cmp-004-identity-access/src/errors.js';
import { assertBindingSafe } from '../../../services/cmp-005-citizen-profile/src/domain/connector-guard.js';
import { Cmp005Error } from '../../../services/cmp-005-citizen-profile/src/errors.js';

const refuse = async () => {
  throw new Cmp004Error('SF-SYS-003');
};

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-sec',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

const T1 = '11111111-1111-4111-8111-111111111111';
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CANARY = 'CANARY-PII-555-0100';
const SECRET = 'otp-secret-not-for-logs';

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

const DIGILOCKER_BINDING = {
  connector_binding_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenant_id: T1,
  connector_type: 'DIGILOCKER' as const,
  mode: 'SIMULATED' as const,
  environment: 'CI' as const,
  critical: true,
  secret_ref: null,
  simulator_version: 'sim-1',
};

function capturingLogger(lines: string[]) {
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return createLogger({ service: 'm02-sec', version: 'test', level: 'info', destination });
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M02-SEC fail-closed / PII / SIMULATED (not CERTIFIED)', () => {
  it('unauthenticated identity and unauthorized profile fail closed without canary leakage', async () => {
    const lines: string[] = [];
    app = await buildApp(config, {
      logger: capturingLogger(lines),
      m02: {
        identityAccess: {
          commands: {
            requestCitizenOtp: refuse,
            verifyCitizenOtp: refuse,
            completeRecovery: refuse,
            revokeCitizenSession: refuse,
            linkDigiLocker: refuse,
            me: refuse,
            issueOfficerSession: refuse,
            revokeOfficerSession: refuse,
          },
          verifier: { verify: async () => null },
          resolveContext: { resolve: async () => CTX },
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
          digiLockerBinding: DIGILOCKER_BINDING,
          rateLimitMax: 10_000,
        },
      },
    });

    const unauth = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(unauth.statusCode).toBe(401);
    expect(validate('error-response', unauth.json()).valid).toBe(true);
    expect(unauth.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    expect(unauth.body).not.toContain(SECRET);
    expect((unauth.json() as { correlation_id: string }).correlation_id).toBeTruthy();
    expect(JSON.stringify(unauth.json())).not.toContain(SECRET);

    const denied = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${SUBJECT}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer officer-t1' },
    });
    expect(denied.statusCode).toBe(403);
    expect(validate('error-response', denied.json()).valid).toBe(true);
    expect(denied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(denied.body).not.toContain(CANARY);

    const missingCtx = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      headers: { 'content-type': 'application/json' },
      payload: { channel: CANARY },
    });
    expect(missingCtx.statusCode).toBeGreaterThanOrEqual(400);
    expect(validate('error-response', missingCtx.json()).valid).toBe(true);
    expect(missingCtx.body).not.toContain(CANARY);
    expect(missingCtx.body).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain(CANARY);
  });

  it('null context on CMP-005 is unauthenticated fail-closed', async () => {
    app = await buildApp(config, {
      logger: capturingLogger([]),
      m02: {
        citizenProfile: {
          pool: {} as never,
          resolveContext: async () => null,
          authorizer: { decide: async () => DENY },
          consentAccess: { check: async () => ({ allowed: true, reason_code: 'OK' }) },
          subjectDirectory: { exists: async () => true },
          deploymentEnvironment: 'CI' as const,
          digiLockerBinding: DIGILOCKER_BINDING,
          rateLimitMax: 10_000,
        },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${SUBJECT}?purpose_code=PROFILE_ACCESS`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    expect(validate('error-response', res.json()).valid).toBe(true);
  });

  it('PRODUCTION SIMULATED critical connectors fail closed', async () => {
    const sim = {
      connector_binding_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenant_id: T1,
      connector_type: 'DIGILOCKER' as const,
      mode: 'SIMULATED' as const,
      environment: 'PRODUCTION' as const,
      critical: true,
      secret_ref: null,
      simulator_version: 'sim-1',
    };
    expect(() => assertBindingAllowed(sim, 'PRODUCTION')).toThrow(Cmp004Error);
    expect(() => assertBindingSafe(sim, 'PRODUCTION', T1)).toThrow(Cmp005Error);
    await expect(
      buildApp(config, {
        logger: capturingLogger([]),
        m02: {
          citizenProfile: {
            pool: {} as never,
            resolveContext: async () => CTX,
            authorizer: { decide: async () => DENY },
            consentAccess: { check: async () => ({ allowed: true, reason_code: 'OK' }) },
            subjectDirectory: { exists: async () => true },
            deploymentEnvironment: 'PRODUCTION',
            digiLockerBinding: sim,
            rateLimitMax: 10_000,
          },
        },
      }),
    ).rejects.toMatchObject({ details: [{ code: 'PRODUCTION_SIMULATED_REFUSED' }] });
  });
});
