import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedOtpAdapter } from '../../src/adapters/otp.js';
import { simulatedBinding } from '../../src/bindings.js';
import { buildApp, closeHarness, OTP_ID, PEPPER, setupHarness, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

async function challenge(app: Awaited<ReturnType<typeof buildApp>>['app'], channel: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/identity/citizen/otp/challenges',
    payload: { channel },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(res.statusCode).toBe(200);
  const challengeId = (res.json() as { challenge_id: string }).challenge_id;
  const row = await h.admin.query<{ channel_hash: string }>(
    'SELECT channel_hash FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1',
    [challengeId],
  );
  const code = new SimulatedOtpAdapter(
    simulatedBinding({ id: OTP_ID, connector_type: 'OTP', simulator_version: 'otp-sim-1' }),
    PEPPER,
  ).createChallenge({
    challengeId,
    channelHash: row.rows[0]?.channel_hash ?? '',
    testRunId: 'int-run',
  }).code;
  return { challengeId, code };
}

function wrong(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

describe('CMP-004 OTP failure state is durable on PostgreSQL', () => {
  it('five wrong codes lock the challenge; the correct code is then refused', async () => {
    const { app } = await buildApp(h);
    const { challengeId, code } = await challenge(app, '+10000000021');
    for (let i = 1; i <= 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/identity/citizen/otp/verify',
        payload: { challenge_id: challengeId, code: wrong(code) },
      });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error_code: string }).error_code).toBe('SF-AUTH-001');
      const row = await h.admin.query<{ attempts: number; status: string }>(
        'SELECT attempts, status FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1',
        [challengeId],
      );
      expect(row.rows[0]).toEqual({ attempts: i, status: i === 5 ? 'LOCKED' : 'PENDING' });
    }
    const late = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: challengeId, code },
    });
    expect(late.statusCode).toBe(401);
    const sessions = await h.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sf_identity.session_lookup WHERE actor_type = 'CITIZEN'`,
    );
    expect(sessions.rows[0]?.n).toBe(0);
    await app.close();
  });

  it('a new challenge supersedes earlier pending ones for the same number (SEC F-06)', async () => {
    const { app } = await buildApp(h);
    const first = await challenge(app, '+10000000024');
    const second = await challenge(app, '+10000000024');
    const rows = await h.admin.query<{ challenge_id: string; status: string }>(
      'SELECT challenge_id, status FROM sf_identity.citizen_otp_challenge WHERE challenge_id = ANY($1::uuid[])',
      [[first.challengeId, second.challengeId]],
    );
    const status = Object.fromEntries(rows.rows.map((r) => [r.challenge_id, r.status]));
    expect(status[first.challengeId]).toBe('EXPIRED');
    expect(status[second.challengeId]).toBe('PENDING');
    const stale = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: first.challengeId, code: first.code },
    });
    expect(stale.statusCode).toBe(401);
    await app.close();
  });

  it('concurrent challenge requests for one number leave exactly one pending (SEC F-06)', async () => {
    const { app } = await buildApp(h);
    const channel = '+10000000025';
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/identity/citizen/otp/challenges',
          payload: { channel },
          headers: { 'idempotency-key': randomUUID() },
        }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    const ids = responses.map((r) => (r.json() as { challenge_id: string }).challenge_id);
    const pending = await h.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sf_identity.citizen_otp_challenge
        WHERE challenge_id = ANY($1::uuid[]) AND status = 'PENDING'`,
      [ids],
    );
    expect(pending.rows[0]?.n).toBe(1);
    await app.close();
  });

  it('the per-number failed-attempt budget survives new challenges (SEC F-06)', async () => {
    const { app } = await buildApp(h);
    const channel = '+10000000026';
    for (let round = 0; round < 2; round += 1) {
      const { challengeId, code } = await challenge(app, channel);
      for (let i = 0; i < 5; i += 1) {
        await app.inject({
          method: 'POST',
          url: '/v1/identity/citizen/otp/verify',
          payload: { challenge_id: challengeId, code: wrong(code) },
        });
      }
    }
    const throttled = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(throttled.statusCode).toBe(429);
    expect((throttled.json() as { error_code: string }).error_code).toBe('SF-RATE-001');
    const other = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/challenges',
      payload: { channel: '+10000000027' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(other.statusCode).toBe(200);
    await app.close();
  });

  it('a verified code cannot be replayed', async () => {
    const { app } = await buildApp(h);
    const { challengeId, code } = await challenge(app, '+10000000022');
    const first = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: challengeId, code },
    });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: challengeId, code },
    });
    expect(replay.statusCode).toBe(401);
    await app.close();
  });

  it('an expired challenge is marked EXPIRED durably and refused', async () => {
    const { app } = await buildApp(h);
    const { challengeId, code } = await challenge(app, '+10000000023');
    await h.admin.query(
      `UPDATE sf_identity.citizen_otp_challenge SET expires_at = now() - interval '1 second'
        WHERE challenge_id = $1`,
      [challengeId],
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/citizen/otp/verify',
      payload: { challenge_id: challengeId, code },
    });
    expect(res.statusCode).toBe(401);
    const row = await h.admin.query<{ status: string }>(
      'SELECT status FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1',
      [challengeId],
    );
    expect(row.rows[0]?.status).toBe('EXPIRED');
    await app.close();
  });
});
