import { randomUUID } from 'node:crypto';
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
  otpChallenge as rawChallenge,
  syntheticMobile,
} from './lib/lab';

const issued = new Map<string, string[]>();
function remember(mobile: string, id: unknown): void {
  if (typeof id === 'string') issued.set(mobile, [...(issued.get(mobile) ?? []), id]);
}
async function otpChallenge(mobile: string): ReturnType<typeof rawChallenge> {
  const r = await rawChallenge(mobile);
  if (r.res.status === 200) remember(mobile, r.res.body['challenge_id']);
  return r;
}

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
      const { challenge_id, res } = await otpChallenge(mobile);
      if (res.status !== 200) break;
      failures += await burn(challenge_id, 5);
    }
    const next = await otpChallenge(mobile);
    const code = next.res.status === 200 ? await inboxCode(next.challenge_id) : null;
    const verify = code
      ? await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
          body: { challenge_id: next.challenge_id, code },
        })
      : null;
    // Secure: after repeated lockouts in seconds the channel is throttled for a period.
    expect
      .soft(
        next.res.status === 200 && verify?.status === 200,
        `${failures} wrong codes then challenge ${next.res.status}, verify ${verify?.status}`,
      )
      .toBe(false);
    expect(next.res.status).toBe(429);
    expect(next.res.body['error_code']).toBe('SF-RATE-001');
  });

  it('F-06: 50 concurrent challenge requests for one number leave at most one PENDING', async () => {
    const mobile = syntheticMobile();
    const results = await Promise.all(Array.from({ length: 50 }, () => otpChallenge(mobile)));
    const ids = results.filter((x) => x.res.status === 200).map((x) => x.challenge_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(results.every((x) => x.res.status === 200)).toBe(true);
    expect(await pendingFor(mobile)).toBeLessThanOrEqual(1);
  });

  it('F-06: budget counts across abandoned/superseded challenges (5 x 2 wrong, never LOCKED)', async () => {
    const mobile = syntheticMobile();
    for (let round = 0; round < 5; round += 1) {
      const { challenge_id, res } = await otpChallenge(mobile);
      expect(res.status).toBe(200);
      expect(await burn(challenge_id, 2)).toBe(2);
    }
    const next = await otpChallenge(mobile);
    expect(next.res.status).toBe(429);
    expect(next.res.body['challenge_id']).toBeUndefined();
  });

  it('F-06: maximum wrong guesses per number per window is bounded (issuance-only check)', async () => {
    // Worst case: reach budget-1 failures, then obtain one more fresh challenge (5 more guesses).
    const mobile = syntheticMobile();
    let guesses = 0;
    const a = await otpChallenge(mobile);
    guesses += await burn(a.challenge_id, 5);
    const b = await otpChallenge(mobile);
    guesses += await burn(b.challenge_id, 4);
    const c = await otpChallenge(mobile);
    expect(c.res.status).toBe(200);
    guesses += await burn(c.challenge_id, 5);
    for (let i = 0; i < 5; i += 1) {
      const more = await otpChallenge(mobile);
      expect(more.res.status).toBe(429);
    }
    expect(guesses).toBe(14);
    expect(await attemptsFor(mobile)).toBe(14);
  });

  it('F-06: parallel wrong verifies on one challenge cannot exceed max_attempts', async () => {
    const mobile = syntheticMobile();
    const { challenge_id } = await otpChallenge(mobile);
    const code = await inboxCode(challenge_id);
    const rs = await Promise.all(
      Array.from({ length: 25 }, () =>
        call(API, 'POST', '/v1/identity/citizen/otp/verify', {
          body: { challenge_id, code: wrong(code) },
        }),
      ),
    );
    expect(rs.every((r) => r.status === 401)).toBe(true);
    const row = await admin.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1',
      [challenge_id],
    );
    expect(row.rows[0]).toEqual({ status: 'LOCKED', attempts: 5 });
  });

  it('F-06: concurrent challenge storm at budget-1 still yields one PENDING and then throttles', async () => {
    const mobile = syntheticMobile();
    const a = await otpChallenge(mobile);
    await burn(a.challenge_id, 5);
    const b = await otpChallenge(mobile);
    await burn(b.challenge_id, 4);
    const storm = await Promise.all(Array.from({ length: 30 }, () => otpChallenge(mobile)));
    expect(await pendingFor(mobile)).toBeLessThanOrEqual(1);
    const live = storm.filter((x) => x.res.status === 200).map((x) => x.challenge_id);
    // 401 on a superseded challenge is not a guess; count attempts that the DB actually recorded.
    for (const id of live) await burn(id, 5);
    expect(await attemptsFor(mobile)).toBeLessThanOrEqual(14);
    expect((await otpChallenge(mobile)).res.status).toBe(429);
  });

  it('F-06: throttling one number does not affect another', async () => {
    const victim = syntheticMobile();
    await exhaust(victim);
    expect((await otpChallenge(victim)).res.status).toBe(429);
    const other = await citizenOnHost(syntheticMobile());
    expect(other.token.length).toBeGreaterThan(0);
  });

  it('F-06: the 429 is identical for registered, never-verified and LOCKED-principal numbers', async () => {
    const registered = await citizenOnHost();
    const fresh = syntheticMobile();
    const locked = await citizenOnHost();
    for (const m of [registered.mobile, fresh, locked.mobile]) await exhaust(m);
    await admin.query(
      "UPDATE sf_identity.citizen_principal SET status = 'LOCKED' WHERE citizen_id = $1",
      [locked.citizen_id],
    );
    try {
      const rs = [
        (await otpChallenge(registered.mobile)).res,
        (await otpChallenge(fresh)).res,
        (await otpChallenge(locked.mobile)).res,
      ];
      const sig = rs.map((r) =>
        JSON.stringify({
          s: r.status,
          e: r.body['error_code'],
          m: r.body['message'],
          k: Object.keys(r.body).sort(),
          ra: r.headers.get('retry-after'),
        }),
      );
      expect(rs[0]?.status).toBe(429);
      expect(new Set(sig).size).toBe(1);
    } finally {
      await admin.query(
        "UPDATE sf_identity.citizen_principal SET status = 'ACTIVE' WHERE citizen_id = $1",
        [locked.citizen_id],
      );
    }
  });

  it('F-06: idempotent replay cannot bypass the budget or resurrect a guessable challenge', async () => {
    const mobile = syntheticMobile();
    const key = `sec-${randomUUID()}`;
    const first = await challengeWithKey(mobile, key);
    expect(first.status).toBe(200);
    const firstId = String(first.body['challenge_id']);
    const firstCode = await inboxCode(firstId);
    await exhaust(mobile);
    const replay = await challengeWithKey(mobile, key);
    // A replay may return the stored response, but must not issue a new live challenge.
    if (replay.status === 200) expect(String(replay.body['challenge_id'])).toBe(firstId);
    expect(await pendingFor(mobile)).toBe(0);
    const v = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id: firstId, code: firstCode },
    });
    expect(v.status).toBe(401);
    const k2 = `sec-${randomUUID()}`;
    expect((await challengeWithKey(mobile, k2)).status).toBe(429);
    // The refused key was not persisted as a success; replaying it is still refused.
    expect((await challengeWithKey(mobile, k2)).status).toBe(429);
    const crossKey = await challengeWithKey(syntheticMobile(), key);
    expect(crossKey.status).not.toBe(200);
  });

  it('F-06: the budget window is 15 minutes, keyed on challenge creation', async () => {
    const mobile = syntheticMobile();
    await exhaust(mobile);
    expect((await otpChallenge(mobile)).res.status).toBe(429);
    await shiftChallenges(mobile, 14);
    expect((await otpChallenge(mobile)).res.status).toBe(429);
    await shiftChallenges(mobile, 2);
    const after = await otpChallenge(mobile);
    expect(after.res.status).toBe(200);
    const code = await inboxCode(after.challenge_id);
    const v = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id: after.challenge_id, code },
    });
    expect(v.status).toBe(200);
  });
});

async function burn(challengeId: string, n: number): Promise<number> {
  const code = await inboxCode(challengeId);
  let failures = 0;
  for (let i = 0; i < n; i += 1) {
    const r = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id: challengeId, code: wrong(code) },
    });
    if (r.status === 401) failures += 1;
  }
  return failures;
}

async function exhaust(mobile: string): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    const { challenge_id, res } = await otpChallenge(mobile);
    expect(res.status).toBe(200);
    await burn(challenge_id, 5);
  }
}

async function challengeWithKey(mobile: string, key: string) {
  const r = await call(API, 'POST', '/v1/identity/citizen/otp/challenges', {
    body: { channel: `+91${mobile}` },
    headers: { 'idempotency-key': key },
  });
  if (r.status === 200) remember(mobile, r.body['challenge_id']);
  return r;
}

const hashes = new Map<string, string>();
async function channelHashOf(mobile: string): Promise<string> {
  const known = hashes.get(mobile);
  if (known) return known;
  const r = await admin.query<{ channel_hash: string }>(
    'SELECT channel_hash FROM sf_identity.citizen_otp_challenge WHERE challenge_id = ANY($1::uuid[]) LIMIT 1',
    [issued.get(mobile) ?? []],
  );
  const h = r.rows[0]?.channel_hash;
  if (!h) throw new Error('no known challenge for number');
  hashes.set(mobile, h);
  return h;
}

async function pendingFor(mobile: string): Promise<number> {
  const h = await channelHashOf(mobile);
  const r = await admin.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM sf_identity.citizen_otp_challenge WHERE channel_hash = $1 AND status = 'PENDING'",
    [h],
  );
  return Number(r.rows[0]?.n);
}

async function attemptsFor(mobile: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    'SELECT coalesce(sum(attempts), 0)::text AS n FROM sf_identity.citizen_otp_challenge WHERE channel_hash = $1',
    [await channelHashOf(mobile)],
  );
  return Number(r.rows[0]?.n);
}

async function shiftChallenges(mobile: string, minutes: number): Promise<void> {
  const h = await channelHashOf(mobile);
  await admin.query(
    `UPDATE sf_identity.citizen_otp_challenge
        SET created_at = created_at - make_interval(mins => $2),
            expires_at = expires_at - make_interval(mins => $2)
      WHERE channel_hash = $1`,
    [h, minutes],
  );
}
