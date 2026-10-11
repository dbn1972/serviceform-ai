import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerRecommendation } from '../../src/plugin.js';
import { PgRecommendationRepository } from '../../src/repo/pg.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { FakeGateway } from '../doubles/fake-gateway.js';
import {
  CITIZEN_A,
  CITIZEN_B,
  OFFICER,
  POLICY,
  REC_BODY,
  SVC_1,
  T1,
  T2,
  MemoryCatalogue,
  MemoryConsent,
  MemoryProfile,
  ctx,
  seedCatalogue,
} from '../doubles/fixtures.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

describe('CMP-007 API over PostgreSQL FORCE RLS', () => {
  let db: Harness;
  let app: FastifyInstance;
  let repo: PgRecommendationRepository;
  const gateway = new FakeGateway();
  const consent = new MemoryConsent();
  let n = 0;

  async function call(
    tenant: string,
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    actor: { type: 'CITIZEN' | 'OFFICER'; id: string } = { type: 'CITIZEN', id: CITIZEN_A },
    key?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const token = `pg-${tenant}-${actor.id}`;
    fixtures.set(token, ctx(tenant, actor));
    n += 1;
    const res = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'POST' && !url.endsWith('/disposition')
          ? { 'idempotency-key': key ?? `pg-key-${n}-${randomUUID()}` }
          : {}),
      },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeAll(async () => {
    db = await setupHarness();
    repo = new PgRecommendationRepository(db.rt);
    fixtures.clear();
    const catalogue = new MemoryCatalogue();
    seedCatalogue(catalogue);
    for (const t of [T1, T2]) consent.grant(t, CITIZEN_A, 'SERVICE_DISCOVERY');
    consent.grant(T1, CITIZEN_B, 'SERVICE_DISCOVERY');
    gateway.inTxProbe = () => repo.inTransaction();
    app = Fastify({ logger: false });
    await registerRecommendation(app, {
      pool: db.rt,
      resolveContext: fixtureResolver,
      authorizer: new ContractAuthorizer(),
      catalogue,
      consent,
      profile: new MemoryProfile(),
      gateway,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closeHarness(db);
  });

  it('persists a recommendation, replays idempotently, and writes outbox + audit atomically', async () => {
    const officer = { type: 'OFFICER' as const, id: OFFICER };
    const policy = await call(T1, 'POST', '/v1/recommendation-policies', POLICY, officer);
    expect(policy.status).toBe(201);
    const key = `pg-idem-${randomUUID()}`;
    const first = await call(T1, 'POST', '/v1/recommendations', REC_BODY, undefined, key);
    expect(first.status).toBe(201);
    expect(first.body['status']).toBe('GENERATED');
    const again = await call(T1, 'POST', '/v1/recommendations', REC_BODY, undefined, key);
    expect(again.body).toEqual(first.body);
    expect(gateway.calls).toBe(1);
    const id = String(first.body['recommendation_id']);

    const rows = await db.admin.query<{ status: string; authoritative: boolean; n: string }>(
      `SELECT status, authoritative, (SELECT count(*) FROM sf_recommendation.recommendation)::text AS n
         FROM sf_recommendation.recommendation WHERE recommendation_id = $1`,
      [id],
    );
    expect(rows.rows[0]).toMatchObject({ status: 'GENERATED', authoritative: false, n: '1' });
    const outbox = await db.admin.query<{ event_type: string; topic: string }>(
      `SELECT event_type, topic FROM sf_recommendation.outbox_event ORDER BY seq`,
    );
    expect(outbox.rows.map((r) => r.event_type)).toEqual([
      'AuditEventSubmitted',
      'RecommendationRequested',
      'AuditEventSubmitted',
      'RecommendationGenerated',
      'AuditEventSubmitted',
    ]);
    const stored = await db.admin.query<{ dump: string }>(
      `SELECT r::text AS dump FROM sf_recommendation.recommendation r WHERE recommendation_id = $1`,
      [id],
    );
    expect(stored.rows[0]?.dump).not.toMatch(/output_text|prompt_text/);

    const selected = await call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'SELECT',
      service_id: SVC_1,
    });
    expect(selected.body['status']).toBe('SELECTED');
    const second = await call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'DISMISS',
    });
    expect(second.status).toBe(409);
  });

  it('hides recommendations from other tenants and other citizens; FAILED persists with fallback', async () => {
    const created = await call(T1, 'POST', '/v1/recommendations', REC_BODY);
    const id = String(created.body['recommendation_id']);
    expect((await call(T2, 'GET', `/v1/recommendations/${id}`)).status).toBe(404);
    expect(
      (
        await call(T1, 'GET', `/v1/recommendations/${id}`, undefined, {
          type: 'CITIZEN',
          id: CITIZEN_B,
        })
      ).status,
    ).toBe(404);
    gateway.scenario = 'unavailable';
    const failed = await call(T1, 'POST', '/v1/recommendations', REC_BODY);
    gateway.scenario = 'success';
    expect(failed.status).toBe(503);
    const failedRow = await db.admin.query<{ recommendation_id: string; rejection_code: string }>(
      `SELECT recommendation_id, rejection_code FROM sf_recommendation.recommendation
        WHERE status = 'FAILED'`,
    );
    expect(failedRow.rows).toHaveLength(1);
    expect(failedRow.rows[0]?.rejection_code).toBe('GATEWAY_UNAVAILABLE');
    const view = await call(
      T1,
      'GET',
      `/v1/recommendations/${failedRow.rows[0]?.recommendation_id}`,
    );
    expect(view.body['fallback']).toBe('NON_AI_DISCOVERY');
  });

  it('refuses unsafe model output at the database boundary: nothing authoritative is stored', async () => {
    gateway.scenario = 'binding_decision';
    const res = await call(T1, 'POST', '/v1/recommendations', REC_BODY);
    gateway.scenario = 'success';
    expect(res.status).toBe(503);
    const bad = await db.admin.query(
      `SELECT 1 FROM sf_recommendation.recommendation
        WHERE authoritative OR statutory_decision OR NOT non_authoritative`,
    );
    expect(bad.rows).toHaveLength(0);
    const dump = await db.admin.query<{ t: string }>(
      `SELECT string_agg(items::text || reason_codes::text, ' ') AS t FROM sf_recommendation.recommendation`,
    );
    expect(dump.rows[0]?.t ?? '').not.toMatch(/ELIGIBLE/);
  });
});
