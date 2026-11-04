import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_DB,
  API,
  call,
  citizenOnHost,
  CITIZEN_BFF,
  db,
  inboxCode,
  otpChallenge,
  syntheticMobile,
} from './lib/lab';

let admin: Client;
beforeAll(async () => {
  admin = await db(ADMIN_DB);
});
afterAll(async () => {
  await admin.end();
});

function wrong(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, '0');
}

describe('SEC-OTP CMP-004 citizen OTP', () => {
  it('locks the challenge after 5 wrong codes; the right code is then refused; LOCKED is persisted', async () => {
    const { challenge_id } = await otpChallenge(syntheticMobile());
    const code = await inboxCode(challenge_id);
    for (let i = 0; i < 5; i += 1) {
      const r = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
        body: { challenge_id, code: wrong(code) },
      });
      expect(r.status).toBe(401);
    }
    const right = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id, code },
    });
    expect(right.status).toBe(401);
    expect(right.body['session_token']).toBeUndefined();
    const row = await admin.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1',
      [challenge_id],
    );
    expect(row.rows[0]).toEqual({ status: 'LOCKED', attempts: 5 });
  });

  it('lockout is also enforced through the BFF (same generic message for wrong/locked)', async () => {
    const mobile = syntheticMobile();
    const ch = await call(CITIZEN_BFF, 'POST', '/api/portal/otp/challenges', { body: { mobile } });
    const code = (ch.body['simulated_sms'] as { code: string }).code;
    const msgs = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const r = await call(CITIZEN_BFF, 'POST', '/api/portal/session', {
        body: { challenge_id: ch.body['challenge_id'], code: i < 5 ? wrong(code) : code },
      });
      expect(r.status).toBe(401);
      expect(r.headers.get('set-cookie')).toBeNull();
      msgs.add(String(r.body['message']));
    }
    expect(msgs.size).toBe(1);
  });

  it('a verified challenge cannot be replayed', async () => {
    const { challenge_id } = await otpChallenge(syntheticMobile());
    const code = await inboxCode(challenge_id);
    const first = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id, code },
    });
    expect(first.status).toBe(200);
    const again = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id, code },
    });
    expect(again.status).toBe(401);
    expect(again.body['session_token']).toBeUndefined();
  });

  it('challenge response is indistinguishable for new and existing numbers (host and BFF)', async () => {
    const existing = await citizenOnHost();
    const shape = (b: Record<string, unknown>) => Object.keys(b).sort().join(',');
    const hostNew = (await otpChallenge(syntheticMobile())).res;
    const hostOld = (await otpChallenge(existing.mobile)).res;
    expect(hostOld.status).toBe(hostNew.status);
    expect(shape(hostOld.body)).toBe(shape(hostNew.body));
    const bNew = await call(CITIZEN_BFF, 'POST', '/api/portal/otp/challenges', {
      body: { mobile: syntheticMobile() },
    });
    const bOld = await call(CITIZEN_BFF, 'POST', '/api/portal/otp/challenges', {
      body: { mobile: existing.mobile },
    });
    expect(bOld.status).toBe(bNew.status);
    expect(shape(bOld.body)).toBe(shape(bNew.body));
  });

  it('FINDING: a non-ACTIVE citizen principal is distinguishable at challenge time', async () => {
    const c = await citizenOnHost();
    await admin.query(
      "UPDATE sf_identity.citizen_principal SET status = 'LOCKED' WHERE citizen_id = $1",
      [c.citizen_id],
    );
    try {
      const res = (await otpChallenge(c.mobile)).res;
      const normal = (await otpChallenge(syntheticMobile())).res;
      expect
        .soft(
          res.status,
          `locked principal answered ${res.status} ${String(res.body['error_code'])}`,
        )
        .toBe(normal.status);
    } finally {
      await admin.query(
        "UPDATE sf_identity.citizen_principal SET status = 'ACTIVE' WHERE citizen_id = $1",
        [c.citizen_id],
      );
    }
  });

  it('FINDING: challenges per number are not capped and earlier challenges stay PENDING', async () => {
    const mobile = syntheticMobile();
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const { challenge_id, res } = await otpChallenge(mobile);
      expect(res.status).toBe(200);
      ids.push(challenge_id);
    }
    const pending = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM sf_identity.citizen_otp_challenge WHERE challenge_id = ANY($1::uuid[]) AND status = 'PENDING'",
      [ids],
    );
    // Each PENDING challenge allows 5 guesses; unbounded concurrent challenges defeat the lockout.
    expect
      .soft(Number(pending.rows[0]?.n), 'concurrently PENDING challenges for one number')
      .toBeLessThanOrEqual(1);
  });

  it('OTP inbox: unknown/non-UUID ids are 404 and responses are no-store', async () => {
    expect(
      (await call(API, 'GET', '/v1/simulated/otp-inbox/0d15ba00-0000-4000-8000-000000000000'))
        .status,
    ).toBe(404);
    expect((await call(API, 'GET', '/v1/simulated/otp-inbox/..%2F..%2Fhealth')).status).toBe(404);
    const { challenge_id } = await otpChallenge(syntheticMobile());
    const r = await call(API, 'GET', `/v1/simulated/otp-inbox/${challenge_id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('rate-limit key ignores client-supplied X-Forwarded-For (no bucket rotation)', async () => {
    const remaining: number[] = [];
    for (const xff of ['203.0.113.10', '203.0.113.11', '198.51.100.7']) {
      const r = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
        headers: { 'x-forwarded-for': xff, 'x-real-ip': xff },
        body: { challenge_id: '0d15ba00-0000-4000-8000-000000000000', code: '000000' },
      });
      const h = r.headers.get('x-ratelimit-remaining');
      expect(h).not.toBeNull();
      remaining.push(Number(h));
    }
    expect(remaining[1]).toBeLessThan(remaining[0] as number);
    expect(remaining[2]).toBeLessThan(remaining[1] as number);
  });
});
