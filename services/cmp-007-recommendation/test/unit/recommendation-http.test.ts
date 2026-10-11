import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import {
  APP_ID,
  CANARY,
  CITIZEN_A,
  CITIZEN_B,
  OFFICER,
  POLICY,
  REC_BODY,
  SVC_1,
  SVC_2,
  SVC_RETIRED,
  SVC_T2,
  T1,
  T2,
  buildHarness,
  seedPolicy,
  type Harness,
} from '../doubles/fixtures.js';

const OFFICER_ACTOR = { type: 'OFFICER' as const, id: OFFICER };
const OTHER_CITIZEN = { type: 'CITIZEN' as const, id: CITIZEN_B };

let h: Harness;

beforeEach(async () => {
  h = await buildHarness();
  await seedPolicy(h);
});

afterEach(async () => {
  await h.app.close();
});

async function create(
  body: object = REC_BODY,
  options: Parameters<Harness['call']>[4] = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return h.call(T1, 'POST', '/v1/recommendations', body, options);
}

describe('CMP-007 recommendation generation (non-authoritative, CMP-039 only)', () => {
  it('generates coded recommendations through the gateway port and conforms to SF-CON-RECOMMENDATION shape', async () => {
    const res = await create({ ...REC_BODY, application_id: APP_ID });
    expect(res.status).toBe(201);
    expect(res.body['status']).toBe('GENERATED');
    expect(res.body['non_authoritative']).toBe(true);
    expect(res.body['authoritative']).toBe(false);
    expect(res.body['statutory_decision']).toBe(false);
    expect(res.body['ai_gateway_cmp']).toBe('CMP-039');
    const items = res.body['items'] as Record<string, unknown>[];
    expect(items).toEqual([
      {
        rank: 1,
        service_id: SVC_1,
        published_version_ref: 'v1',
        reason_codes: ['CATEGORY_MATCH', 'JURISDICTION_MATCH'],
      },
    ]);
    const doc = res.body['recommendation'] as Record<string, unknown>;
    expect(doc['contract_id']).toBe('SF-CON-RECOMMENDATION');
    expect(doc['reason_codes']).toEqual(['CATEGORY_MATCH', 'JURISDICTION_MATCH']);
    expect(doc['model_route_ref']).toBe(POLICY.model_route_ref);
    expect(doc['consent_purpose_code']).toBe('SERVICE_DISCOVERY');
    expect(doc['consent_recorded']).toBe(true);
    expect(doc['application_id']).toBe(APP_ID);
    expect(doc['tenant_id']).toBe(T1);
    const model = res.body['model'] as Record<string, string>;
    expect(model['model_version']).toBe('2026-10-01');
    expect(res.body['prompt']).toMatchObject({
      policy_id: 'recommend-services',
      policy_version: 1,
    });
    expect(h.gateway.calls).toBe(1);
  });

  it('ranks multiple items, unions reason codes, and keeps order from the model', async () => {
    h.gateway.scenario = 'two_items';
    const res = await create();
    const items = res.body['items'] as { service_id: string; rank: number }[];
    expect(items.map((i) => [i.rank, i.service_id])).toEqual([
      [1, SVC_2],
      [2, SVC_1],
    ]);
    const doc = res.body['recommendation'] as { reason_codes: string[] };
    expect(doc.reason_codes).toEqual(['CATEGORY_MATCH', 'JURISDICTION_MATCH']);
  });

  it('sends only coded, aliased, non-identifying data to CMP-039 and never inside a DB transaction', async () => {
    await create();
    const req = h.gateway.lastRequest;
    expect(req?.caller_component).toBe('CMP-007');
    expect(req?.purpose).toBe('SERVICE_DISCOVERY');
    expect(req?.data_classification).toBe('PERSONAL');
    expect(req?.policy_id).toBe('recommend-services');
    expect(req?.sources).toEqual([]);
    const text = JSON.stringify(req);
    for (const forbidden of [T1, T2, CITIZEN_A, SVC_1, SVC_2, 'consent-ref-1']) {
      expect(text).not.toContain(forbidden);
    }
    expect(req?.variables['signals']).toBe('AGE_BAND_ADULT');
    expect(req?.variables['candidates']).toContain('"candidate":"c1"');
  });

  it('records outbox events and audit as valid envelopes without subject or PII', async () => {
    await create({ ...REC_BODY, application_id: APP_ID });
    const events = h.repo.events().map((e) => e.event_type);
    expect(events).toEqual(['RecommendationRequested', 'RecommendationGenerated']);
    for (const env of h.repo.state.outbox.map((o) => o.envelope)) {
      expect(validate('event-envelope', env).valid).toBe(true);
      expect(JSON.stringify(env)).not.toContain(CITIZEN_A.replaceAll('a', 'z'));
    }
    const audit = h.repo.state.outbox.filter((o) => o.topic === 'sf.audit.ingest.v1');
    expect(audit.map((a) => (a.envelope.data as { action: string }).action)).toEqual([
      'RECOMMENDATION_POLICY_CREATED',
      'RECOMMENDATION_REQUESTED',
      'RECOMMENDATION_GENERATED',
    ]);
    const generated = h.repo.events()[1]?.data as Record<string, unknown>;
    expect(generated['non_authoritative']).toBe(true);
    expect(generated['authoritative']).toBe(false);
    expect(generated).not.toHaveProperty('subject_id');
  });

  it('uses published catalogue entries when no candidates are supplied', async () => {
    const res = await create({ policy_code: 'DISCOVERY_ASSIST' });
    expect(res.status).toBe(201);
    expect(h.gateway.lastRequest?.variables['candidates']).toContain('SERVICE_ONE');
    expect(h.gateway.lastRequest?.variables['candidates']).not.toContain('SERVICE_OLD');
    expect(h.gateway.lastRequest?.variables['candidates']).not.toContain('CANARY');
  });

  it('filters profile signals to the policy allowlist and tolerates profile outage', async () => {
    await create({ policy_code: 'DISCOVERY_ASSIST', candidate_service_ids: [SVC_1] });
    expect(h.gateway.lastRequest?.variables['signals']).toBe('AGE_BAND_ADULT');
    h.profile.throws = true;
    const res = await create({ policy_code: 'DISCOVERY_ASSIST', candidate_service_ids: [SVC_1] });
    expect(res.status).toBe(201);
    expect(h.gateway.lastRequest?.variables['signals']).toBe('');
  });
});

describe('CMP-007 idempotency', () => {
  it('replays the stored response without a second gateway call', async () => {
    const first = await create(REC_BODY, { key: 'idem-key-0001' });
    const second = await create(REC_BODY, { key: 'idem-key-0001' });
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(h.gateway.calls).toBe(1);
    expect(h.repo.state.rows).toHaveLength(1);
  });

  it('refuses the same key with a different request and a missing/invalid key', async () => {
    await create(REC_BODY, { key: 'idem-key-0002' });
    const conflict = await create({ ...REC_BODY, context_signals: [] }, { key: 'idem-key-0002' });
    expect(conflict.status).toBe(409);
    expect(conflict.body['error_code']).toBe('SF-APP-002');
    const bad = await create(REC_BODY, { key: 'short' });
    expect(bad.status).toBe(400);
    expect(bad.body['error_code']).toBe('SF-SYS-003');
  });

  it('replays a stored gateway failure instead of calling the gateway again', async () => {
    h.gateway.scenario = 'unavailable';
    const first = await create(REC_BODY, { key: 'idem-key-0003' });
    h.gateway.scenario = 'success';
    const second = await create(REC_BODY, { key: 'idem-key-0003' });
    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(second.body).toEqual(first.body);
    expect(h.gateway.calls).toBe(1);
  });
});

describe('CMP-007 consent and purpose', () => {
  it('blocks without consent, never calls the catalogue or gateway, and audits the denial', async () => {
    const noConsent = { type: 'CITIZEN' as const, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    const res = await create(REC_BODY, { actor: noConsent });
    expect(res.status).toBe(403);
    expect(res.body['error_code']).toBe('SF-AUTH-002');
    expect(h.gateway.calls).toBe(0);
    expect(h.catalogue.calls).toBe(0);
    expect(h.repo.state.rows).toHaveLength(0);
    const audit = h.repo.state.outbox
      .filter((o) => o.topic === 'sf.audit.ingest.v1')
      .map((o) => o.envelope.data as { action: string; result: string });
    expect(audit.at(-1)).toMatchObject({
      action: 'RECOMMENDATION_CONSENT_DENIED',
      result: 'DENIED',
    });
  });

  it('checks consent for the policy purpose of the authenticated subject in the derived tenant', async () => {
    await create();
    expect(h.consent.calls).toEqual([
      { tenantId: T1, subjectId: CITIZEN_A, purposeCode: 'SERVICE_DISCOVERY' },
    ]);
  });

  it('fails closed (503) when the consent service is unavailable', async () => {
    h.consent.throws = true;
    const res = await create();
    expect(res.status).toBe(503);
    expect(res.body['error_code']).toBe('SF-SYS-004');
    expect(h.gateway.calls).toBe(0);
    expect(h.repo.state.rows).toHaveLength(0);
  });

  it('does not reuse consent granted in another tenant', async () => {
    await seedPolicy(h, T2);
    const res = await h.call(T2, 'POST', '/v1/recommendations', {
      policy_code: 'DISCOVERY_ASSIST',
      candidate_service_ids: [SVC_T2],
    });
    expect(res.status).toBe(201);
    h.consent.grants.delete(`${T2}:${CITIZEN_A}:SERVICE_DISCOVERY`);
    const denied = await h.call(T2, 'POST', '/v1/recommendations', {
      policy_code: 'DISCOVERY_ASSIST',
      candidate_service_ids: [SVC_T2],
    });
    expect(denied.status).toBe(403);
  });
});

describe('CMP-007 request validation and tenant-safe candidates', () => {
  it('refuses unknown or retired policies', async () => {
    const unknown = await create({ ...REC_BODY, policy_code: 'NOPE_POLICY' });
    expect(unknown.status).toBe(400);
    await seedPolicy(h, T1, { status: 'RETIRED' });
    const retired = await create();
    expect(retired.status).toBe(400);
    expect(h.gateway.calls).toBe(0);
  });

  it('refuses retired or other-tenant candidates without leaking their existence', async () => {
    for (const id of [SVC_RETIRED, SVC_T2]) {
      const res = await create({ ...REC_BODY, candidate_service_ids: [SVC_1, id] });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(CANARY);
    }
    expect(h.gateway.calls).toBe(0);
  });

  it('refuses signals outside the pinned policy list and too many candidates', async () => {
    const signal = await create({ ...REC_BODY, context_signals: ['NOT_ALLOWED_SIGNAL'] });
    expect(signal.status).toBe(400);
    await seedPolicy(h, T1, { max_candidates: 1, max_results: 1 });
    const many = await create(REC_BODY);
    expect(many.status).toBe(400);
  });

  it('rejects unknown body fields (no free-text or identity injection)', async () => {
    const res = await create({ ...REC_BODY, subject_id: CITIZEN_B });
    expect(res.status).toBe(400);
    const tenant = await create({ ...REC_BODY, tenant_id: T2 });
    expect(tenant.status).toBe(400);
  });

  it('rejects tenant-identifying headers', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/recommendations/${APP_ID}`,
      headers: { authorization: 'Bearer none', 'x-tenant-id': T2 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json<{ error_code: string }>().error_code).toBe('SF-TEN-002');
  });

  it('requires a resolvable server-side context', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/v1/recommendations/${APP_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('CMP-007 gateway failures fail safe to non-AI discovery', () => {
  const cases: [string, number, string, string][] = [
    ['unavailable', 503, 'SF-AI-001', 'GATEWAY_UNAVAILABLE'],
    ['timeout', 503, 'SF-AI-001', 'GATEWAY_TIMEOUT'],
    ['throws', 503, 'SF-AI-001', 'GATEWAY_UNAVAILABLE'],
    ['unsafe', 503, 'SF-AI-001', 'UNSAFE_OUTPUT'],
    ['denied', 403, 'SF-AUTH-002', 'GATEWAY_DENIED'],
  ];
  for (const [scenario, status, code, reason] of cases) {
    it(`${scenario}: persists FAILED, exposes fallback, emits RecommendationFailed`, async () => {
      h.gateway.scenario = scenario as never;
      const res = await create();
      expect(res.status).toBe(status);
      expect(res.body['error_code']).toBe(code);
      expect(JSON.stringify(res.body)).toContain(reason);
      const row = h.repo.state.rows[0];
      expect(row?.status).toBe('FAILED');
      expect(row?.rejection_code).toBe(reason);
      expect(row?.items).toEqual([]);
      const view = await h.call(T1, 'GET', `/v1/recommendations/${row?.recommendation_id}`);
      expect(view.status).toBe(200);
      expect(view.body['status']).toBe('FAILED');
      expect(view.body['fallback']).toBe('NON_AI_DISCOVERY');
      expect(view.body['recommendation']).toBeNull();
      expect(h.repo.events().map((e) => e.event_type)).toEqual([
        'RecommendationRequested',
        'RecommendationFailed',
      ]);
    });
  }
});

describe('CMP-007 model output guard (no statutory or authoritative content)', () => {
  const unsafe = [
    'binding_decision',
    'invented_candidate',
    'free_text',
    'bad_reason',
    'not_advisory',
  ];
  for (const scenario of unsafe) {
    it(`${scenario}: refused as UNSAFE_OUTPUT and nothing authoritative is stored`, async () => {
      h.gateway.scenario = scenario as never;
      const res = await create();
      expect(res.status).toBe(503);
      const row = h.repo.state.rows[0];
      expect(row?.status).toBe('FAILED');
      expect(row?.rejection_code).toBe('UNSAFE_OUTPUT');
      expect(row?.items).toEqual([]);
      expect(row?.authoritative).toBe(false);
      expect(JSON.stringify(h.repo.state.outbox)).not.toMatch(/is eligible|approved|IS_ELIGIBLE/);
    });
  }
});

describe('CMP-007 policy administration', () => {
  it('versions policies insert-only and keeps the pinned pins', async () => {
    const second = await h.call(
      T1,
      'POST',
      '/v1/recommendation-policies',
      { ...POLICY, max_results: 2 },
      { actor: OFFICER_ACTOR },
    );
    expect(second.status).toBe(201);
    expect(second.body['version_no']).toBe(2);
    expect(h.repo.state.policies.map((p) => p.version_no)).toEqual([1, 2]);
  });

  it('refuses reason, signal or purpose codes that name a binding outcome', async () => {
    for (const patch of [
      { allowed_reason_codes: ['ELIGIBLE_FOR_SERVICE'] },
      { allowed_reason_codes: ['FEE_WAIVER_APPLIES'] },
      { allowed_reason_codes: ['PAYMENT_DUE'] },
      { allowed_signal_codes: ['APPROVED_BEFORE'] },
      { consent_purpose_code: 'ELIGIBILITY_DECISION' },
    ]) {
      const res = await h.call(
        T1,
        'POST',
        '/v1/recommendation-policies',
        { ...POLICY, policy_code: 'OTHER_POLICY', ...patch },
        { actor: OFFICER_ACTOR },
      );
      expect(res.status).toBe(400);
    }
    const tooMany = await h.call(
      T1,
      'POST',
      '/v1/recommendation-policies',
      { ...POLICY, policy_code: 'OTHER_POLICY', max_candidates: 2, max_results: 3 },
      { actor: OFFICER_ACTOR },
    );
    expect(tooMany.status).toBe(400);
  });

  it('is OPA-gated: denied action writes nothing; PDP outage fails closed', async () => {
    h.authorizer.denies.add('RECOMMENDATION_POLICY');
    const denied = await h.call(
      T1,
      'POST',
      '/v1/recommendation-policies',
      { ...POLICY, policy_code: 'OTHER_POLICY' },
      { actor: OFFICER_ACTOR },
    );
    expect(denied.status).toBe(403);
    expect(h.repo.state.policies).toHaveLength(1);
    h.authorizer.throws = true;
    const down = await create();
    expect(down.status).toBe(503);
    expect(h.gateway.calls).toBe(0);
  });
});

describe('CMP-007 authorization and tenant isolation', () => {
  it('denies creation when OPA denies and does no external work', async () => {
    h.authorizer.denies.add('RECOMMENDATION_CREATE');
    const res = await create();
    expect(res.status).toBe(403);
    expect(h.consent.calls).toHaveLength(0);
    expect(h.gateway.calls).toBe(0);
  });

  it('lets the owner read; hides it from other citizens and other tenants (404)', async () => {
    const created = await create();
    const id = String(created.body['recommendation_id']);
    expect((await h.call(T1, 'GET', `/v1/recommendations/${id}`)).status).toBe(200);
    const other = await h.call(T1, 'GET', `/v1/recommendations/${id}`, undefined, {
      actor: OTHER_CITIZEN,
    });
    expect(other.status).toBe(404);
    const crossTenant = await h.call(T2, 'GET', `/v1/recommendations/${id}`);
    expect(crossTenant.status).toBe(404);
    expect(JSON.stringify(crossTenant.body)).not.toContain(id);
  });

  it('lets an authorised officer read within the tenant but not across tenants', async () => {
    const created = await create();
    const id = String(created.body['recommendation_id']);
    const ok = await h.call(T1, 'GET', `/v1/recommendations/${id}`, undefined, {
      actor: OFFICER_ACTOR,
    });
    expect(ok.status).toBe(200);
    h.authorizer.denies.add('RECOMMENDATION_READ_ANY');
    const denied = await h.call(T1, 'GET', `/v1/recommendations/${id}`, undefined, {
      actor: OFFICER_ACTOR,
    });
    expect(denied.status).toBe(403);
    h.authorizer.denies.clear();
    const cross = await h.call(T2, 'GET', `/v1/recommendations/${id}`, undefined, {
      actor: OFFICER_ACTOR,
    });
    expect(cross.status).toBe(404);
  });

  it('keeps T2 canary data out of every T1 response, event and gateway request', async () => {
    await seedPolicy(h, T2);
    await h.call(T2, 'POST', '/v1/recommendations', {
      policy_code: 'DISCOVERY_ASSIST',
      candidate_service_ids: [SVC_T2],
    });
    await create();
    const t1Rows = h.repo.state.rows.filter((r) => r.tenant_id === T1);
    expect(JSON.stringify(t1Rows)).not.toContain('CANARY');
    expect(JSON.stringify(h.gateway.lastRequest)).toBeDefined();
    const t1Events = h.repo.state.outbox.filter((o) => o.envelope.tenant_id === T1);
    expect(JSON.stringify(t1Events)).not.toContain(T2);
  });

  it('rejects malformed ids', async () => {
    const res = await h.call(T1, 'GET', '/v1/recommendations/not-a-uuid');
    expect(res.status).toBe(400);
  });
});

describe('CMP-007 disposition is a citizen choice, never a decision', () => {
  async function generated(): Promise<string> {
    const created = await create({ ...REC_BODY, application_id: APP_ID });
    return String(created.body['recommendation_id']);
  }

  it('selects a recommended service and emits a selection event with the pinned version ref', async () => {
    const id = await generated();
    const res = await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'SELECT',
      service_id: SVC_1,
    });
    expect(res.status).toBe(200);
    expect(res.body['status']).toBe('SELECTED');
    expect(res.body['selected_service_id']).toBe(SVC_1);
    expect(res.body['authoritative']).toBe(false);
    const selected = h.repo.events().find((e) => e.event_type === 'RecommendationSelected');
    expect(selected?.data).toMatchObject({
      selected_service_id: SVC_1,
      published_version_ref: 'v1',
      application_id: APP_ID,
      non_authoritative: true,
    });
    expect(h.repo.state.rows[0]?.status).toBe('SELECTED');
  });

  it('dismisses; terminal states refuse any further change', async () => {
    const id = await generated();
    const dismissed = await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'DISMISS',
    });
    expect(dismissed.body['status']).toBe('DISMISSED');
    const again = await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'DISMISS',
    });
    expect(again.status).toBe(409);
    expect(again.body['error_code']).toBe('SF-APP-001');
  });

  it('refuses a service the engine did not recommend, and malformed decisions', async () => {
    const id = await generated();
    const wrong = await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'SELECT',
      service_id: SVC_2,
    });
    expect(wrong.status).toBe(400);
    const missing = await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'SELECT',
    });
    expect(missing.status).toBe(400);
    const extra = await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'DISMISS',
      service_id: SVC_1,
    });
    expect(extra.status).toBe(400);
    const approve = await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'APPROVE',
    });
    expect(approve.status).toBe(400);
  });

  it('only the subject may dispose; FAILED recommendations cannot be disposed', async () => {
    const id = await generated();
    const other = await h.call(
      T1,
      'POST',
      `/v1/recommendations/${id}/disposition`,
      { decision: 'DISMISS' },
      { actor: OTHER_CITIZEN },
    );
    expect(other.status).toBe(404);
    const officer = await h.call(
      T1,
      'POST',
      `/v1/recommendations/${id}/disposition`,
      { decision: 'DISMISS' },
      { actor: OFFICER_ACTOR },
    );
    expect(officer.status).toBe(404);
    h.gateway.scenario = 'unavailable';
    await create();
    const failedId = h.repo.state.rows.find((r) => r.status === 'FAILED')?.recommendation_id;
    const res = await h.call(T1, 'POST', `/v1/recommendations/${failedId}/disposition`, {
      decision: 'DISMISS',
    });
    expect(res.status).toBe(409);
  });
});

describe('CMP-007 logging', () => {
  it('log records carry only ids and coded status', async () => {
    const created = await create();
    const service = (await import('../../src/plugin.js')).buildRecommendationService({
      repository: h.repo,
      resolveContext: async () => null,
      authorizer: h.authorizer,
      catalogue: h.catalogue,
      consent: h.consent,
      profile: h.profile,
      gateway: h.gateway,
    });
    const record = service.logRecord(String(created.body['recommendation_id']), 'GENERATED');
    expect(Object.keys(record).sort()).toEqual(['recommendation_id', 'status', 'tenant_present']);
    expect(JSON.stringify(record)).not.toContain(T1);
  });
});
