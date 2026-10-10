import { describe, expect, it } from 'vitest';
import {
  assertNoticeSenderIsAuthority,
  assertThreadAcceptsMessages,
  bodyDigest,
  isMessageKind,
  isThreadCommand,
  isThreadStatus,
  parseBody,
  parsePageSize,
  parseParticipant,
  parseSequence,
  parseStorageKey,
  parseStorageKeys,
  participantRef,
  planThreadTransition,
} from '../../src/domain/model.js';
import {
  canonicalJson,
  isActor,
  isAuditEvent,
  isAuthzDecisionOutput,
  isEventEnvelope,
  isRequestContext,
  sha256Of,
} from '../../src/domain/validate.js';
import { auditEnvelope, envelopeOf } from '../../src/events.js';
import { CITIZEN, ctx, OFFICER, T1, T2 } from '../doubles/fixtures.js';

describe('thread state machine', () => {
  it('permits only CLOSE from OPEN, REOPEN and ARCHIVE from CLOSED', () => {
    const p = (command: 'CLOSE' | 'REOPEN' | 'ARCHIVE', from: 'OPEN' | 'CLOSED' | 'ARCHIVED') =>
      planThreadTransition({
        command,
        from,
        expectedStatus: from,
        expectedVersion: 3,
        currentVersion: 3,
      });
    expect(p('CLOSE', 'OPEN')).toEqual({ to: 'CLOSED', nextVersion: 4 });
    expect(p('REOPEN', 'CLOSED').to).toBe('OPEN');
    expect(p('ARCHIVE', 'CLOSED').to).toBe('ARCHIVED');
    for (const [c, f] of [
      ['CLOSE', 'CLOSED'],
      ['CLOSE', 'ARCHIVED'],
      ['REOPEN', 'OPEN'],
      ['REOPEN', 'ARCHIVED'],
      ['ARCHIVE', 'OPEN'],
      ['ARCHIVE', 'ARCHIVED'],
    ] as const) {
      expect(() => p(c, f)).toThrow(/Invalid application state transition/);
    }
  });

  it('guards optimistic concurrency and message acceptance', () => {
    expect(() =>
      planThreadTransition({
        command: 'CLOSE',
        from: 'OPEN',
        expectedStatus: 'OPEN',
        expectedVersion: 1,
        currentVersion: 2,
      }),
    ).toThrow();
    expect(() => assertThreadAcceptsMessages('OPEN')).not.toThrow();
    expect(() => assertThreadAcceptsMessages('CLOSED')).toThrow();
    expect(() => assertThreadAcceptsMessages('ARCHIVED')).toThrow();
    expect(isThreadCommand('CLOSE')).toBe(true);
    expect(isThreadCommand('DELETE')).toBe(false);
    expect(isThreadStatus('OPEN')).toBe(true);
    expect(isThreadStatus(1)).toBe(false);
    expect(isMessageKind('OFFICIAL_NOTICE')).toBe(true);
    expect(isMessageKind('SMS')).toBe(false);
  });
});

describe('input parsing', () => {
  it('notice senders must be authority-side actor types', () => {
    for (const t of ['OFFICER', 'SYSTEM', 'PRIVILEGED_ADMIN'] as const) {
      expect(() => assertNoticeSenderIsAuthority(t)).not.toThrow();
    }
    for (const t of ['CITIZEN', 'INTEGRATION'] as const) {
      expect(() => assertNoticeSenderIsAuthority(t)).toThrow();
    }
  });

  it('parses bodies, keys, participants, sequences and page sizes strictly', () => {
    expect(parseBody('ok')).toBe('ok');
    expect(() => parseBody(5)).toThrow();
    expect(() => parseBody('')).toThrow();
    expect(bodyDigest('a')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parseStorageKey('tenant/aaaaaaaa/objects/x1', '/k')).toBe('tenant/aaaaaaaa/objects/x1');
    expect(() => parseStorageKey(7, '/k')).toThrow();
    expect(parseStorageKeys(undefined)).toEqual([]);
    expect(
      parseParticipant({ actor_id: CITIZEN.toUpperCase(), role_code: 'APPLICANT' }, T1, '/p'),
    ).toEqual({
      actor_id: CITIZEN,
      role_code: 'APPLICANT',
    });
    expect(
      parseParticipant({ actor_id: CITIZEN, role_code: 'APPLICANT', tenant_id: T1 }, T1, '/p')
        .role_code,
    ).toBe('APPLICANT');
    expect(() =>
      parseParticipant({ actor_id: CITIZEN, role_code: 'APPLICANT', tenant_id: T2 }, T1, '/p'),
    ).toThrow(/Cross-tenant/);
    expect(() => parseParticipant({ actor_id: 'x', role_code: 'APPLICANT' }, T1, '/p')).toThrow();
    expect(() => parseParticipant({ actor_id: CITIZEN, role_code: 'lower' }, T1, '/p')).toThrow();
    expect(() =>
      parseParticipant({ actor_id: CITIZEN, role_code: 'A_B', extra: 1 }, T1, '/p'),
    ).toThrow();
    expect(() => parseParticipant([], T1, '/p')).toThrow();
    expect(parseSequence('12', '/s', 0)).toBe(12);
    expect(parseSequence(0, '/s', 0)).toBe(0);
    expect(() => parseSequence(1.5, '/s', 0)).toThrow();
    expect(() => parseSequence('-1', '/s', 0)).toThrow();
    expect(parsePageSize(undefined)).toBe(50);
    expect(parsePageSize('100')).toBe(100);
    expect(() => parsePageSize('abc')).toThrow();
  });

  it('participant references are stable, opaque and thread-specific', () => {
    const a = participantRef('t1', CITIZEN);
    expect(a).toMatch(/^p-[0-9a-f]{24}$/);
    expect(participantRef('t1', CITIZEN)).toBe(a);
    expect(participantRef('t2', CITIZEN)).not.toBe(a);
    expect(a).not.toContain(CITIZEN);
  });
});

describe('shared contract validators', () => {
  it('request context, actor, authz output, envelope and audit validators accept/reject', () => {
    const c = ctx(T1, 'CITIZEN', CITIZEN);
    expect(isRequestContext(c)).toBe(true);
    expect(isRequestContext({ ...c, extra: 1 })).toBe(false);
    expect(isRequestContext({ ...c, roles: ['A', 'A'] })).toBe(false);
    expect(isRequestContext({ ...c, trace_id: 'x' })).toBe(false);
    expect(isRequestContext({ ...c, cell_id: 'BAD' })).toBe(false);
    expect(isRequestContext({ ...c, organisation_id: 'bad' })).toBe(false);
    expect(isRequestContext({ ...c, purpose: 'lower' })).toBe(false);
    const { purpose: _purpose, ...noPurpose } = ctx(T1, 'INTEGRATION', OFFICER);
    expect(isRequestContext(noPurpose)).toBe(false);
    expect(isActor({ type: 'CITIZEN', id: CITIZEN })).toBe(true);
    expect(isActor({ type: 'ROBOT', id: CITIZEN })).toBe(false);
    expect(
      isAuthzDecisionOutput({
        allow: true,
        reason_code: 'ALLOW',
        policy_revision: 'r1',
        decision_id: CITIZEN,
      }),
    ).toBe(true);
    expect(isAuthzDecisionOutput({ allow: 'yes' })).toBe(false);
    const env = envelopeOf({
      eventType: 'ThreadOpened',
      ctx: c,
      aggregateId: CITIZEN,
      aggregateVersion: 1,
      occurredAt: '2026-10-06T12:00:00.000Z',
      data: {},
    });
    expect(isEventEnvelope(env)).toBe(true);
    expect(isEventEnvelope({ ...env, extra: 1 })).toBe(false);
    expect(isEventEnvelope({ ...env, occurred_at: 'yesterday' })).toBe(false);
    expect(() =>
      envelopeOf({
        eventType: 'bad type',
        ctx: c,
        aggregateId: CITIZEN,
        aggregateVersion: 1,
        occurredAt: '2026-10-06T12:00:00.000Z',
        data: {},
      }),
    ).toThrow();
    const audit = auditEnvelope(c, {
      action: 'MESSAGE_SEND',
      actionClass: 'WRITE',
      resourceId: CITIZEN,
      result: 'SUCCESS',
      occurredAt: '2026-10-06T12:00:00.000Z',
      reason: 'because',
      afterRef: 'x',
    });
    expect(isAuditEvent(audit.data)).toBe(true);
    expect(isAuditEvent({ ...audit.data, action_class: 'DECISION', reason: undefined })).toBe(
      false,
    );
    expect(() =>
      auditEnvelope(c, {
        action: 'bad action',
        actionClass: 'WRITE',
        resourceId: CITIZEN,
        result: 'SUCCESS',
        occurredAt: '2026-10-06T12:00:00.000Z',
      }),
    ).toThrow();
    const withOrg = auditEnvelope(
      { ...c, office_id: CITIZEN },
      {
        action: 'MESSAGE_SEND',
        actionClass: 'WRITE',
        resourceId: CITIZEN,
        result: 'SUCCESS',
        occurredAt: '2026-10-06T12:00:00.000Z',
      },
    );
    expect(withOrg.data).toMatchObject({ office_id: CITIZEN });
  });

  it('canonical hashing is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    expect(sha256Of({ a: 1, b: 2 })).toBe(sha256Of({ b: 2, a: 1 }));
    expect(canonicalJson(null)).toBe('null');
  });
});
