import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgQrRepository } from '../../src/repo/pg.js';
import {
  CRED_1,
  ctxFor,
  issueBody,
  publicVerifierCtx,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import { asSqlPool, closeHarness, resetData, setupHarness, type Harness } from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: Harness;

beforeAll(async () => {
  db = await setupHarness();
});
afterAll(async () => {
  await closeHarness(db);
});
beforeEach(async () => {
  await resetData(db.admin);
});

function pgHarness() {
  return makeHarness(new PgQrRepository(asSqlPool(db.rt)));
}

async function count(sql: string): Promise<number> {
  return Number((await db.admin.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
}

describe('API flow on PostgreSQL through sf_cmp023_rw', () => {
  it('mint, verify, live revocation and audit trail', async () => {
    const h = pgHarness();
    const minted = await h.call('POST', '/v1/qr/tokens', issueBody());
    expect(minted.status).toBe(201);
    const token = (minted.body as Body)['token'] as Body;
    h.state.ctx = publicVerifierCtx(TENANT_A);
    const ok = await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`);
    expect((ok.body as Body)['public_view']['registry_status']).toBe('ACTIVE');
    h.registry.setStatus(TENANT_A, CRED_1, 'REVOKED');
    const revoked = await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`);
    expect((revoked.body as Body)['public_view']['registry_status']).toBe('REVOKED');
    expect(await count('SELECT count(*) AS n FROM sf_qr.verification_token')).toBe(1);
    expect(
      await count(`SELECT count(*) AS n FROM sf_qr.outbox_event WHERE topic = 'sf.qr.events.v1'`),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM sf_qr.outbox_event WHERE topic = 'sf.audit.ingest.v1'`,
      ),
    ).toBe(3);
    const leaked = await db.admin.query(
      `SELECT 1 FROM sf_qr.outbox_event WHERE envelope::text LIKE '%' || $1 || '%'`,
      [token['opaque_token']],
    );
    expect(leaked.rows).toHaveLength(0);
    expect(h.probe.violations).toBe(0);
  });

  it('tenant-negative: tenant B cannot verify or read tenant A tokens', async () => {
    const h = pgHarness();
    const token = ((await h.call('POST', '/v1/qr/tokens', issueBody())).body as Body)[
      'token'
    ] as Body;
    h.state.ctx = publicVerifierCtx(TENANT_B);
    expect((await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`)).status).toBe(
      404,
    );
    h.state.ctx = ctxFor(TENANT_B);
    expect((await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`)).status).toBe(404);
  });

  it('replay, re-mint and concurrent mints converge on a single token row', async () => {
    const h = pgHarness();
    const a = await h.call('POST', '/v1/qr/tokens', issueBody(), { key: 'int-key-00000001' });
    const replay = await h.call('POST', '/v1/qr/tokens', issueBody(), { key: 'int-key-00000001' });
    expect([a.status, replay.status]).toEqual([201, 201]);
    expect((replay.body as Body)['token']['token_id']).toBe((a.body as Body)['token']['token_id']);
    const both = await Promise.all([
      h.call(
        'POST',
        '/v1/qr/tokens',
        issueBody({ credential_id: '23232323-2323-4323-8323-232323232323' }),
        { key: 'int-key-00000002' },
      ),
      h.call(
        'POST',
        '/v1/qr/tokens',
        issueBody({ credential_id: '23232323-2323-4323-8323-232323232323' }),
        { key: 'int-key-00000003' },
      ),
    ]);
    const statuses = both.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect([200, 409]).toContain(statuses.find((s) => s !== 201));
    expect(await count('SELECT count(*) AS n FROM sf_qr.verification_token')).toBe(2);
  });

  it('a registry outage fails closed and is audited FAILED in the same database', async () => {
    const h = pgHarness();
    const token = ((await h.call('POST', '/v1/qr/tokens', issueBody())).body as Body)[
      'token'
    ] as Body;
    h.registry.fail = true;
    h.state.ctx = publicVerifierCtx(TENANT_A);
    const r = await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`);
    expect(r.status).toBe(503);
    const reasons = await db.admin.query<{ r: string }>(
      `SELECT envelope->'data'->>'reason' AS r FROM sf_qr.outbox_event
        WHERE topic = 'sf.audit.ingest.v1' AND envelope->'data'->>'result' = 'FAILED'`,
    );
    expect(reasons.rows.map((x) => x.r)).toEqual(['REGISTRY_UNAVAILABLE']);
  });
});
