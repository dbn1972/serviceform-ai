import { describe, expect, it } from 'vitest';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  ACTOR_VERIFIER,
  APPLICATION_1,
  ASSURANCE_REF,
  AUTHORITY_REF,
  CONSENT_REF,
  ctxFor,
  startBody,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';
import type { MemoryAssistedRepository } from '../doubles/memory-repo.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const mem = (h: Harness): MemoryAssistedRepository => h.repo as MemoryAssistedRepository;

async function startSession(
  h: Harness,
  over: Record<string, unknown> = {},
): Promise<{ id: string; version: number; body: Body }> {
  const res = await h.call('POST', '/v1/assisted/sessions', startBody(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const body = res.body as Body;
  return {
    id: body['assisted_session']['session_id'] as string,
    version: body['session_version'] as number,
    body,
  };
}

async function bind(h: Harness, id: string, version: number): Promise<number> {
  const res = await h.call('POST', `/v1/assisted/sessions/${id}/applicant`, {
    expected_version: version,
    applicant_assurance_ref: ASSURANCE_REF,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as Body)['session_version'] as number;
}

async function verify(
  h: Harness,
  id: string,
  version: number,
  over: Record<string, unknown> = {},
): Promise<number> {
  const res = await h.call('POST', `/v1/assisted/sessions/${id}/representation`, {
    expected_version: version,
    representation_authority_ref: null,
    consent_ref: CONSENT_REF,
    read_back_acknowledged: true,
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as Body)['session_version'] as number;
}

function audits(h: Harness, tenant = TENANT_A): Body[] {
  return mem(h)
    .tenant(tenant)
    .outbox.filter((o) => o.topic === TOPIC_AUDIT)
    .map((o) => o.envelope.data as Body);
}

describe('start session (SF-CON-ASSISTED-SESSION)', () => {
  it('starts a COUNTER session with server-derived applied_by and distinctness constant', async () => {
    const h = makeHarness();
    const { body } = await startSession(h);
    const doc = body['assisted_session'] as Body;
    expect(doc['contract_id']).toBe('SF-CON-ASSISTED-SESSION');
    expect(doc['applied_by_actor_id']).toBe(ACTOR_OFFICER);
    expect(doc['applied_for_citizen_id']).toBe(ACTOR_CITIZEN);
    expect(doc['applied_by_distinct_from_applied_for']).toBe(true);
    expect(doc['invented_statutory_policy_forbidden']).toBe(true);
    expect(doc['lifecycle_status']).toBe('STARTED');
    expect(doc['tenant_id']).toBe(TENANT_A);
    const events = mem(h)
      .tenant(TENANT_A)
      .outbox.filter((o) => o.topic === TOPIC_DOMAIN);
    expect(events.map((e) => e.envelope.event_type)).toEqual(['AssistedSessionStarted']);
  });

  it('refuses self-assisted start (applied_by == applied_for)', async () => {
    const h = makeHarness();
    const res = await h.call(
      'POST',
      '/v1/assisted/sessions',
      startBody({ applied_for_citizen_id: ACTOR_OFFICER }),
    );
    expect(res.status).toBe(403);
    expect((res.body as Body)['details'][0]['code']).toBe('APPLIED_BY_EQUALS_APPLIED_FOR');
    expect(mem(h).tenant(TENANT_A).sessions.size).toBe(0);
  });

  it('refuses client-supplied tenant_id and server-owned fields', async () => {
    const h = makeHarness();
    const t = await h.call('POST', '/v1/assisted/sessions', startBody({ tenant_id: TENANT_B }));
    expect(t.status).toBe(403);
    expect((t.body as Body)['error_code']).toBe('SF-TEN-002');
    const s = await h.call(
      'POST',
      '/v1/assisted/sessions',
      startBody({ applied_by_actor_id: ACTOR_CITIZEN }),
    );
    expect(s.status).toBe(400);
    expect((s.body as Body)['details'][0]['code']).toBe('SERVER_OWNED_FIELD');
  });

  it('citizens cannot open a COUNTER session', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const res = await h.call('POST', '/v1/assisted/sessions', startBody());
    expect(res.status).toBe(403);
    expect((res.body as Body)['details'][0]['code']).toBe('ACTOR_NOT_PERMITTED');
  });
});

describe('INT-015 happy path (counter → bind → verify → submit)', () => {
  it('proves who applied, for whom, under what channel, with consent', async () => {
    const h = makeHarness();
    const { id, version } = await startSession(h);
    const v2 = await bind(h, id, version);
    const v3 = await verify(h, id, v2);
    const sub = await h.call('POST', `/v1/assisted/sessions/${id}/submit`, {
      expected_version: v3,
      application_id: APPLICATION_1,
    });
    expect(sub.status).toBe(200);
    const doc = (sub.body as Body)['assisted_session'] as Body;
    expect(doc['lifecycle_status']).toBe('SUBMITTED');
    expect((sub.body as Body)['application_id']).toBe(APPLICATION_1);
    expect((sub.body as Body)['proof']['consent_ref']).toBe(CONSENT_REF);
    const types = mem(h)
      .tenant(TENANT_A)
      .outbox.filter((o) => o.topic === TOPIC_DOMAIN)
      .map((o) => o.envelope.event_type);
    expect(types).toEqual([
      'AssistedSessionStarted',
      'RepresentationVerified',
      'AssistedApplicationSubmitted',
    ]);
  });

  it('submit is refused before representation/consent verification', async () => {
    const h = makeHarness();
    const { id, version } = await startSession(h);
    const v2 = await bind(h, id, version);
    const res = await h.call('POST', `/v1/assisted/sessions/${id}/submit`, {
      expected_version: v2,
      application_id: APPLICATION_1,
    });
    expect(res.status).toBe(409);
    expect((res.body as Body)['details'][0]['code']).toBe('TRANSITION_NOT_ALLOWED');
  });
});

describe('representation channel (opaque authority ref; no statute)', () => {
  it('requires a third-party verifier and opaque authority ref', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    const started = await h.call(
      'POST',
      '/v1/assisted/sessions',
      startBody({ channel: 'AUTHORIZED_REPRESENTATIVE' }),
    );
    expect(started.status).toBe(201);
    const id = (started.body as Body)['assisted_session']['session_id'] as string;
    let version = (started.body as Body)['session_version'] as number;
    version = await bind(h, id, version);

    const self = await h.call('POST', `/v1/assisted/sessions/${id}/representation`, {
      expected_version: version,
      representation_authority_ref: AUTHORITY_REF,
      consent_ref: CONSENT_REF,
      read_back_acknowledged: true,
    });
    expect(self.status).toBe(403);
    expect((self.body as Body)['details'][0]['code']).toBe('SELF_VERIFICATION_REFUSED');

    h.state.ctx = ctxFor(TENANT_A, ACTOR_VERIFIER, 'OFFICER');
    const missing = await h.call('POST', `/v1/assisted/sessions/${id}/representation`, {
      expected_version: version,
      representation_authority_ref: null,
      consent_ref: CONSENT_REF,
      read_back_acknowledged: true,
    });
    expect(missing.status).toBe(400);
    expect((missing.body as Body)['details'][0]['code']).toBe(
      'REPRESENTATION_AUTHORITY_REF_REQUIRED',
    );

    const ok = await h.call('POST', `/v1/assisted/sessions/${id}/representation`, {
      expected_version: version,
      representation_authority_ref: AUTHORITY_REF,
      consent_ref: CONSENT_REF,
      read_back_acknowledged: true,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as Body)['assisted_session']['representation_authority_ref']).toBe(
      AUTHORITY_REF,
    );
  });
});

describe('handoff + citizen resume (identity preserved)', () => {
  it('issues a one-time token and lets the applicant resume without changing identities', async () => {
    const h = makeHarness();
    const { id, version } = await startSession(h);
    const v2 = await bind(h, id, version);
    const v3 = await verify(h, id, v2);
    const hand = await h.call('POST', `/v1/assisted/sessions/${id}/handoff`, {
      expected_version: v3,
      application_id: APPLICATION_1,
    });
    expect(hand.status).toBe(200);
    const token = (hand.body as Body)['handoff']['handoff_token'] as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const resume = await h.call('POST', `/v1/assisted/sessions/${id}/resume`, {
      handoff_token: token,
    });
    expect(resume.status).toBe(200);
    const body = resume.body as Body;
    expect(body['assisted_session']['lifecycle_status']).toBe('CLOSED');
    expect(body['closure_reason']).toBe('RESUMED_SELF_SERVICE');
    expect(body['resume']['application_id']).toBe(APPLICATION_1);
    expect(body['resume']['applied_for_citizen_id']).toBe(ACTOR_CITIZEN);
    expect(body['assisted_session']['applied_for_citizen_id']).toBe(ACTOR_CITIZEN);
  });
});

describe('OPA / tenant / idempotency', () => {
  it('audits OPA denials and fails closed on PDP outage', async () => {
    const h = makeHarness();
    h.authorizer.deniedActions.add('ASSISTED_SESSION_START');
    const denied = await h.call('POST', '/v1/assisted/sessions', startBody());
    expect(denied.status).toBe(403);
    expect(audits(h).some((a) => a['result'] === 'DENIED')).toBe(true);

    h.authorizer.deniedActions.clear();
    h.authorizer.fail = true;
    const down = await h.call('POST', '/v1/assisted/sessions', startBody());
    expect(down.status).toBe(503);
    expect((down.body as Body)['error_code']).toBe('SF-SYS-004');
  });

  it('replays identical idempotent starts and refuses fingerprint conflicts', async () => {
    const h = makeHarness();
    const a = await h.call('POST', '/v1/assisted/sessions', startBody(), { key: 'idem-start-1' });
    const b = await h.call('POST', '/v1/assisted/sessions', startBody(), { key: 'idem-start-1' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((b.body as Body)['assisted_session']['session_id']).toBe(
      (a.body as Body)['assisted_session']['session_id'],
    );
    expect(mem(h).tenant(TENANT_A).sessions.size).toBe(1);
    const clash = await h.call('POST', '/v1/assisted/sessions', startBody({ channel: 'CSC' }), {
      key: 'idem-start-1',
    });
    expect(clash.status).toBe(409);
  });

  it('another tenant context cannot see the session', async () => {
    const h = makeHarness();
    const { id } = await startSession(h);
    h.state.ctx = ctxFor(TENANT_B, ACTOR_OFFICER, 'OFFICER');
    const res = await h.call('GET', `/v1/assisted/sessions/${id}`);
    expect(res.status).toBe(404);
  });
});
