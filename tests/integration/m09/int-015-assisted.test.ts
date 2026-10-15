import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate } from '@serviceform/contracts';
import { buildApp } from '../../../apps/api/src/app.js';
import { buildAssistedSessionService } from '../../../services/cmp-057-assisted-service/src/index.js';
import {
  CANARY,
  CITIZEN_1,
  CITIZEN_2,
  config,
  ContextState,
  ctxFor,
  idemHeaders,
  OFFICER_1,
  OFFICER_2,
  RecordingAuthorizer,
  silentLogger,
  T1,
  T2,
} from './support/fixtures.js';
import { MemoryAssistedRepository } from './support/memory-repos.js';
import { validateM09 } from './support/m09-schemas.js';

/**
 * INT-015 host seam: CMP-036 host -> CMP-057 neutral API -> real AssistedSessionService ->
 * tenant-partitioned memory repository + recording verification (CMP-004/005/030 stand-ins).
 * No representation statute is modelled; authority is an opaque synthetic ref only.
 */
const FIXED_NOW = new Date('2026-10-15T09:00:00.000Z');
const OFFICER = ctxFor(T1, OFFICER_1, 'OFFICER');

class RecordingVerification {
  readonly calls: Array<{ tenant: string; citizen: string; inTx: boolean }> = [];
  inTenant = new Set<string>([`${T1}|${CITIZEN_1}`]);
  fail = false;
  constructor(private readonly repo: MemoryAssistedRepository) {}
  applicantInTenant = async (ctx: { tenant_id: string }, citizenId: string) => {
    this.calls.push({ tenant: ctx.tenant_id, citizen: citizenId, inTx: this.repo.inTransaction() });
    if (this.fail) throw new Error('identity registry unavailable');
    return this.inTenant.has(`${ctx.tenant_id}|${citizenId}`);
  };
  consentCaptured = async () => true;
}

interface Harness {
  app: FastifyInstance;
  state: ContextState;
  repo: MemoryAssistedRepository;
  authz: RecordingAuthorizer;
  verification: RecordingVerification;
}

async function harness(): Promise<Harness> {
  const repo = new MemoryAssistedRepository();
  const authz = new RecordingAuthorizer();
  const verification = new RecordingVerification(repo);
  const state = new ContextState(OFFICER);
  const service = buildAssistedSessionService({
    repository: repo,
    authorizer: authz,
    verification,
    clock: () => FIXED_NOW,
  });
  const app = await buildApp(config, {
    logger: silentLogger(),
    m09: { assisted: { service, resolveContext: state.resolve } },
  });
  return { app, state, repo, authz, verification };
}

async function start(h: Harness, key: string, payload: object) {
  return h.app.inject({
    method: 'POST',
    url: '/v1/assisted/sessions',
    headers: idemHeaders(key),
    payload,
  });
}

function sessionIdOf(body: unknown): string {
  return (body as { assisted_session: { session_id: string } }).assisted_session.session_id;
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

describe('INT-015 assisted / omnichannel session through the host (CMP-057)', () => {
  it('operator starts a COUNTER session for an in-tenant applicant; projection matches FROZEN contract', async () => {
    h = await harness();
    const res = await start(h, 'assist-key-0001', {
      channel: 'COUNTER',
      applied_for_citizen_id: CITIZEN_1,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { assisted_session: Record<string, unknown> };
    const v = validateM09('assisted-session', body.assisted_session);
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
    expect(body.assisted_session).toMatchObject({
      tenant_id: T1,
      applied_by_actor_id: OFFICER_1,
      applied_for_citizen_id: CITIZEN_1,
      applied_by_distinct_from_applied_for: true,
    });
    expect(h.repo.store.tenants()).toEqual([T1]);
  });

  it('applied_by == applied_for is refused (no self-assisted session)', async () => {
    h = await harness();
    h.state.ctx = ctxFor(T1, CITIZEN_1, 'CITIZEN');
    const res = await start(h, 'assist-key-0002', {
      channel: 'AUTHORIZED_REPRESENTATIVE',
      applied_for_citizen_id: CITIZEN_1,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(h.repo.store.tenant(T1).sessions.size).toBe(0);
  });

  it('applicant not in the caller tenant → SF-TEN-002; check uses the server tenant, outside any tx', async () => {
    h = await harness();
    const res = await start(h, 'assist-key-0003', {
      channel: 'COUNTER',
      applied_for_citizen_id: CITIZEN_2,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(h.verification.calls).toEqual([{ tenant: T1, citizen: CITIZEN_2, inTx: false }]);
    expect(h.repo.store.tenant(T1).sessions.size).toBe(0);
  });

  it('verification port unavailable → fail closed SF-INT-001, no session written', async () => {
    h = await harness();
    h.verification.fail = true;
    const res = await start(h, 'assist-key-0004', {
      channel: 'COUNTER',
      applied_for_citizen_id: CITIZEN_1,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(res.json()).toMatchObject({ error_code: 'SF-INT-001' });
    expect(h.repo.store.tenant(T1).sessions.size).toBe(0);
  });

  it('a citizen may not open an operator-only COUNTER session', async () => {
    h = await harness();
    h.state.ctx = ctxFor(T1, CITIZEN_2, 'CITIZEN');
    const res = await start(h, 'assist-key-0005', {
      channel: 'COUNTER',
      applied_for_citizen_id: CITIZEN_1,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
  });

  it('read visibility: applied_by and applied_for may read; an unrelated officer may not', async () => {
    h = await harness();
    const id = sessionIdOf(
      (
        await start(h, 'assist-key-0006', { channel: 'COUNTER', applied_for_citizen_id: CITIZEN_1 })
      ).json(),
    );
    expect((await h.app.inject({ method: 'GET', url: `/v1/assisted/sessions/${id}` })).statusCode).toBe(200);
    h.state.ctx = ctxFor(T1, CITIZEN_1, 'CITIZEN');
    expect((await h.app.inject({ method: 'GET', url: `/v1/assisted/sessions/${id}` })).statusCode).toBe(200);
    h.state.ctx = ctxFor(T1, OFFICER_2, 'OFFICER');
    const other = await h.app.inject({ method: 'GET', url: `/v1/assisted/sessions/${id}` });
    expect(other.statusCode).toBe(404);
    expect(other.body).not.toContain(CITIZEN_1);
  });

  it('cross-tenant read: a T1 session is invisible from T2 (CROSS_TENANT_LEAKAGE=0)', async () => {
    h = await harness();
    const id = sessionIdOf(
      (
        await start(h, 'assist-key-0007', { channel: 'COUNTER', applied_for_citizen_id: CITIZEN_1 })
      ).json(),
    );
    h.state.ctx = ctxFor(T2, OFFICER_1, 'OFFICER');
    const res = await h.app.inject({ method: 'GET', url: `/v1/assisted/sessions/${id}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(T1);
    expect(res.body).not.toContain(CITIZEN_1);
    expect(h.repo.store.tenant(T2).sessions.size).toBe(0);
  });

  it('body tenant_id is refused; mutation without Idempotency-Key is refused', async () => {
    h = await harness();
    const tenanted = await start(h, 'assist-key-0008', {
      channel: 'COUNTER',
      applied_for_citizen_id: CITIZEN_1,
      tenant_id: CANARY,
    });
    expect(tenanted.statusCode).toBe(403);
    expect(tenanted.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(tenanted.body).not.toContain(CANARY);
    const noKey = await h.app.inject({
      method: 'POST',
      url: '/v1/assisted/sessions',
      payload: { channel: 'COUNTER', applied_for_citizen_id: CITIZEN_1 },
    });
    expect(noKey.statusCode).toBe(400);
    expect(h.repo.store.tenant(T1).sessions.size).toBe(0);
  });

  it('PDP subject is the operator (never the applicant) and carries the server tenant', async () => {
    h = await harness();
    await start(h, 'assist-key-0009', { channel: 'COUNTER', applied_for_citizen_id: CITIZEN_1 });
    expect(h.authz.calls.length).toBeGreaterThan(0);
    for (const c of h.authz.calls) {
      expect(c.subject.tenant_id).toBe(T1);
      expect((c.subject as unknown as { user_id: string }).user_id).toBe(OFFICER_1);
    }
  });

  it('idempotent replay of start returns the same session; outbox carries the server tenant only', async () => {
    h = await harness();
    const payload = { channel: 'COUNTER', applied_for_citizen_id: CITIZEN_1 };
    const a = await start(h, 'assist-key-0010', payload);
    const b = await start(h, 'assist-key-0010', payload);
    expect(sessionIdOf(b.json())).toBe(sessionIdOf(a.json()));
    expect(h.repo.store.tenant(T1).sessions.size).toBe(1);
    const outbox = h.repo.store.tenant(T1).outbox;
    expect(new Set(outbox.map((o) => o.envelope.tenant_id))).toEqual(new Set([T1]));
  });
});
