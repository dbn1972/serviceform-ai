import { describe, expect, it } from 'vitest';
import { PUBLIC_VIEW_KEYS } from '../../src/domain/token.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  CRED_1,
  CRED_2,
  CRED_B1,
  CRED_DRAFT,
  ctxFor,
  ISSUED_AT,
  ISSUER_REF,
  issueBody,
  publicVerifierCtx,
  SIGNED_SHA,
  SYSTEM_1,
  TENANT_A,
  TENANT_B,
  TYPE_REF,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';
import type { MemoryQrRepository } from '../doubles/memory-repo.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function store(h: Harness, tenant = TENANT_A) {
  return (h.repo as MemoryQrRepository).tenant(tenant);
}

function audits(h: Harness, tenant = TENANT_A): Body[] {
  return store(h, tenant)
    .outbox.filter((o) => o.topic === TOPIC_AUDIT)
    .map((o) => o.envelope.data as Body);
}

async function mint(h: Harness, body: Record<string, unknown> = issueBody(), key?: string) {
  const r = await h.call('POST', '/v1/qr/tokens', body, key === undefined ? {} : { key });
  return { res: r, token: (r.body as Body)['token'] as Body };
}

async function verifyAs(h: Harness, tenant: string, opaque: string) {
  h.state.ctx = publicVerifierCtx(tenant);
  const r = await h.call('GET', `/v1/qr/verify/${opaque}`);
  h.state.ctx = ctxFor(TENANT_A);
  return r;
}

describe('issue token', () => {
  it('mints one opaque token for an ISSUED credential with a live registry status', async () => {
    const h = makeHarness();
    const { res, token } = await mint(h);
    expect(res.status).toBe(201);
    expect(token['opaque_token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token['credential_id']).toBe(CRED_1);
    expect(token['public_view']).toEqual({
      credential_type_ref: TYPE_REF,
      issuer_ref: ISSUER_REF,
      issued_at: ISSUED_AT,
      registry_status: 'ACTIVE',
      status_checked_at: '2026-10-14T10:00:00.000Z',
      signed_artifact_sha256: SIGNED_SHA,
    });
    const s = store(h);
    expect(s.tokens.size).toBe(1);
    expect(
      s.outbox.filter((o) => o.topic === TOPIC_DOMAIN).map((o) => o.envelope.event_type),
    ).toEqual(['VerificationTokenIssued']);
    expect(JSON.stringify(s.outbox)).not.toContain(token['opaque_token'] as string);
    expect(audits(h).map((a) => [a['action'], a['result']])).toEqual([
      ['QR_TOKEN_ISSUE', 'SUCCESS'],
    ]);
    expect(h.probe.violations).toBe(0);
  });

  it('re-minting for the same credential returns the existing token without a second row or event', async () => {
    const h = makeHarness();
    const first = await mint(h);
    const again = await mint(h);
    expect(again.res.status).toBe(200);
    expect(again.token['token_id']).toBe(first.token['token_id']);
    expect(again.token['opaque_token']).toBe(first.token['opaque_token']);
    expect(store(h).tokens.size).toBe(1);
    expect(store(h).outbox.filter((o) => o.topic === TOPIC_DOMAIN)).toHaveLength(1);
  });

  it('an Idempotency-Key replay re-renders the live status instead of the stored response', async () => {
    const h = makeHarness();
    const first = await mint(h, issueBody(), 'mint-key-0001');
    h.registry.setStatus(TENANT_A, CRED_1, 'SUSPENDED');
    h.clock.advance(60_000);
    const replay = await mint(h, issueBody(), 'mint-key-0001');
    expect(replay.res.status).toBe(201);
    expect(replay.token['token_id']).toBe(first.token['token_id']);
    expect(replay.token['public_view']['registry_status']).toBe('SUSPENDED');
    expect(replay.token['public_view']['status_checked_at']).toBe('2026-10-14T10:01:00.000Z');
    const stored = [...store(h).idempotency.values()][0]?.response?.body;
    expect(stored).toEqual({ token_id: first.token['token_id'] });
  });

  it('same key with a different body is an idempotency conflict', async () => {
    const h = makeHarness();
    await mint(h, issueBody(), 'mint-key-0002');
    const r = await mint(h, issueBody({ credential_id: CRED_2 }), 'mint-key-0002');
    expect(r.res.status).toBe(409);
    expect((r.res.body as Body)['error_code']).toBe('SF-APP-002');
  });

  it('re-minting with different terms is refused and audited', async () => {
    const h = makeHarness();
    await mint(h);
    const r = await mint(h, issueBody({ credential_type_ref: 'credtype:tenant-meta:0002' }));
    expect(r.res.status).toBe(409);
    expect((r.res.body as Body)['details'][0]['code']).toBe('TOKEN_EXISTS_WITH_DIFFERENT_TERMS');
    expect(audits(h).at(-1)).toMatchObject({
      result: 'FAILED',
      reason: 'TOKEN_EXISTS_WITH_DIFFERENT_TERMS',
    });
  });

  it('refuses credentials that are not ISSUED, unknown, or without a registry record', async () => {
    const h = makeHarness();
    const notIssued = await mint(h, issueBody({ credential_id: CRED_DRAFT }));
    expect(notIssued.res.status).toBe(409);
    expect((notIssued.res.body as Body)['details'][0]['code']).toBe('CREDENTIAL_NOT_ISSUED');
    const unknown = await mint(
      h,
      issueBody({ credential_id: 'c0000000-0000-4000-8000-000000000000' }),
    );
    expect(unknown.res.status).toBe(404);
    h.registry.records.delete(`${TENANT_A}|${CRED_2}`);
    const unregistered = await mint(h, issueBody({ credential_id: CRED_2 }));
    expect(unregistered.res.status).toBe(409);
    expect((unregistered.res.body as Body)['details'][0]['code']).toBe('REGISTRY_RECORD_NOT_FOUND');
    expect(store(h).tokens.size).toBe(0);
    expect(audits(h).map((a) => a['result'])).toEqual(['FAILED', 'FAILED', 'FAILED']);
  });

  it('only issuing-side actors may mint; citizens are refused before any port call', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, SYSTEM_1, 'SYSTEM');
    expect((await mint(h)).res.status).toBe(201);
    h.state.ctx = publicVerifierCtx(TENANT_A);
    const r = await mint(h, issueBody({ credential_id: CRED_2 }));
    expect(r.res.status).toBe(403);
    expect((r.res.body as Body)['details'][0]['code']).toBe('ACTOR_NOT_PERMITTED');
  });

  it('requires an Idempotency-Key and a future expires_at', async () => {
    const h = makeHarness();
    const noKey = await h.call('POST', '/v1/qr/tokens', issueBody(), { key: null });
    expect(noKey.status).toBe(400);
    expect((noKey.body as Body)['details'][0]['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const past = await mint(h, issueBody({ expires_at: '2026-10-14T09:59:59Z' }));
    expect(past.res.status).toBe(400);
    expect((past.res.body as Body)['details'][0]['code']).toBe('EXPIRES_AT_NOT_IN_FUTURE');
  });

  it('a request that tries to set a registry status is refused and nothing is stored', async () => {
    const h = makeHarness();
    const r = await mint(h, issueBody({ registry_status: 'ACTIVE' }));
    expect(r.res.status).toBe(400);
    expect((r.res.body as Body)['details'][0]['code']).toBe('STATUS_WRITE_FORBIDDEN');
    expect(store(h).tokens.size).toBe(0);
  });

  it('a failed commit leaves no token, event or audit and a retry succeeds', async () => {
    const h = makeHarness();
    (h.repo as MemoryQrRepository).failNextCommit = true;
    const failed = await mint(h, issueBody(), 'mint-key-0003');
    expect(failed.res.status).toBe(500);
    expect(store(h).tokens.size).toBe(0);
    expect(store(h).outbox).toHaveLength(0);
    expect((await mint(h, issueBody(), 'mint-key-0003')).res.status).toBe(201);
  });

  it('upstream outages fail closed with 503 and mint nothing', async () => {
    const h = makeHarness();
    h.credentials.fail = true;
    const a = await mint(h);
    expect(a.res.status).toBe(503);
    expect((a.res.body as Body)['details'][0]['code']).toBe('CREDENTIAL_UNAVAILABLE');
    h.credentials.fail = false;
    h.registry.fail = true;
    const b = await mint(h);
    expect(b.res.status).toBe(503);
    expect((b.res.body as Body)['details'][0]['code']).toBe('REGISTRY_UNAVAILABLE');
    expect(store(h).tokens.size).toBe(0);
  });
});

describe('public verification', () => {
  it('returns only the purpose-minimised view, uncacheable', async () => {
    const h = makeHarness();
    const { token } = await mint(h);
    h.clock.advance(5_000);
    const r = await verifyAs(h, TENANT_A, token['opaque_token'] as string);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const body = r.body as Body;
    expect(Object.keys(body).sort()).toEqual(['public_view', 'status_source_cmp', 'token_purpose']);
    expect(
      Object.keys(body['public_view']).every((k) =>
        (PUBLIC_VIEW_KEYS as readonly string[]).includes(k),
      ),
    ).toBe(true);
    expect(body['public_view']['registry_status']).toBe('ACTIVE');
    expect(body['public_view']['status_checked_at']).toBe('2026-10-14T10:00:05.000Z');
    const text = JSON.stringify(body);
    for (const hidden of [CRED_1, TENANT_A, token['token_id'], token['opaque_token']]) {
      expect(text).not.toContain(hidden as string);
    }
  });

  it('reads CMP-024 on every verification: revocation is visible immediately', async () => {
    const h = makeHarness();
    const opaque = (await mint(h)).token['opaque_token'] as string;
    const before = h.registry.calls;
    expect(
      ((await verifyAs(h, TENANT_A, opaque)).body as Body)['public_view']['registry_status'],
    ).toBe('ACTIVE');
    h.registry.setStatus(TENANT_A, CRED_1, 'REVOKED');
    expect(
      ((await verifyAs(h, TENANT_A, opaque)).body as Body)['public_view']['registry_status'],
    ).toBe('REVOKED');
    h.registry.setStatus(TENANT_A, CRED_1, 'REISSUED');
    expect(
      ((await verifyAs(h, TENANT_A, opaque)).body as Body)['public_view']['registry_status'],
    ).toBe('REISSUED');
    expect(h.registry.calls - before).toBe(3);
  });

  it('a registry outage fails closed even right after a successful verification (no cached fallback)', async () => {
    const h = makeHarness();
    const opaque = (await mint(h)).token['opaque_token'] as string;
    expect((await verifyAs(h, TENANT_A, opaque)).status).toBe(200);
    h.registry.fail = true;
    const r = await verifyAs(h, TENANT_A, opaque);
    expect(r.status).toBe(503);
    expect((r.body as Body)['details'][0]['code']).toBe('REGISTRY_UNAVAILABLE');
    expect(JSON.stringify(r.body)).not.toContain('ACTIVE');
  });

  it('malformed or inconsistent registry answers fail closed', async () => {
    const h = makeHarness();
    const opaque = (await mint(h)).token['opaque_token'] as string;
    const good = await h.registry.getStatus({ tenantId: TENANT_A, credentialId: CRED_1 });
    h.registry.respondWith = { ...good, status_authority_cmp: 'CMP-023' };
    expect(((await verifyAs(h, TENANT_A, opaque)).body as Body)['details'][0]['code']).toBe(
      'REGISTRY_RESPONSE_INVALID',
    );
    h.registry.respondWith = { ...good, credential_id: CRED_2 };
    expect(((await verifyAs(h, TENANT_A, opaque)).body as Body)['details'][0]['code']).toBe(
      'REGISTRY_RESPONSE_INVALID',
    );
    h.registry.respondWith = { ...good, issuer_ref: 'issuer:tenant-meta:0999' };
    expect(((await verifyAs(h, TENANT_A, opaque)).body as Body)['details'][0]['code']).toBe(
      'REGISTRY_ISSUER_MISMATCH',
    );
  });

  it('unknown and expired tokens are 404, audited by token-ref without the token itself', async () => {
    const h = makeHarness();
    const unknown = 'Z'.repeat(43);
    const r = await verifyAs(h, TENANT_A, unknown);
    expect(r.status).toBe(404);
    expect((r.body as Body)['details'][0]['code']).toBe('TOKEN_NOT_FOUND');
    const opaque = (await mint(h, issueBody({ expires_at: '2026-10-14T11:00:00Z' }))).token[
      'opaque_token'
    ] as string;
    expect((await verifyAs(h, TENANT_A, opaque)).status).toBe(200);
    h.clock.advance(60 * 60 * 1000);
    const expired = await verifyAs(h, TENANT_A, opaque);
    expect(expired.status).toBe(404);
    expect((expired.body as Body)['details'][0]['code']).toBe('TOKEN_EXPIRED');
    const text = JSON.stringify(store(h).outbox);
    expect(text).not.toContain(unknown);
    expect(text).not.toContain(opaque);
    expect(
      audits(h)
        .filter((a) => a['action'] === 'QR_TOKEN_VERIFY')
        .map((a) => a['result']),
    ).toEqual(['FAILED', 'SUCCESS', 'FAILED']);
  });

  it('malformed tokens are 400 before any lookup', async () => {
    const h = makeHarness();
    const r = await verifyAs(h, TENANT_A, 'not*a*token*at*all*xxxxxx');
    expect(r.status).toBe(400);
    expect(h.registry.calls).toBe(0);
  });

  it('PDP denial is 403 and audited DENIED; PDP outage is 503', async () => {
    const h = makeHarness();
    const opaque = (await mint(h)).token['opaque_token'] as string;
    h.authorizer.deniedActions.add('QR_TOKEN_VERIFY');
    expect((await verifyAs(h, TENANT_A, opaque)).status).toBe(403);
    expect(audits(h).at(-1)).toMatchObject({ action: 'QR_TOKEN_VERIFY', result: 'DENIED' });
    expect(audits(h).at(-1)?.['resource_id']).toMatch(/^token-ref:/);
    h.authorizer.deniedActions.clear();
    h.authorizer.fail = true;
    expect((await verifyAs(h, TENANT_A, opaque)).status).toBe(503);
  });

  it('no port is ever called while a transaction is open', async () => {
    const h = makeHarness();
    const { token } = await mint(h);
    await verifyAs(h, TENANT_A, token['opaque_token'] as string);
    await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`);
    await mint(h);
    expect(h.probe.violations).toBe(0);
  });
});

describe('registry status is read-only for CMP-023', () => {
  it('no flow changes a registry record and no stored row carries a status', async () => {
    const h = makeHarness();
    const snapshot = JSON.stringify([...h.registry.records.entries()]);
    const { token } = await mint(h);
    await verifyAs(h, TENANT_A, token['opaque_token'] as string);
    await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`);
    await mint(h, issueBody({ registry_status: 'REVOKED' }));
    expect(JSON.stringify([...h.registry.records.entries()])).toBe(snapshot);
    for (const row of store(h).tokens.values()) {
      expect(Object.keys(row).filter((k) => k.includes('status'))).toEqual([]);
    }
  });
});

describe('issuer-side token read', () => {
  it('returns the contract record with live status; citizens and unknown ids are refused', async () => {
    const h = makeHarness();
    const { token } = await mint(h);
    h.registry.setStatus(TENANT_A, CRED_1, 'SUSPENDED');
    const r = await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`);
    expect(r.status).toBe(200);
    expect((r.body as Body)['token']['public_view']['registry_status']).toBe('SUSPENDED');
    expect((await h.call('GET', '/v1/qr/tokens/c0000000-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
    expect((await h.call('GET', '/v1/qr/tokens/not-a-uuid')).status).toBe(400);
    h.state.ctx = publicVerifierCtx(TENANT_A);
    expect((await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`)).status).toBe(403);
  });
});

describe('routing and context', () => {
  it('unknown routes 404, wrong methods 400, missing context 401', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/v1/qr/nothing')).status).toBe(404);
    const m = await h.call('POST', `/v1/qr/verify/${'a'.repeat(43)}`);
    expect(m.status).toBe(400);
    expect((m.body as Body)['details'][0]['code']).toBe('METHOD_NOT_ALLOWED');
    h.state.ctx = null;
    expect((await h.call('GET', `/v1/qr/verify/${'a'.repeat(43)}`)).body).toMatchObject({
      error_code: 'SF-AUTH-001',
    });
  });

  it('client-supplied time in the query string is refused', async () => {
    const h = makeHarness();
    const r = await h.call('GET', `/v1/qr/verify/${'a'.repeat(43)}`, undefined, {
      query: { now: '2030-01-01T00:00:00Z' },
    });
    expect(r.status).toBe(400);
    expect((r.body as Body)['details'][0]['code']).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');
  });
});

describe('tenant-negative', () => {
  it('a token of tenant A does not verify under tenant B (404, no existence leak)', async () => {
    const h = makeHarness();
    const opaque = (await mint(h)).token['opaque_token'] as string;
    const r = await verifyAs(h, TENANT_B, opaque);
    expect(r.status).toBe(404);
    expect((r.body as Body)['details'][0]['code']).toBe('TOKEN_NOT_FOUND');
    expect(JSON.stringify(r.body)).not.toContain('public_view');
    expect(h.registry.calls).toBe(1);
  });

  it('tenant B cannot read tenant A token records', async () => {
    const h = makeHarness();
    const { token } = await mint(h);
    h.state.ctx = ctxFor(TENANT_B);
    const r = await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`);
    expect(r.status).toBe(404);
  });

  it('tenant B cannot mint for a tenant A credential', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_B);
    const r = await mint(h, issueBody({ credential_id: CRED_1 }));
    expect(r.res.status).toBe(404);
    expect(store(h, TENANT_B).tokens.size).toBe(0);
    expect(store(h, TENANT_A).tokens.size).toBe(0);
  });

  it('a leaked foreign credential or registry record is blocked and audited', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_B);
    h.credentials.respondWith = await h.credentials.getCredential({
      tenantId: TENANT_A,
      credentialId: CRED_1,
    });
    const a = await mint(h, issueBody({ credential_id: CRED_1 }));
    expect(a.res.status).toBe(403);
    expect((a.res.body as Body)['details'][0]['code']).toBe('CROSS_TENANT_RECORD_BLOCKED');
    h.credentials.respondWith = undefined;
    h.registry.respondWith = await h.registry.getStatus({
      tenantId: TENANT_A,
      credentialId: CRED_1,
    });
    const b = await mint(h, issueBody({ credential_id: CRED_B1 }));
    expect(b.res.status).toBe(403);
    expect((b.res.body as Body)['details'][0]['code']).toBe('CROSS_TENANT_RECORD_BLOCKED');
    expect(store(h, TENANT_B).tokens.size).toBe(0);
    expect(audits(h, TENANT_B).map((x) => x['reason'])).toEqual([
      'CROSS_TENANT_RECORD_BLOCKED',
      'CROSS_TENANT_RECORD_BLOCKED',
    ]);
  });

  it('a registry answer for another tenant never reaches a public verifier', async () => {
    const h = makeHarness();
    const opaque = (await mint(h)).token['opaque_token'] as string;
    h.registry.respondWith = {
      ...(await h.registry.getStatus({ tenantId: TENANT_A, credentialId: CRED_1 })),
      tenant_id: TENANT_B,
    };
    const r = await verifyAs(h, TENANT_A, opaque);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('public_view');
  });

  it('tenant in headers or body is refused', async () => {
    const h = makeHarness();
    for (const headers of [
      { 'x-tenant-id': TENANT_B },
      { 'X-SF-Cell': 'x' },
      { forwarded: `for=1.2.3.4;tenant=${TENANT_B}` },
    ]) {
      const r = await h.call('GET', `/v1/qr/verify/${'a'.repeat(43)}`, undefined, { headers });
      expect(r.status).toBe(403);
      expect((r.body as Body)['error_code']).toBe('SF-TEN-002');
    }
    const body = await mint(h, issueBody({ tenant_id: TENANT_B }));
    expect(body.res.status).toBe(403);
  });

  it('a context without a tenant is refused', async () => {
    const h = makeHarness();
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    const r = await h.call('GET', `/v1/qr/verify/${'a'.repeat(43)}`);
    expect(r.status).toBe(401);
    expect((r.body as Body)['error_code']).toBe('SF-TEN-001');
  });

  it('the same credential id in two tenants yields independent tokens', async () => {
    const h = makeHarness();
    const source = h.credentials.records.get(`${TENANT_A}|${CRED_1}`);
    expect(source).toBeDefined();
    h.credentials.records.set(`${TENANT_B}|${CRED_1}`, {
      ...(source as NonNullable<typeof source>),
      tenant_id: TENANT_B,
    });
    h.registry.put(TENANT_B, CRED_1, 'REVOKED', ISSUER_REF);
    const a = (await mint(h)).token;
    h.state.ctx = ctxFor(TENANT_B);
    const b = (await mint(h)).token;
    expect(b['opaque_token']).not.toBe(a['opaque_token']);
    expect(
      ((await verifyAs(h, TENANT_A, a['opaque_token'] as string)).body as Body)['public_view'][
        'registry_status'
      ],
    ).toBe('ACTIVE');
    expect(
      ((await verifyAs(h, TENANT_B, b['opaque_token'] as string)).body as Body)['public_view'][
        'registry_status'
      ],
    ).toBe('REVOKED');
    expect((await verifyAs(h, TENANT_B, a['opaque_token'] as string)).status).toBe(404);
  });

  it('PEP input binds subject and resource to the context tenant', async () => {
    const h = makeHarness();
    await mint(h);
    for (const c of h.authorizer.calls) {
      expect(c.subject.tenant_id).toBe(TENANT_A);
      expect(c.resource.tenant_id).toBe(TENANT_A);
    }
  });
});
