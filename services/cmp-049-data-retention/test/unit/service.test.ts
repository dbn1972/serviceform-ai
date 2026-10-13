import { describe, expect, it } from 'vitest';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  ctxFor,
  OWNER_PERIOD_REF,
  policyBody,
  RESOURCE_1,
  RESOURCE_2,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';
import type { MemoryRetentionRepository } from '../doubles/memory-repo.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const mem = (h: Harness): MemoryRetentionRepository => h.repo as MemoryRetentionRepository;

async function registerPolicy(h: Harness, over: Record<string, unknown> = {}): Promise<string> {
  const res = await h.call('POST', '/v1/retention/policies', policyBody(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as Body)['policy']['policy_id'] as string;
}

async function enroll(h: Harness, policyId: string, resourceId = RESOURCE_1): Promise<string> {
  const res = await h.call('POST', '/v1/retention/subjects', {
    policy_id: policyId,
    resource_type: 'APPLICATION',
    resource_id: resourceId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as Body)['subject_id'] as string;
}

function transition(
  h: Harness,
  subjectId: string,
  to: string,
  expected: number,
  key?: string,
): ReturnType<Harness['call']> {
  return h.call(
    'POST',
    `/v1/retention/subjects/${subjectId}/transitions`,
    { to_eligibility: to, expected_version: expected },
    key === undefined ? {} : { key },
  );
}

function audits(h: Harness, tenant = TENANT_A): Body[] {
  return mem(h)
    .tenant(tenant)
    .outbox.filter((o) => o.topic === TOPIC_AUDIT)
    .map((o) => o.envelope.data as Body);
}

describe('policy registration (SF-CON-RETENTION-POLICY shape)', () => {
  it('registers a policy with server-derived tenant and constant markers', async () => {
    const h = makeHarness();
    const res = await h.call('POST', '/v1/retention/policies', policyBody());
    expect(res.status).toBe(201);
    const body = res.body as Body;
    expect(body['policy']['tenant_id']).toBe(TENANT_A);
    expect(body['policy']['contract_id']).toBe('SF-CON-RETENTION-POLICY');
    expect(body['policy']['statutory_retention_policy_input_required']).toBe(true);
    expect(body['policy']['invented_statutory_period_forbidden']).toBe(true);
    expect(body['policy']['owner_supplied_period_ref']).toBeNull();
    expect(body['owner_period_ref_bound']).toBe(false);
    expect(body['policy_version']).toBe(1);
    const events = mem(h)
      .tenant(TENANT_A)
      .outbox.filter((o) => o.topic === TOPIC_DOMAIN);
    expect(events.map((e) => e.envelope.event_type)).toEqual(['RetentionPolicyRegistered']);
  });

  it('refuses a client-supplied tenant_id, server-owned fields and flipped constant markers', async () => {
    const h = makeHarness();
    const t = await h.call('POST', '/v1/retention/policies', policyBody({ tenant_id: TENANT_B }));
    expect(t.status).toBe(403);
    expect((t.body as Body)['error_code']).toBe('SF-TEN-002');
    const p = await h.call('POST', '/v1/retention/policies', policyBody({ policy_id: RESOURCE_1 }));
    expect((p.body as Body)['details'][0]['code']).toBe('SERVER_OWNED_FIELD');
    for (const marker of [
      'statutory_retention_policy_input_required',
      'invented_statutory_period_forbidden',
      'policy_neutral_shape',
    ]) {
      const r = await h.call('POST', '/v1/retention/policies', policyBody({ [marker]: false }));
      expect(r.status).toBe(400);
      expect((r.body as Body)['details'][0]['code']).toBe('CONSTANT_MARKER_MUST_BE_TRUE');
    }
  });

  it('refuses any attempt to supply a period value instead of an owner reference', async () => {
    const h = makeHarness();
    const days = await h.call('POST', '/v1/retention/policies', policyBody({ retention_days: 30 }));
    expect((days.body as Body)['details'][0]['code']).toBe('UNKNOWN_FIELD');
    const iso = await h.call(
      'POST',
      '/v1/retention/policies',
      policyBody({ owner_supplied_period_ref: 'P7Y' }),
    );
    expect((iso.body as Body)['details'][0]['code']).toBe('PERIOD_REF_LOOKS_LIKE_DURATION');
    expect(mem(h).tenant(TENANT_A).policies.size).toBe(0);
  });

  it('policy registration and period binding are restricted to PRIVILEGED_ADMIN / SYSTEM actors', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    const res = await h.call('POST', '/v1/retention/policies', policyBody());
    expect(res.status).toBe(403);
    expect((res.body as Body)['details'][0]['code']).toBe('ACTOR_NOT_PERMITTED');
    expect(h.authorizer.calls).toHaveLength(0);
  });

  it('reads back the policy; another tenant cannot see it', async () => {
    const h = makeHarness();
    const id = await registerPolicy(h);
    const ok = await h.call('GET', `/v1/retention/policies/${id}`);
    expect(ok.status).toBe(200);
    h.state.ctx = ctxFor(TENANT_B);
    const other = await h.call('GET', `/v1/retention/policies/${id}`);
    expect(other.status).toBe(404);
  });
});

describe('fail closed until the owner supplies the period ref', () => {
  it('refuses ARCHIVE_ELIGIBLE with POLICY_INPUT_REQUIRED, changes nothing and audits FAILED', async () => {
    const h = makeHarness();
    const policyId = await registerPolicy(h);
    const subjectId = await enroll(h, policyId);
    const before = structuredClone(mem(h).tenant(TENANT_A).subjects.get(subjectId));
    const res = await transition(h, subjectId, 'ARCHIVE_ELIGIBLE', 1);
    expect(res.status).toBe(409);
    expect((res.body as Body)['error_code']).toBe('SF-APP-001');
    expect((res.body as Body)['details']).toEqual([{ code: 'POLICY_INPUT_REQUIRED' }]);
    const store = mem(h).tenant(TENANT_A);
    expect(store.subjects.get(subjectId)).toEqual(before);
    expect(store.transitions).toHaveLength(0);
    expect(
      store.outbox.filter((o) => o.envelope.event_type === 'RetentionEligibilityChanged'),
    ).toHaveLength(0);
    const failed = audits(h).filter((a) => a['result'] === 'FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.['reason']).toBe('POLICY_INPUT_REQUIRED');
    expect(failed[0]?.['action']).toBe('RETENTION_TRANSITION_ARCHIVE_ELIGIBLE');
  });

  it('evaluation reports POLICY_INPUT_REQUIRED without changing state', async () => {
    const h = makeHarness();
    const subjectId = await enroll(h, await registerPolicy(h));
    const res = await h.call('GET', `/v1/retention/subjects/${subjectId}/evaluation`);
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body['statutory_retention_policy_input_required']).toBe(true);
    expect(body['owner_period_ref_bound']).toBe(false);
    const archive = (body['candidates'] as Body[]).find(
      (c) => c['to_eligibility'] === 'ARCHIVE_ELIGIBLE',
    );
    expect(archive).toEqual({
      to_eligibility: 'ARCHIVE_ELIGIBLE',
      allowed: false,
      blocking_reason: 'POLICY_INPUT_REQUIRED',
    });
  });

  it('after the owner binds the ref, ACTIVE -> ARCHIVE_ELIGIBLE -> DELETE_ELIGIBLE succeeds and is logged', async () => {
    const h = makeHarness();
    const policyId = await registerPolicy(h);
    const subjectId = await enroll(h, policyId);
    const bind = await h.call('POST', `/v1/retention/policies/${policyId}/period-ref`, {
      owner_supplied_period_ref: OWNER_PERIOD_REF,
    });
    expect(bind.status).toBe(200);
    expect((bind.body as Body)['policy_version']).toBe(2);
    expect((bind.body as Body)['policy']['owner_supplied_period_ref']).toBe(OWNER_PERIOD_REF);
    const a = await transition(h, subjectId, 'ARCHIVE_ELIGIBLE', 1);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect((a.body as Body)['eligibility']).toBe('ARCHIVE_ELIGIBLE');
    const d = await transition(h, subjectId, 'DELETE_ELIGIBLE', 2);
    expect(d.status).toBe(200);
    const store = mem(h).tenant(TENANT_A);
    expect(store.transitions.map((t) => [t.from_eligibility, t.to_eligibility])).toEqual([
      ['ACTIVE', 'ARCHIVE_ELIGIBLE'],
      ['ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE'],
    ]);
    expect(store.transitions.every((t) => t.owner_supplied_period_ref === OWNER_PERIOD_REF)).toBe(
      true,
    );
    const changed = store.outbox.filter(
      (o) => o.envelope.event_type === 'RetentionEligibilityChanged',
    );
    expect(changed).toHaveLength(2);
  });

  it('the period ref is bound once; a second binding is refused and audited', async () => {
    const h = makeHarness();
    const policyId = await registerPolicy(h);
    const path = `/v1/retention/policies/${policyId}/period-ref`;
    expect(
      (await h.call('POST', path, { owner_supplied_period_ref: OWNER_PERIOD_REF })).status,
    ).toBe(200);
    const again = await h.call('POST', path, { owner_supplied_period_ref: 'owner-input:other' });
    expect(again.status).toBe(409);
    expect((again.body as Body)['details'][0]['code']).toBe('PERIOD_REF_ALREADY_BOUND');
    expect(audits(h).some((a) => a['reason'] === 'PERIOD_REF_ALREADY_BOUND')).toBe(true);
    const nul = await h.call('POST', path, { owner_supplied_period_ref: null });
    expect((nul.body as Body)['details'][0]['code']).toBe('POLICY_INPUT_REQUIRED');
  });
});

describe('policy-driven transitions', () => {
  it('refuses a transition the policy does not list, even with a bound period ref', async () => {
    const h = makeHarness();
    const policyId = await registerPolicy(h, { owner_supplied_period_ref: OWNER_PERIOD_REF });
    const subjectId = await enroll(h, policyId);
    const res = await transition(h, subjectId, 'DELETE_ELIGIBLE', 1);
    expect(res.status).toBe(409);
    expect((res.body as Body)['details'][0]['code']).toBe('TRANSITION_NOT_IN_POLICY');
  });

  it('LEGAL_HOLD works without a period ref; release needs the extra RETENTION_LEGAL_HOLD_RELEASE grant', async () => {
    const h = makeHarness();
    const subjectId = await enroll(h, await registerPolicy(h));
    expect((await transition(h, subjectId, 'LEGAL_HOLD', 1)).status).toBe(200);
    h.authorizer.deniedActions.add('RETENTION_LEGAL_HOLD_RELEASE');
    const denied = await transition(h, subjectId, 'ACTIVE', 2);
    expect(denied.status).toBe(403);
    expect(
      audits(h).some(
        (a) => a['action'] === 'RETENTION_LEGAL_HOLD_RELEASE' && a['result'] === 'DENIED',
      ),
    ).toBe(true);
    h.authorizer.deniedActions.clear();
    expect((await transition(h, subjectId, 'ACTIVE', 2)).status).toBe(200);
  });

  it('a stale expected_version is refused (optimistic concurrency)', async () => {
    const h = makeHarness();
    const subjectId = await enroll(h, await registerPolicy(h));
    const res = await transition(h, subjectId, 'LEGAL_HOLD', 7);
    expect(res.status).toBe(409);
    expect((res.body as Body)['details'][0]['code']).toBe('STALE_VERSION');
  });

  it('enrolment requires the policy scope resource_type and refuses duplicate enrolment', async () => {
    const h = makeHarness();
    const policyId = await registerPolicy(h);
    const mismatch = await h.call('POST', '/v1/retention/subjects', {
      policy_id: policyId,
      resource_type: 'DOCUMENT',
      resource_id: RESOURCE_2,
    });
    expect((mismatch.body as Body)['details'][0]['code']).toBe('RESOURCE_TYPE_SCOPE_MISMATCH');
    await enroll(h, policyId);
    const dup = await h.call('POST', '/v1/retention/subjects', {
      policy_id: policyId,
      resource_type: 'APPLICATION',
      resource_id: RESOURCE_1,
    });
    expect(dup.status).toBe(409);
    expect((dup.body as Body)['details'][0]['code']).toBe('SUBJECT_ALREADY_ENROLLED');
  });
});

describe('OPA enforcement and actor baseline', () => {
  it('a policy denial returns 403 and is audited DENIED', async () => {
    const h = makeHarness();
    h.authorizer.deniedActions.add('RETENTION_POLICY_REGISTER');
    const res = await h.call('POST', '/v1/retention/policies', policyBody());
    expect(res.status).toBe(403);
    expect(audits(h).map((a) => [a['action'], a['result']])).toEqual([
      ['RETENTION_POLICY_REGISTER', 'DENIED'],
    ]);
    expect(mem(h).tenant(TENANT_A).policies.size).toBe(0);
  });

  it('a PDP outage fails closed with 503', async () => {
    const h = makeHarness();
    h.authorizer.fail = true;
    const res = await h.call('POST', '/v1/retention/policies', policyBody());
    expect(res.status).toBe(503);
    expect((res.body as Body)['details'][0]['code']).toBe('PDP_UNAVAILABLE');
  });

  it('citizens never reach retention routes', async () => {
    const h = makeHarness();
    const policyId = await registerPolicy(h);
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const res = await h.call('GET', `/v1/retention/policies/${policyId}`);
    expect(res.status).toBe(403);
  });

  it('never calls the PDP inside a database transaction', async () => {
    const h = makeHarness();
    h.authorizer.onDecide = (): void => {
      expect(h.repo.inTransaction()).toBe(false);
    };
    const policyId = await registerPolicy(h);
    const subjectId = await enroll(h, policyId);
    await transition(h, subjectId, 'LEGAL_HOLD', 1);
    await transition(h, subjectId, 'ACTIVE', 2);
    expect(h.authorizer.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('passes the server-derived tenant to the PDP for subject and resource', async () => {
    const h = makeHarness();
    await registerPolicy(h);
    for (const c of h.authorizer.calls) {
      expect(c.subject.tenant_id).toBe(TENANT_A);
      expect(c.resource.tenant_id).toBe(TENANT_A);
    }
  });
});

describe('tenant context and request hygiene', () => {
  it('refuses tenant-identifying headers and missing tenant context', async () => {
    const h = makeHarness();
    const hdr = await h.call('POST', '/v1/retention/policies', policyBody(), {
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(hdr.status).toBe(403);
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    const none = await h.call('GET', `/v1/retention/policies/${RESOURCE_1}`);
    expect(none.status).toBe(401);
    expect((none.body as Body)['error_code']).toBe('SF-TEN-001');
    h.state.ctx = null;
    expect((await h.call('GET', `/v1/retention/policies/${RESOURCE_1}`)).status).toBe(401);
  });

  it('a subject enrolled in tenant A is invisible and immovable from tenant B', async () => {
    const h = makeHarness();
    const subjectId = await enroll(h, await registerPolicy(h));
    h.state.ctx = ctxFor(TENANT_B, ACTOR_OFFICER, 'OFFICER');
    expect((await h.call('GET', `/v1/retention/subjects/${subjectId}`)).status).toBe(404);
    expect((await transition(h, subjectId, 'LEGAL_HOLD', 1)).status).toBe(404);
    expect(mem(h).tenant(TENANT_A).subjects.get(subjectId)?.eligibility).toBe('ACTIVE');
  });

  it('refuses client time, unknown fields, bad ids and missing idempotency keys', async () => {
    const h = makeHarness();
    const policyId = await registerPolicy(h);
    const subjectId = await enroll(h, policyId);
    const time = await h.call('POST', `/v1/retention/subjects/${subjectId}/transitions`, {
      to_eligibility: 'LEGAL_HOLD',
      expected_version: 1,
      occurred_at: '2020-01-01T00:00:00Z',
    });
    expect((time.body as Body)['details'][0]['code']).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');
    const q = await h.call('GET', `/v1/retention/subjects/${subjectId}`, undefined, {
      query: { now: 'x' },
    });
    expect(q.status).toBe(400);
    expect((await h.call('GET', '/v1/retention/subjects/not-a-uuid')).status).toBe(400);
    const nokey = await h.call('POST', '/v1/retention/policies', policyBody(), { key: null });
    expect((nokey.body as Body)['details'][0]['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await h.call('DELETE', `/v1/retention/subjects/${subjectId}`)).status).toBe(400);
    expect((await h.call('POST', '/v1/retention/purge', {})).status).toBe(404);
  });
});

describe('idempotency and atomicity', () => {
  it('replays the stored response for the same key and body; refuses a different body', async () => {
    const h = makeHarness();
    const subjectId = await enroll(h, await registerPolicy(h));
    const first = await transition(h, subjectId, 'LEGAL_HOLD', 1, 'idem-key-transition-1');
    const replay = await transition(h, subjectId, 'LEGAL_HOLD', 1, 'idem-key-transition-1');
    expect(replay).toEqual(first);
    expect(mem(h).tenant(TENANT_A).transitions).toHaveLength(1);
    const conflict = await transition(h, subjectId, 'ACTIVE', 2, 'idem-key-transition-1');
    expect(conflict.status).toBe(409);
    expect((conflict.body as Body)['error_code']).toBe('SF-APP-002');
  });

  it('a commit failure rolls back state, transition log, domain event and audit together', async () => {
    const h = makeHarness();
    const subjectId = await enroll(h, await registerPolicy(h));
    const store = mem(h).tenant(TENANT_A);
    const outboxBefore = store.outbox.length;
    mem(h).failNextCommit = true;
    const res = await transition(h, subjectId, 'LEGAL_HOLD', 1);
    expect(res.status).toBe(500);
    expect(store.subjects.get(subjectId)?.eligibility).toBe('ACTIVE');
    expect(store.transitions).toHaveLength(0);
    expect(store.outbox).toHaveLength(outboxBefore);
    expect(store.idempotency.size).toBe(2);
  });

  it('a successful transition commits subject, log, event and SUCCESS audit in one transaction', async () => {
    const h = makeHarness();
    const subjectId = await enroll(h, await registerPolicy(h));
    const store = mem(h).tenant(TENANT_A);
    const before = store.outbox.length;
    expect((await transition(h, subjectId, 'LEGAL_HOLD', 1)).status).toBe(200);
    const added = store.outbox.slice(before);
    expect(added.map((o) => o.envelope.event_type).sort()).toEqual([
      'AuditEventSubmitted',
      'RetentionEligibilityChanged',
    ]);
    const audit = added.find((o) => o.topic === TOPIC_AUDIT)?.envelope.data as Body;
    expect(audit['result']).toBe('SUCCESS');
    expect(audit['reason']).toBe('ACTIVE->LEGAL_HOLD');
  });
});
