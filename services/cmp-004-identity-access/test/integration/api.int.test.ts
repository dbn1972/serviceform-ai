import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hmacHex } from '../../src/hashing.js';
import { SimulatedOtpAdapter } from '../../src/adapters/otp.js';
import { simulatedBinding } from '../../src/bindings.js';
import { mintSimulatedIdpAssertion } from '../../src/adapters/idp.js';
import {
  ACTOR_OFFICER,
  buildApp,
  closeHarness,
  OTP_ID,
  PEPPER,
  setupHarness,
  T1,
  type Harness,
} from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-004 API integration', () => {
  it('citizen OTP + officer session + PrincipalVerifier', async () => {
    const { app } = await buildApp(h);
    const ch = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel: '+10000000009' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(ch.statusCode).toBe(200);
    const challengeId = (ch.json() as { challenge_id: string }).challenge_id;
    const row = await h.admin.query<{ channel_hash: string }>(
      'SELECT channel_hash FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1',
      [challengeId],
    );
    const otp = new SimulatedOtpAdapter(
      simulatedBinding({ id: OTP_ID, connector_type: 'OTP', simulator_version: 'otp-sim-1' }),
      PEPPER,
    );
    const code = otp.createChallenge({
      challengeId,
      channelHash: row.rows[0]?.channel_hash ?? hmacHex(PEPPER, 'missing'),
      testRunId: 'int-run',
    }).code;
    const ver = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: challengeId, code },
    });
    expect(ver.statusCode).toBe(200);
    const token = (ver.json() as { session_token: string }).session_token;
    const me = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);

    const assertion = mintSimulatedIdpAssertion(PEPPER, {
      sub: 'officer-sub',
      tenant_id: T1,
      officer_id: ACTOR_OFFICER,
      roles: ['SERVICE_CHECKER'],
    });
    const off = await app.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions',
      payload: { assertion },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(off.statusCode).toBe(200);
    const officerToken = (off.json() as { session_token: string }).session_token;
    const ome = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${officerToken}`, 'x-tenant-id': T1 },
    });
    expect(ome.statusCode).toBe(403);
    const ome2 = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${officerToken}` },
    });
    expect(ome2.statusCode).toBe(200);
    expect(ome2.json()).toMatchObject({ tenant_id: T1, actor_type: 'OFFICER' });
    await app.close();
  });
});
