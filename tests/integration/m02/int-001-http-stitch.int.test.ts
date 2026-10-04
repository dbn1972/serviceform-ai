import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { IdentityService } from '../../../services/cmp-004-identity-access/src/commands.js';
import { SimulatedOtpAdapter } from '../../../services/cmp-004-identity-access/src/adapters/otp.js';
import {
  SimulatedIdpAdapter,
  mintSimulatedIdpAssertion,
} from '../../../services/cmp-004-identity-access/src/adapters/idp.js';
import { SimulatedDigiLockerIdentityAdapter } from '../../../services/cmp-004-identity-access/src/adapters/digilocker.js';
import { simulatedBinding } from '../../../services/cmp-004-identity-access/src/bindings.js';
import { registerIdentityAccess } from '../../../services/cmp-004-identity-access/src/plugin.js';
import {
  IdentityContextResolver,
  IdentityPrincipalVerifier,
  PgSessionDirectory,
} from '../../../services/cmp-004-identity-access/src/principal-verifier.js';
import { outboxAuditRecorder } from '../../../services/cmp-004-identity-access/src/audit.js';
import { ContractAuthorizer as Auth004 } from '../../../services/cmp-004-identity-access/test/doubles/authorizer.js';
import { registerCitizenProfile } from '../../../services/cmp-005-citizen-profile/src/plugin.js';
import { ContractAuthorizer as Auth005 } from '../../../services/cmp-005-citizen-profile/test/doubles/authorizer.js';
import { AllowConsent } from '../../../services/cmp-005-citizen-profile/test/doubles/ports.js';
import { hmacHex } from '../../../services/cmp-004-identity-access/src/hashing.js';
import type { SubjectDirectoryPort } from '../../../services/cmp-005-citizen-profile/src/ports.js';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import {
  CANARY,
  DL_ID,
  IDP_ID,
  OFFICER_T1,
  OFFICER_T2,
  OTP_ID,
  PEPPER,
  T1,
  T2,
  TRACE,
  createLogin,
  dropRoles,
  ensurePeerGroupRoles,
  migrateUp,
  rolePassword,
  runtimePool,
  withAdmin,
} from './pg-harness.js';

const ROLES = ['sf_m02int_004', 'sf_m02int_005'] as const;

class IdentitySubjectDirectory implements SubjectDirectoryPort {
  constructor(private readonly lookup: (id: string) => Promise<boolean>) {}
  async exists(input: { tenant_id: string; subject_id: string }): Promise<boolean> {
    return this.lookup(input.subject_id);
  }
}

describe('INT-001 HTTP stitch (CMP-004 session → CMP-005 profile/DigiLocker)', () => {
  const password = rolePassword();
  const consent = new AllowConsent();
  const authorizer005 = new Auth005();
  let p004: ReturnType<typeof runtimePool>;
  let p005: ReturnType<typeof runtimePool>;
  let app: ReturnType<typeof Fastify> | undefined;

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await dropRoles(c, ROLES);
    });
    migrateUp();
    await withAdmin(async (c) => {
      await ensurePeerGroupRoles(c);
      await createLogin(c, 'sf_m02int_004', 'sf_cmp004_rw', password);
      await createLogin(c, 'sf_m02int_005', 'sf_cmp005_rw', password);
    });
    p004 = runtimePool('sf_m02int_004', password);
    p005 = runtimePool('sf_m02int_005', password);

    const directory = new PgSessionDirectory(p004);
    const verifier = new IdentityPrincipalVerifier(directory);
    const identityResolver = new IdentityContextResolver(directory, 'cell-01');

    const resolveFromIdentity = async (request: FastifyRequest): Promise<RequestContext | null> => {
      const principal = await verifier.verify(request);
      if (!principal) return null;
      const resolved = await identityResolver.resolve(principal, { cellId: 'cell-01' });
      if (!resolved) return null;
      return {
        ...resolved,
        correlation_id: randomUUID(),
        trace_id: TRACE,
      };
    };

    const subjects = new IdentitySubjectDirectory(async (subjectId) => {
      const found = await p004.query(
        `SELECT 1 FROM sf_identity.citizen_principal WHERE citizen_id = $1 AND status = 'ACTIVE'`,
        [subjectId],
      );
      return (found.rowCount ?? 0) > 0;
    });

    const commands = new IdentityService({
      pool: p004,
      pepper: PEPPER,
      otp: new SimulatedOtpAdapter(
        simulatedBinding({ id: OTP_ID, connector_type: 'OTP', simulator_version: 'otp-sim-1' }),
        PEPPER,
      ),
      idp: new SimulatedIdpAdapter(
        simulatedBinding({
          id: IDP_ID,
          connector_type: 'DEPARTMENT_API',
          simulator_version: 'idp-sim-1',
        }),
        PEPPER,
      ),
      digilocker: new SimulatedDigiLockerIdentityAdapter(
        simulatedBinding({
          id: DL_ID,
          connector_type: 'DIGILOCKER',
          simulator_version: 'dl-sim-1',
        }),
        PEPPER,
      ),
      authorizer: new Auth004(),
      audit: outboxAuditRecorder,
      clock: () => new Date(),
      testRunId: 'm02-int',
    });

    app = Fastify({
      logger: false,
      genReqId: () => randomUUID(),
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerIdentityAccess(app, {
      prefix: '/v1',
      commands,
      verifier,
      resolveContext: identityResolver,
      cellId: 'cell-01',
      rateLimitMax: 10_000,
    });
    await registerCitizenProfile(app, {
      prefix: '/v1',
      pool: p005,
      resolveContext: resolveFromIdentity,
      authorizer: authorizer005,
      consentAccess: consent,
      subjectDirectory: subjects,
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
      deploymentEnvironment: 'CI',
      digiLockerBinding: {
        connector_binding_id: DL_ID,
        tenant_id: T1,
        connector_type: 'DIGILOCKER',
        mode: 'SIMULATED',
        environment: 'CI',
        critical: true,
        secret_ref: null,
        simulator_version: 'dl-sim-1',
      },
      rateLimitMax: 10_000,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all([p004.end(), p005.end()]);
  });

  it('OTP + officer IdP tenant from assertion; T2/forged tenant cannot read T1 claims; idempotent upsert', async () => {
    const running = app;
    if (!running) throw new Error('INT-001 host app not started');

    const ch = await running.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel: '+10000000021' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(ch.statusCode).toBe(200);
    expect(validate('error-response', ch.json()).valid).toBe(false);
    const challengeId = (ch.json() as { challenge_id: string }).challenge_id;
    const row = await withAdmin(async (c) => {
      const r = await c.query<{ channel_hash: string }>(
        'SELECT channel_hash FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1',
        [challengeId],
      );
      return r.rows[0]?.channel_hash;
    });
    const otp = new SimulatedOtpAdapter(
      simulatedBinding({ id: OTP_ID, connector_type: 'OTP', simulator_version: 'otp-sim-1' }),
      PEPPER,
    );
    const code = otp.createChallenge({
      challengeId,
      channelHash: row ?? hmacHex(PEPPER, 'missing'),
      testRunId: 'm02-int',
    }).code;
    const ver = await running.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: challengeId, code },
    });
    expect(ver.statusCode).toBe(200);
    const citizenToken = (ver.json() as { session_token: string }).session_token;
    const citizenId = (ver.json() as { citizen_id: string }).citizen_id;

    const me = await running.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { actor_type: string }).actor_type).toBe('CITIZEN');
    expect((me.json() as { tenant_id: string | null }).tenant_id).toBeNull();

    const citizenProfile = await running.inject({
      method: 'GET',
      url: `/v1/profiles/${citizenId}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    expect(citizenProfile.statusCode).toBe(401);
    expect(validate('error-response', citizenProfile.json()).valid).toBe(true);
    expect(citizenProfile.json()).toMatchObject({ error_code: 'SF-TEN-001' });

    const citizenForged = await running.inject({
      method: 'GET',
      url: `/v1/profiles/${citizenId}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: `Bearer ${citizenToken}`, 'x-tenant-id': T1 },
    });
    expect(citizenForged.statusCode).toBe(403);
    expect(citizenForged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(citizenForged.body).not.toContain(T1);

    const assertionT1 = mintSimulatedIdpAssertion(PEPPER, {
      sub: 'officer-t1',
      tenant_id: T1,
      officer_id: OFFICER_T1,
      roles: ['SERVICE_CHECKER'],
    });
    const offT1 = await running.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions',
      payload: { assertion: assertionT1 },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(offT1.statusCode).toBe(200);
    const tokenT1 = (offT1.json() as { session_token: string }).session_token;
    expect((offT1.json() as { tenant_id: string }).tenant_id).toBe(T1);

    const forgedMe = await running.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${tokenT1}`, 'x-tenant-id': CANARY },
    });
    expect(forgedMe.statusCode).toBe(403);
    expect(validate('error-response', forgedMe.json()).valid).toBe(true);
    expect(forgedMe.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(forgedMe.body).not.toContain(CANARY);

    const meT1 = await running.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${tokenT1}` },
    });
    expect(meT1.statusCode).toBe(200);
    expect(meT1.json()).toMatchObject({ tenant_id: T1, actor_type: 'OFFICER' });

    const ensure = await running.inject({
      method: 'PUT',
      url: `/v1/profiles/${citizenId}`,
      headers: { authorization: `Bearer ${tokenT1}`, 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(ensure.statusCode).toBe(200);

    const upsertKey = `idem-up-${randomUUID().slice(0, 8)}`;
    const upsertBody = {
      purpose_code: 'PROFILE_ACCESS',
      claims: [{ section_code: 'IDENTITY', claim_code: 'DISPLAY_NAME', value_text: 'SECRET_NAME' }],
    };
    const up1 = await running.inject({
      method: 'PUT',
      url: `/v1/profiles/${citizenId}/claims`,
      headers: { authorization: `Bearer ${tokenT1}`, 'idempotency-key': upsertKey },
      payload: upsertBody,
    });
    expect(up1.statusCode).toBe(200);
    const up2 = await running.inject({
      method: 'PUT',
      url: `/v1/profiles/${citizenId}/claims`,
      headers: { authorization: `Bearer ${tokenT1}`, 'idempotency-key': upsertKey },
      payload: upsertBody,
    });
    expect(up2.statusCode).toBe(200);
    expect(up2.json()).toEqual(up1.json());

    const readT1 = await running.inject({
      method: 'GET',
      url: `/v1/profiles/${citizenId}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: `Bearer ${tokenT1}` },
    });
    expect(readT1.statusCode).toBe(200);
    expect(JSON.stringify(readT1.json())).toContain('SECRET_NAME');

    const imp = await running.inject({
      method: 'POST',
      url: `/v1/profiles/${citizenId}/verified-claims/import`,
      headers: { authorization: `Bearer ${tokenT1}`, 'idempotency-key': randomUUID() },
      payload: { purpose_code: 'PROFILE_ACCESS', scenario: 'happy', test_run_id: 'm02-int' },
    });
    expect(imp.statusCode).toBe(200);
    expect((imp.json() as { simulation?: { simulation: boolean } }).simulation?.simulation).toBe(
      true,
    );

    const assertionT2 = mintSimulatedIdpAssertion(PEPPER, {
      sub: 'officer-t2',
      tenant_id: T2,
      officer_id: OFFICER_T2,
      roles: ['SERVICE_CHECKER'],
    });
    const offT2 = await running.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions',
      payload: { assertion: assertionT2 },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(offT2.statusCode).toBe(200);
    const tokenT2 = (offT2.json() as { session_token: string }).session_token;
    expect((offT2.json() as { tenant_id: string }).tenant_id).toBe(T2);

    const otherTenant = await running.inject({
      method: 'GET',
      url: `/v1/profiles/${citizenId}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: `Bearer ${tokenT2}` },
    });
    expect([403, 404]).toContain(otherTenant.statusCode);
    if (otherTenant.statusCode === 200) {
      throw new Error('CROSS_TENANT_LEAKAGE');
    }
    expect(JSON.stringify(otherTenant.json())).not.toContain('SECRET_NAME');
    expect(validate('error-response', otherTenant.json()).valid).toBe(true);

    consent.allowed = false;
    const deniedConsent = await running.inject({
      method: 'GET',
      url: `/v1/profiles/${citizenId}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: `Bearer ${tokenT1}` },
    });
    expect(deniedConsent.statusCode).toBe(403);
    expect(deniedConsent.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(JSON.stringify(deniedConsent.json())).not.toContain('SECRET_NAME');
    consent.allowed = true;

    authorizer005.denies.add('PROFILE_READ');
    const authzDeny = await running.inject({
      method: 'GET',
      url: `/v1/profiles/${citizenId}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: `Bearer ${tokenT1}` },
    });
    expect(authzDeny.statusCode).toBe(403);
    expect(validate('error-response', authzDeny.json()).valid).toBe(true);
    expect(authzDeny.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    authorizer005.denies.delete('PROFILE_READ');
  });
});
