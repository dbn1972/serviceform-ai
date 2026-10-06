import { describe, expect, it } from 'vitest';
import { TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ACTOR_CITIZEN,
  APPLICATION_ID,
  ctxFor,
  OPEN_BODY,
  RESPOND_BODY,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-019 deficiency lifecycle', () => {
  it('opens a notice, pauses SLA, records a citizen response and resumes SLA', async () => {
    const h = makeHarness();
    const opened = await h.call('POST', '/v1/deficiencies', OPEN_BODY);
    expect(opened.status).toBe(201);
    const notice = opened.body as Body;
    expect(notice.status).toBe('OPEN');
    expect(notice.response_due_at).toBe('2026-10-20T10:00:00.000Z');
    expect(notice.items[0].item_code).toBe('ADDRESS_PROOF');
    expect(h.slaClock.pauses).toHaveLength(1);
    expect(h.slaClock.pauses[0]?.reason_code).toBe('DEFICIENCY_OPEN');
    expect(h.slaClock.pauses[0]?.application_id).toBe(APPLICATION_ID);
    expect(h.caseCommands.commands[0]?.body.command).toBe('RAISE_DEFICIENCY');
    expect(h.notifier.requests[0]?.kind).toBe('DEFICIENCY_OPENED');
    expect(h.notifier.requests[0]?.notification_port).toBe('M06_CMP025');

    const id = notice.deficiency_id as string;
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const responded = await h.call('POST', `/v1/deficiencies/${id}/response`, RESPOND_BODY);
    expect(responded.status).toBe(200);
    expect((responded.body as Body).status).toBe('RESPONSE_RECEIVED');
    expect(h.slaClock.resumes).toHaveLength(1);
    expect(h.caseCommands.commands[1]?.body.command).toBe('RECORD_CITIZEN_RESPONSE');

    h.state.ctx = ctxFor(TENANT_A);
    const closed = await h.call('POST', `/v1/deficiencies/${id}/close`, {
      close_reason_code: 'ITEMS_SATISFIED',
    });
    expect(closed.status).toBe(200);
    expect((closed.body as Body).status).toBe('CLOSED');
    expect(h.slaClock.resumes).toHaveLength(1);

    const listed = await h.call('GET', `/v1/applications/${APPLICATION_ID}/deficiencies`);
    expect((listed.body as Body).deficiencies).toHaveLength(1);
    const mem = h.repo.tenant(TENANT_A);
    expect(mem.outbox.filter((e) => e.topic === TOPIC_DOMAIN).map((e) => e.envelope.event_type)).toEqual(
      ['DeficiencyOpened', 'DeficiencyResponded', 'DeficiencyClosed'],
    );
  });

  it('resumes SLA when an officer closes an unanswered notice', async () => {
    const h = makeHarness();
    const opened = await h.call('POST', '/v1/deficiencies', OPEN_BODY);
    const id = (opened.body as Body).deficiency_id as string;
    const closed = await h.call('POST', `/v1/deficiencies/${id}/close`, {
      close_reason_code: 'WITHDRAWN_BY_OFFICER',
    });
    expect(closed.status).toBe(200);
    expect(h.slaClock.resumes).toHaveLength(1);
  });

  it('replays identical idempotent opens and refuses a different fingerprint', async () => {
    const h = makeHarness();
    const first = await h.call('POST', '/v1/deficiencies', OPEN_BODY, { key: 'idem-open-0001' });
    const replay = await h.call('POST', '/v1/deficiencies', OPEN_BODY, { key: 'idem-open-0001' });
    expect(replay.status).toBe(201);
    expect((replay.body as Body).deficiency_id).toBe((first.body as Body).deficiency_id);
    expect(h.slaClock.pauses).toHaveLength(1);
    const conflict = await h.call('POST', '/v1/deficiencies', { ...OPEN_BODY, notice_code: 'OTHER' }, {
      key: 'idem-open-0001',
    });
    expect(conflict.status).toBe(409);
    expect((conflict.body as Body).error_code).toBe('SF-APP-002');
  });

  it('refuses AI/SYSTEM actors, forged tenant headers, client time and wrong-tenant context', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'SYSTEM');
    const sys = await h.call('POST', '/v1/deficiencies', OPEN_BODY);
    expect(sys.status).toBe(403);

    h.state.ctx = ctxFor(TENANT_A);
    const header = await h.call('POST', '/v1/deficiencies', OPEN_BODY, {
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(header.status).toBe(403);

    const timed = await h.call('POST', '/v1/deficiencies', { ...OPEN_BODY, opened_at: '2026-01-01T00:00:00Z' });
    expect(timed.status).toBe(400);
    expect((timed.body as Body).details[0].code).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');

    h.state.ctx = ctxFor(TENANT_B);
    const other = await h.call('GET', `/v1/deficiencies/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    expect(other.status).toBe(404);
  });

  it('refuses a second active notice on the same application', async () => {
    const h = makeHarness();
    expect((await h.call('POST', '/v1/deficiencies', OPEN_BODY)).status).toBe(201);
    const second = await h.call('POST', '/v1/deficiencies', OPEN_BODY);
    expect(second.status).toBe(409);
  });

  it('OPA deny and PDP failure fail closed', async () => {
    const h = makeHarness();
    h.authorizer.deny = true;
    expect((await h.call('POST', '/v1/deficiencies', OPEN_BODY)).status).toBe(403);
    h.authorizer.deny = false;
    h.authorizer.fail = true;
    expect((await h.call('POST', '/v1/deficiencies', OPEN_BODY)).status).toBe(503);
  });
});
