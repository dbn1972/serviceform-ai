import { describe, expect, it } from 'vitest';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  ACTOR_SYSTEM,
  CRED_1,
  CRED_2,
  CRED_3,
  ISSUER_REF,
  REASON_REF,
  TENANT_A,
} from '../doubles/fixtures.js';
import { BASE, makeHarness } from '../doubles/harness.js';
import type { MemoryRegistryRepository } from '../doubles/memory-repo.js';

const store = (h: ReturnType<typeof makeHarness>) =>
  (h.repo as MemoryRegistryRepository).tenant(TENANT_A);

function audits(h: ReturnType<typeof makeHarness>) {
  return store(h)
    .outbox.filter((o) => o.topic === TOPIC_AUDIT)
    .map((o) => o.envelope.data as Record<string, unknown>);
}

describe('registration', () => {
  it('enters the registry as REGISTERED with history sequence 1 and emits CredentialRegistered', async () => {
    const h = makeHarness();
    const body = await h.register(CRED_1);
    expect(body['status_version']).toBe(1);
    const doc = body['credential_status'];
    expect(doc['current_status']).toBe('REGISTERED');
    expect(doc['history']).toHaveLength(1);
    expect(doc['history'][0]).toMatchObject({
      sequence: 1,
      from_status: null,
      to_status: 'REGISTERED',
    });
    const events = store(h).outbox.filter((o) => o.topic === TOPIC_DOMAIN);
    expect(events.map((e) => e.envelope.event_type)).toEqual(['CredentialRegistered']);
  });

  it('replays the same idempotency key without a second history row; a different body conflicts', async () => {
    const h = makeHarness();
    const body = { credential_id: CRED_1, issuer_ref: ISSUER_REF };
    const a = await h.call('POST', BASE, body, { key: 'reg-key-0001' });
    const b = await h.call('POST', BASE, body, { key: 'reg-key-0001' });
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(store(h).history).toHaveLength(1);
    const c = await h.call(
      'POST',
      BASE,
      { ...body, issuer_ref: 'issuer:other' },
      { key: 'reg-key-0001' },
    );
    expect(c.status).toBe(409);
    expect(c.body['error_code']).toBe('SF-APP-002');
  });

  it('refuses re-registering the same credential with a new key', async () => {
    const h = makeHarness();
    await h.register(CRED_1);
    const res = await h.call('POST', BASE, { credential_id: CRED_1, issuer_ref: ISSUER_REF });
    expect(res.status).toBe(409);
    expect(res.body['details']).toEqual([{ code: 'CREDENTIAL_ALREADY_REGISTERED' }]);
  });

  it('only the SYSTEM workload registers; officers and citizens are refused and audited', async () => {
    const h = makeHarness();
    for (const [id, type] of [
      [ACTOR_OFFICER, 'OFFICER'],
      [ACTOR_CITIZEN, 'CITIZEN'],
    ] as const) {
      h.as(TENANT_A, id, type);
      const res = await h.call('POST', BASE, { credential_id: CRED_1, issuer_ref: ISSUER_REF });
      expect(res.status).toBe(403);
    }
    expect(store(h).entries.size).toBe(0);
    expect(audits(h).filter((a) => a['result'] === 'DENIED')).toHaveLength(2);
  });

  it('rejects server-owned fields, client time, unknown fields and non-opaque issuer refs', async () => {
    const h = makeHarness();
    const cases: [Record<string, unknown>, string][] = [
      [
        { credential_id: CRED_1, issuer_ref: ISSUER_REF, current_status: 'ACTIVE' },
        'SERVER_OWNED_FIELD',
      ],
      [{ credential_id: CRED_1, issuer_ref: ISSUER_REF, history: [] }, 'SERVER_OWNED_FIELD'],
      [
        { credential_id: CRED_1, issuer_ref: ISSUER_REF, registered_at: '2020-01-01T00:00:00Z' },
        'CLIENT_TIME_NOT_AUTHORITATIVE',
      ],
      [{ credential_id: CRED_1, issuer_ref: ISSUER_REF, holder_name: 'x' }, 'UNKNOWN_FIELD'],
      [{ credential_id: CRED_1, issuer_ref: 'Office of the Collector' }, 'OPAQUE_REF_REQUIRED'],
      [{ credential_id: 'not-a-uuid', issuer_ref: ISSUER_REF }, 'UUID_REQUIRED'],
    ];
    for (const [body, code] of cases) {
      const res = await h.call('POST', BASE, body);
      expect(res.status, code).toBe(400);
      expect(res.body['details'][0]['code']).toBe(code);
    }
    expect(store(h).entries.size).toBe(0);
  });

  it('requires an idempotency key on every command', async () => {
    const h = makeHarness();
    const res = await h.call(
      'POST',
      BASE,
      { credential_id: CRED_1, issuer_ref: ISSUER_REF },
      { key: null },
    );
    expect(res.status).toBe(400);
    expect(res.body['details']).toEqual([{ code: 'IDEMPOTENCY_KEY_REQUIRED' }]);
  });
});

describe('lifecycle transitions and immutable history', () => {
  it('ACTIVE -> SUSPENDED -> ACTIVE -> REVOKED appends one immutable entry per change', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    expect((await h.transition(CRED_1, 'suspend', 2, h.reason)).status).toBe(200);
    expect((await h.transition(CRED_1, 'reinstate', 3)).status).toBe(200);
    const res = await h.transition(CRED_1, 'revoke', 4, h.reason);
    expect(res.status).toBe(200);
    const doc = res.body['credential_status'];
    expect(doc['current_status']).toBe('REVOKED');
    expect(
      doc['history'].map((e: Record<string, unknown>) => [
        e['sequence'],
        e['from_status'],
        e['to_status'],
      ]),
    ).toEqual([
      [1, null, 'REGISTERED'],
      [2, 'REGISTERED', 'ACTIVE'],
      [3, 'ACTIVE', 'SUSPENDED'],
      [4, 'SUSPENDED', 'ACTIVE'],
      [5, 'ACTIVE', 'REVOKED'],
    ]);
    expect(doc['history'][2]['reason_code_ref']).toBe(REASON_REF);
    expect(doc['history'][4]['reason_code_ref']).toBe(REASON_REF);
    expect(doc['history'][4]['actor']).toEqual({ type: 'OFFICER', id: ACTOR_OFFICER });
    for (const row of store(h).history) expect(Object.isFrozen(row)).toBe(true);
  });

  it('earlier history entries are never rewritten by later transitions', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    const before = JSON.stringify(store(h).history);
    await h.transition(CRED_1, 'suspend', 2, h.reason);
    const after = store(h).history;
    expect(JSON.stringify(after.slice(0, 2))).toBe(before);
  });

  it('suspend and revoke require a reason_code_ref; free text is refused', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    for (const verb of ['suspend', 'revoke']) {
      const missing = await h.transition(CRED_1, verb, 2);
      expect(missing.status).toBe(400);
      expect(missing.body['details']).toEqual([
        { code: 'REASON_CODE_REF_REQUIRED', pointer: '/reason_code_ref' },
      ]);
      const free = await h.transition(CRED_1, verb, 2, { reason_code_ref: 'document was forged' });
      expect(free.status).toBe(400);
      expect(free.body['details'][0]['code']).toBe('REASON_CODE_REF_INVALID');
    }
    expect(store(h).entries.get(CRED_1)?.current_status).toBe('ACTIVE');
  });

  it('terminal REVOKED refuses every further command and audits the refusal as FAILED', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    await h.transition(CRED_1, 'revoke', 2, h.reason);
    for (const verb of ['activate', 'suspend', 'reinstate', 'revoke']) {
      const res = await h.transition(CRED_1, verb, 3, h.reason);
      expect(res.status, verb).toBe(409);
      expect(res.body['details']).toEqual([{ code: 'TERMINAL_STATUS' }]);
    }
    expect(store(h).history).toHaveLength(3);
    const failed = audits(h).filter((a) => a['result'] === 'FAILED');
    expect(failed).toHaveLength(4);
    expect(failed.every((a) => a['reason'] === 'TERMINAL_STATUS')).toBe(true);
  });

  it('refuses transitions outside the lifecycle (REGISTERED cannot be suspended)', async () => {
    const h = makeHarness();
    await h.register(CRED_1);
    h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    const res = await h.transition(CRED_1, 'suspend', 1, h.reason);
    expect(res.status).toBe(409);
    expect(res.body['details']).toEqual([{ code: 'TRANSITION_NOT_ALLOWED' }]);
  });

  it('a stale expected_version is refused without a state change', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    const res = await h.transition(CRED_1, 'suspend', 1, h.reason);
    expect(res.status).toBe(409);
    expect(res.body['details']).toEqual([{ code: 'STALE_VERSION', pointer: '/expected_version' }]);
    expect(store(h).history).toHaveLength(2);
  });

  it('unknown credential returns 404', async () => {
    const h = makeHarness();
    h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    const res = await h.transition(CRED_1, 'revoke', 1, h.reason);
    expect(res.status).toBe(404);
  });

  it('transition commands are idempotent per key', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    const a = await h.call(
      'POST',
      `${BASE}/${CRED_1}/suspend`,
      { expected_version: 2, ...h.reason },
      { key: 'susp-key-0001' },
    );
    const b = await h.call(
      'POST',
      `${BASE}/${CRED_1}/suspend`,
      { expected_version: 2, ...h.reason },
      { key: 'susp-key-0001' },
    );
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(store(h).history).toHaveLength(3);
  });
});

describe('reissue', () => {
  it('REISSUED requires a live successor in the registry and records it', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    await h.register(CRED_2);
    h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    const res = await h.transition(CRED_1, 'reissue', 2, { superseded_by_credential_id: CRED_2 });
    expect(res.status).toBe(200);
    expect(res.body['credential_status']['current_status']).toBe('REISSUED');
    expect(res.body['credential_status']['superseded_by_credential_id']).toBe(CRED_2);
    const ev = store(h)
      .outbox.filter((o) => o.envelope.event_type === 'CredentialStatusChanged')
      .at(-1);
    expect(ev?.envelope.data).toMatchObject({
      to_status: 'REISSUED',
      superseded_by_credential_id: CRED_2,
    });
  });

  it('refuses a missing, unregistered, self or terminal successor', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    const missing = await h.transition(CRED_1, 'reissue', 2);
    expect(missing.status).toBe(400);
    expect(
      (await h.transition(CRED_1, 'reissue', 2, { superseded_by_credential_id: CRED_3 })).body[
        'details'
      ],
    ).toEqual([{ code: 'SUCCESSOR_NOT_REGISTERED' }]);
    expect(
      (await h.transition(CRED_1, 'reissue', 2, { superseded_by_credential_id: CRED_1 })).body[
        'details'
      ],
    ).toEqual([{ code: 'SUCCESSOR_INVALID' }]);
    await h.register(CRED_2);
    h.as(TENANT_A, ACTOR_SYSTEM, 'SYSTEM');
    await h.transition(CRED_2, 'revoke', 1, h.reason);
    h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    expect(
      (await h.transition(CRED_1, 'reissue', 2, { superseded_by_credential_id: CRED_2 })).body[
        'details'
      ],
    ).toEqual([{ code: 'SUCCESSOR_NOT_LIVE' }]);
    expect(store(h).entries.get(CRED_1)?.current_status).toBe('ACTIVE');
  });

  it('superseded_by_credential_id is only accepted on reissue', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    const res = await h.transition(CRED_1, 'revoke', 2, {
      ...h.reason,
      superseded_by_credential_id: CRED_2,
    });
    expect(res.status).toBe(400);
    expect(res.body['details'][0]['code']).toBe('UNKNOWN_FIELD');
  });
});

describe('authorisation (OPA PEP) and fail-closed behaviour', () => {
  it('an OPA denial is 403, audited DENIED, and changes nothing', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    h.authorizer.deniedActions.add('CREDENTIAL_REGISTRY_REVOKE');
    const res = await h.transition(CRED_1, 'revoke', 2, h.reason);
    expect(res.status).toBe(403);
    expect(store(h).entries.get(CRED_1)?.current_status).toBe('ACTIVE');
    expect(audits(h).at(-1)).toMatchObject({
      action: 'CREDENTIAL_REGISTRY_REVOKE',
      result: 'DENIED',
    });
  });

  it('a PDP outage fails closed with 503', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    h.authorizer.fail = true;
    const res = await h.transition(CRED_1, 'revoke', 2, h.reason);
    expect(res.status).toBe(503);
    expect(store(h).entries.get(CRED_1)?.current_status).toBe('ACTIVE');
  });

  it('citizens cannot change status', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    h.as(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const res = await h.transition(CRED_1, 'revoke', 2, h.reason);
    expect(res.status).toBe(403);
    expect(res.body['details']).toEqual([{ code: 'ACTOR_NOT_PERMITTED' }]);
  });

  it('the PDP is consulted before any transaction opens', async () => {
    const h = makeHarness();
    const repo = h.repo as MemoryRegistryRepository;
    const seen: boolean[] = [];
    const original = h.authorizer.decide.bind(h.authorizer);
    h.authorizer.decide = (input) => {
      seen.push(repo.inTransaction());
      return original(input);
    };
    await h.active(CRED_1);
    await h.transition(CRED_1, 'suspend', 2, h.reason);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false)).toBe(true);
  });

  it('events and audits carry opaque refs only (no free-text or holder data)', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    await h.transition(CRED_1, 'revoke', 2, h.reason);
    const text = JSON.stringify(store(h).outbox);
    expect(text).not.toMatch(/holder|name|address|aadhaar|dob/i);
  });
});
