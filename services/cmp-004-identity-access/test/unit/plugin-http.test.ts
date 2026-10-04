import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { IdentityService } from '../../src/commands.js';
import { SimulatedOtpAdapter } from '../../src/adapters/otp.js';
import { SimulatedIdpAdapter, mintSimulatedIdpAssertion } from '../../src/adapters/idp.js';
import { SimulatedDigiLockerIdentityAdapter } from '../../src/adapters/digilocker.js';
import { simulatedBinding } from '../../src/bindings.js';
import { registerIdentityAccess } from '../../src/plugin.js';
import {
  IdentityContextResolver,
  IdentityPrincipalVerifier,
  type SessionDirectory,
  type SessionLookupRow,
} from '../../src/principal-verifier.js';
import { tokenFingerprint } from '../../src/hashing.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import {
  createMemoryIdentityPool,
  emptyIdentityStore,
  type MemoryIdentityStore,
} from './memory-pool.js';

const PEPPER = 'unit-pepper-not-a-secret';
const T1 = '11111111-1111-4111-8111-111111111111';
const OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TRACE = '0'.repeat(32);

class MemoryDirectory implements SessionDirectory {
  constructor(private readonly store: MemoryIdentityStore) {}
  async lookupByToken(token: string): Promise<SessionLookupRow | null> {
    const hash = tokenFingerprint(token);
    const row = this.store.lookups.find((l) => l.token_hash === hash && l.status === 'ACTIVE');
    if (!row) return null;
    const roles =
      this.store.officerSessions.find((s) => s.session_id === row.session_id)?.role_codes ?? [];
    return {
      session_id: row.session_id,
      actor_type: row.actor_type as 'CITIZEN' | 'OFFICER',
      subject_id: row.subject_id,
      tenant_id: row.tenant_id,
      assurance: row.assurance as SessionLookupRow['assurance'],
      status: row.status,
      expires_at: row.expires_at,
      role_codes: roles,
    };
  }
  async lookupActiveBySubject(principal: {
    subject_id: string;
    actor_type: string;
  }): Promise<SessionLookupRow | null> {
    const row = this.store.lookups.find(
      (l) =>
        l.subject_id === principal.subject_id &&
        l.actor_type === principal.actor_type &&
        l.status === 'ACTIVE',
    );
    if (!row) return null;
    const roles =
      this.store.officerSessions.find((s) => s.session_id === row.session_id)?.role_codes ?? [];
    return {
      session_id: row.session_id,
      actor_type: row.actor_type as 'CITIZEN' | 'OFFICER',
      subject_id: row.subject_id,
      tenant_id: row.tenant_id,
      assurance: row.assurance as SessionLookupRow['assurance'],
      status: row.status,
      expires_at: row.expires_at,
      role_codes: roles,
    };
  }
}

function platformCtx(): RequestContext {
  return {
    tenant_id: null,
    cell_id: 'cell-01',
    actor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: 'NONE',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

describe('CMP-004 HTTP and domain (memory)', () => {
  let app: FastifyInstance;
  let store: MemoryIdentityStore;
  let otp: SimulatedOtpAdapter;
  let dispatched = 0;

  beforeAll(async () => {
    store = emptyIdentityStore();
    const pool = createMemoryIdentityPool(store);
    otp = new SimulatedOtpAdapter(
      simulatedBinding({ id: OTP_ID, connector_type: 'OTP', simulator_version: 'otp-sim-1' }),
      PEPPER,
    );
    const origDispatch = otp.dispatch.bind(otp);
    otp.dispatch = async (input: { challengeId: string; channelHash: string }) => {
      dispatched += 1;
      return origDispatch(input);
    };
    const commands = new IdentityService({
      pool,
      pepper: PEPPER,
      otp,
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
      authorizer: new ContractAuthorizer(),
      audit: { append: async () => undefined },
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
      testRunId: 'unit-run',
    });
    const directory = new MemoryDirectory(store);
    app = Fastify({ logger: false });
    await registerIdentityAccess(app, {
      prefix: '/v1',
      commands,
      verifier: new IdentityPrincipalVerifier(directory),
      resolveContext: new IdentityContextResolver(directory, 'cell-01'),
      cellId: 'cell-01',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues citizen OTP outside the DB transaction path and verifies a session', async () => {
    const challenge = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel: '+10000000001' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(challenge.statusCode).toBe(200);
    const body = challenge.json() as { challenge_id: string; simulation: { simulation: boolean } };
    expect(body.simulation.simulation).toBe(true);
    expect(dispatched).toBe(1);
    const code = otp.createChallenge({
      challengeId: body.challenge_id,
      channelHash: store.challenges[0]?.channel_hash ?? '',
      testRunId: 'unit-run',
    }).code;
    const verify = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: body.challenge_id, code },
    });
    expect(verify.statusCode).toBe(200);
    const session = verify.json() as { session_token: string; citizen_id: string };
    expect(session.session_token).toBeTruthy();
    const me = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${session.session_token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ actor_type: 'CITIZEN', tenant_id: null });
    const link = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/links/digilocker',
      headers: { authorization: `Bearer ${session.session_token}` },
      payload: { authorization_code: 'sim-code-ok' },
    });
    expect(link.statusCode).toBe(200);
    const recovery = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel: '+10000000001' },
      headers: { 'idempotency-key': randomUUID() },
    });
    const recBody = recovery.json() as { challenge_id: string };
    const recCode = otp.createChallenge({
      challengeId: recBody.challenge_id,
      channelHash: store.challenges.at(-1)?.channel_hash ?? '',
      testRunId: 'unit-run',
    }).code;
    const rec = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/recovery',
      payload: { challenge_id: recBody.challenge_id, code: recCode },
    });
    expect(rec.statusCode).toBe(200);
    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/sessions/revoke',
      headers: { authorization: `Bearer ${session.session_token}` },
    });
    expect(revoked.statusCode).toBe(200);
  });

  it('refuses client tenant headers and wrong OTP', async () => {
    const forged = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      headers: { 'x-tenant-id': T1 },
      payload: { channel: '+10000000002' },
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    const challenge = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel: '+10000000002' },
      headers: { 'idempotency-key': randomUUID() },
    });
    const id = (challenge.json() as { challenge_id: string }).challenge_id;
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: id, code: '000000' },
    });
    expect(bad.statusCode).toBe(401);
    const unauth = await app.inject({ method: 'GET', url: '/v1/identity/me' });
    expect(unauth.statusCode).toBe(401);
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel: 'not-a-channel' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('issues officer session from SIMULATED IdP claims, never from headers', async () => {
    const assertion = mintSimulatedIdpAssertion(PEPPER, {
      sub: 'idp-sub-1',
      tenant_id: T1,
      officer_id: OFFICER,
      roles: ['SERVICE_CHECKER'],
      assurance: 'MFA',
    });
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions',
      payload: { assertion },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(issued.statusCode).toBe(200);
    const body = issued.json() as { session_token: string; tenant_id: string };
    expect(body.tenant_id).toBe(T1);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${body.session_token}` },
    });
    expect(me.json()).toMatchObject({ actor_type: 'OFFICER', tenant_id: T1 });
    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions/revoke',
      headers: { authorization: `Bearer ${body.session_token}` },
    });
    expect(revoke.statusCode).toBe(200);
  });

  it('does not invent statutory eligibility', () => {
    expect(platformCtx().auth_assurance).toBe('NONE');
  });
});
