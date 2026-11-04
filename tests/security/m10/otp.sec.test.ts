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

  it('F-10: a non-ACTIVE citizen principal is indistinguishable at challenge time', async () => {
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

  it('F-06: a new challenge supersedes earlier PENDING challenges for the number', async () => {
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

  it('F-06: a superseded challenge cannot be verified with its own (correct) code', async () => {
    const mobile = syntheticMobile();
    const first = await otpChallenge(mobile);
    const code = await inboxCode(first.challenge_id);
    await otpChallenge(mobile);
    const r = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id: first.challenge_id, code },
    });
    expect(r.status).toBe(401);
    expect(r.body['session_token']).toBeUndefined();
  });

  it('F-06: concurrent challenge requests for one number leave at most one PENDING', async () => {
    const mobile = syntheticMobile();
    const results = await Promise.all(Array.from({ length: 20 }, () => otpChallenge(mobile)));
    const ids = results.filter((x) => x.res.status === 200).map((x) => x.challenge_id);
    expect(ids.length).toBeGreaterThan(0);
    const pending = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM sf_identity.citizen_otp_challenge WHERE challenge_id = ANY($1::uuid[]) AND status = 'PENDING'",
      [ids],
    );
    expect
      .soft(Number(pending.rows[0]?.n), 'PENDING after 20 concurrent requests')
      .toBeLessThanOrEqual(1);
  });

  it('F-06: wrong-code budget is per channel, not per challenge (sequential re-challenge)', async () => {
    const mobile = syntheticMobile();
    let failures = 0;
    for (let round = 0; round < 4; round += 1) {
      const { challenge_id } = await otpChallenge(mobile);
      const code = await inboxCode(challenge_id);
      for (let i = 0; i < 5; i += 1) {
        const r = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
          body: { challenge_id, code: wrong(code) },
        });
        if (r.status === 401) failures += 1;
      }
    }
    expect(failures).toBe(20);
    const next = await otpChallenge(mobile);
    const code = await inboxCode(next.challenge_id).catch(() => null);
    const verify = code
      ? await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
          body: { challenge_id: next.challenge_id, code },
        })
      : null;
    // Expected (secure): after 20 wrong codes in seconds the channel is throttled/locked for a period.
    expect
      .soft(
        next.res.status === 200 && verify?.status === 200,
        `20 wrong codes then challenge ${next.res.status}, verify ${verify?.status}`,
      )
      .toBe(false);
  });
});
