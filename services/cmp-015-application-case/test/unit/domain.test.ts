import { describe, expect, it } from 'vitest';
import { assertDecisionBoundary, parseDecision } from '../../src/domain/decision-boundary.js';
import {
  CANCELLATION_SOURCES,
  COMMANDS,
  isForbiddenAuthoritativeState,
  isLegalState,
  isRequestStatusChangeLegal,
  isTransitionCommand,
  LEGAL_STATES,
  requestKindFor,
  requestSources,
  resolveTransition,
  TRANSITIONS,
  WITHDRAWAL_SOURCES,
} from '../../src/domain/model.js';
import {
  assertSamePins,
  parsePinGraph,
  pinGraphHash,
  versionPinningRecord,
} from '../../src/domain/pins.js';
import {
  parseExpectedVersion,
  planTransition,
  stateMachineRecord,
} from '../../src/domain/state-machine.js';
import {
  canonicalJson,
  isAuditEvent,
  isEventEnvelope,
  isRequestContext,
  sha256Of,
} from '../../src/domain/validate.js';
import type { Cmp015Error } from '../../src/errors.js';
import { CITIZEN, ctx, OFFICER, pinsFor, SYSTEM, T1, TSB_T1 } from '../doubles/fixtures.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const err = e as Cmp015Error;
    return `${err.code}:${err.details?.[0]?.code ?? ''}`;
  }
  return 'OK';
}

describe('state machine table (SF-CON-APPLICATION-CASE-SM)', () => {
  it('has 39 transitions: 21 always-legal, 10 withdrawal, 8 cancellation; none ALWAYS_LEGAL into WITHDRAWN/CANCELLED', () => {
    expect(TRANSITIONS).toHaveLength(39);
    expect(TRANSITIONS.filter((t) => t.cls === 'ALWAYS_LEGAL')).toHaveLength(21);
    expect(TRANSITIONS.filter((t) => t.cls === 'POLICY_GATED_WITHDRAWAL')).toHaveLength(10);
    expect(TRANSITIONS.filter((t) => t.cls === 'POLICY_GATED_CANCELLATION')).toHaveLength(8);
    expect(
      TRANSITIONS.filter(
        (t) => ['WITHDRAWN', 'CANCELLED'].includes(t.to) && t.cls === 'ALWAYS_LEGAL',
      ),
    ).toEqual([]);
  });

  it('maps each (command, from_state) pair to at most one transition', () => {
    const seen = new Set(TRANSITIONS.map((t) => `${t.command}|${t.from}`));
    expect(seen.size).toBe(TRANSITIONS.length);
  });

  it('every command except CREATE_DRAFT drives at least one transition', () => {
    for (const c of COMMANDS.filter((x) => x !== 'CREATE_DRAFT')) {
      expect(TRANSITIONS.some((t) => t.command === c)).toBe(true);
    }
  });

  it('never admits *_REQUESTED tokens as states', () => {
    expect(isLegalState('WITHDRAWAL_REQUESTED')).toBe(false);
    expect(isLegalState('CANCELLATION_REQUESTED')).toBe(false);
    expect(isForbiddenAuthoritativeState('WITHDRAWAL_REQUESTED')).toBe(true);
    expect(isForbiddenAuthoritativeState('DRAFT')).toBe(false);
    expect(LEGAL_STATES).toHaveLength(17);
  });

  it('helpers', () => {
    expect(isTransitionCommand('CREATE_DRAFT')).toBe(false);
    expect(isTransitionCommand('SUBMIT')).toBe(true);
    expect(isTransitionCommand(5)).toBe(false);
    expect(resolveTransition('SUBMIT', 'DRAFT')).toBeUndefined();
    expect(requestKindFor('ALWAYS_LEGAL')).toBeNull();
    expect(requestKindFor('POLICY_GATED_CANCELLATION')).toBe('CANCELLATION');
    expect(requestSources('WITHDRAWAL')).toBe(WITHDRAWAL_SOURCES);
    expect(requestSources('CANCELLATION')).toBe(CANCELLATION_SOURCES);
    expect(isRequestStatusChangeLegal('SUBMITTED', 'COMMITTED')).toBe(true);
    expect(isRequestStatusChangeLegal('COMMITTED', 'REJECTED')).toBe(false);
    expect(isRequestStatusChangeLegal('UNDER_REVIEW', 'SUBMITTED')).toBe(false);
  });
});

describe('planTransition', () => {
  const base = {
    command: 'SUBMIT' as const,
    expectedState: 'READY_TO_SUBMIT',
    expectedVersion: 2,
    currentState: 'READY_TO_SUBMIT',
    currentVersion: 2,
  };

  it('plans a legal transition with a +1 version', () => {
    const plan = planTransition(base);
    expect(plan).toMatchObject({
      fromVersion: 2,
      toVersion: 3,
      def: { key: 'READY_TO_SUBMIT>SUBMITTED', cls: 'ALWAYS_LEGAL' },
    });
  });

  it('rejects stale, illegal, forbidden and corrupt inputs', () => {
    expect(codeOf(() => planTransition({ ...base, expectedState: 'DRAFT' }))).toBe(
      'SF-APP-001:STALE_EXPECTED_STATE',
    );
    expect(codeOf(() => planTransition({ ...base, expectedVersion: 1 }))).toBe(
      'SF-APP-001:STALE_VERSION',
    );
    expect(codeOf(() => planTransition({ ...base, command: 'CLOSE' }))).toBe(
      'SF-APP-001:ILLEGAL_TRANSITION',
    );
    expect(codeOf(() => planTransition({ ...base, expectedState: 'WITHDRAWAL_REQUESTED' }))).toBe(
      'SF-APP-001:REQUEST_CONSTRUCT_IS_NOT_A_STATE',
    );
    expect(codeOf(() => planTransition({ ...base, expectedState: 'NOPE' }))).toBe(
      'SF-SYS-003:EXPECTED_STATE_INVALID',
    );
    expect(codeOf(() => planTransition({ ...base, currentState: 'CANCELLATION_REQUESTED' }))).toBe(
      'SF-SYS-001:STORED_STATE_INVALID',
    );
    expect(
      codeOf(() =>
        planTransition({ ...base, requestConstruct: { kind: 'WITHDRAWAL', status: 'COMMITTED' } }),
      ),
    ).toBe('SF-SYS-003:REQUEST_NOT_APPLICABLE');
  });

  it('gates WITHDRAWN/CANCELLED on a committed request construct of the same kind', () => {
    const w = {
      command: 'COMMIT_WITHDRAWAL' as const,
      expectedState: 'DRAFT',
      expectedVersion: 1,
      currentState: 'DRAFT',
      currentVersion: 1,
    };
    expect(codeOf(() => planTransition(w))).toBe('SF-APP-001:REQUEST_NOT_COMMITTED');
    expect(
      codeOf(() =>
        planTransition({ ...w, requestConstruct: { kind: 'WITHDRAWAL', status: 'UNDER_REVIEW' } }),
      ),
    ).toBe('SF-APP-001:REQUEST_NOT_COMMITTED');
    expect(
      codeOf(() =>
        planTransition({ ...w, requestConstruct: { kind: 'CANCELLATION', status: 'COMMITTED' } }),
      ),
    ).toBe('SF-APP-001:REQUEST_NOT_COMMITTED');
    expect(
      planTransition({ ...w, requestConstruct: { kind: 'WITHDRAWAL', status: 'COMMITTED' } }).def
        .to,
    ).toBe('WITHDRAWN');
    expect(
      codeOf(() =>
        planTransition({
          ...w,
          command: 'COMMIT_CANCELLATION',
          requestConstruct: { kind: 'CANCELLATION', status: 'COMMITTED' },
        }),
      ),
    ).toBe('SF-APP-001:ILLEGAL_TRANSITION');
  });

  it('builds a contract-shaped state-machine record', () => {
    const plan = planTransition({
      command: 'COMMIT_CANCELLATION',
      expectedState: 'PAYMENT_PENDING',
      expectedVersion: 4,
      currentState: 'PAYMENT_PENDING',
      currentVersion: 4,
      requestConstruct: { kind: 'CANCELLATION', status: 'COMMITTED' },
    });
    const rec = stateMachineRecord({
      tenantId: T1,
      applicationId: CITIZEN,
      plan,
      idempotencyKey: 'abcdefgh',
      authzDecisionId: OFFICER,
      correlationId: SYSTEM,
      actorType: 'OFFICER',
      actorId: OFFICER,
      reasonCode: 'PAYMENT_TIMEOUT',
      requestConstruct: { kind: 'CANCELLATION', status: 'COMMITTED' },
    });
    expect(rec).toMatchObject({
      transition_class: 'POLICY_GATED_CANCELLATION',
      expected_state: 'PAYMENT_PENDING',
      aggregate_version: 4,
    });
  });

  it('parses expected_version strictly', () => {
    expect(codeOf(() => parseExpectedVersion(0))).toBe('SF-SYS-003:EXPECTED_VERSION_INVALID');
    expect(codeOf(() => parseExpectedVersion('1'))).toBe('SF-SYS-003:EXPECTED_VERSION_INVALID');
    expect(parseExpectedVersion(3)).toBe(3);
  });
});

describe('version pins (SF-CON-VERSION-PINNING)', () => {
  it('parses required and optional pins and refuses unknown/missing/invalid ones', () => {
    const pins = parsePinGraph({ ...pinsFor(TSB_T1), notification_version_id: null });
    expect(pins.tenant_service_binding_id).toBe(TSB_T1);
    expect(codeOf(() => parsePinGraph(null))).toBe('SF-FORM-001:PIN_GRAPH_INVALID');
    expect(codeOf(() => parsePinGraph({ ...pinsFor(TSB_T1), extra: 'x' }))).toBe(
      'SF-FORM-001:PIN_GRAPH_UNKNOWN_FIELD',
    );
    const { form_version_id: _f, ...missing } = pinsFor(TSB_T1);
    expect(codeOf(() => parsePinGraph(missing))).toBe('SF-FORM-001:PIN_REQUIRED');
    expect(codeOf(() => parsePinGraph({ ...pinsFor(TSB_T1), fee_policy_version_id: 'x' }))).toBe(
      'SF-FORM-001:PIN_INVALID',
    );
  });

  it('hash is order-independent; any repoint is refused', () => {
    const a = pinsFor(TSB_T1);
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(pinGraphHash(a)).toBe(pinGraphHash(reordered));
    expect(() => assertSamePins(a, reordered)).not.toThrow();
    expect(codeOf(() => assertSamePins(a, { ...a, workflow_version_id: OFFICER }))).toBe(
      'SF-APP-001:SILENT_REPOINT_FORBIDDEN',
    );
  });

  it('keeps TSB authorization_policy_version_id as provenance and records the runtime revision separately', () => {
    const rec = versionPinningRecord({
      tenantId: T1,
      applicationId: CITIZEN,
      pins: pinsFor(TSB_T1),
      policyRevision: 'rev-9',
    });
    expect(rec.pin_graph.authorization_policy_version_id).toBe(
      '17171717-1717-4171-8171-171717171717',
    );
    expect(rec.runtime_authz_policy_revision).toBe('rev-9');
    expect(rec.runtime_authz_decision_id).toBeUndefined();
  });
});

describe('decision boundary (Constitution #20)', () => {
  it('parses attestations strictly', () => {
    expect(parseDecision(undefined)).toBeUndefined();
    expect(
      parseDecision({ decision_maker: 'HUMAN', ai_assisted: false, basis_ref: 'task:1' }),
    ).toEqual({
      decision_maker: 'HUMAN',
      ai_assisted: false,
      basis_ref: 'task:1',
    });
    expect(codeOf(() => parseDecision('HUMAN'))).toBe('SF-SYS-003:DECISION_INVALID');
    expect(codeOf(() => parseDecision({ decision_maker: 'HUMAN', x: 1 }))).toBe(
      'SF-SYS-003:DECISION_UNKNOWN_FIELD',
    );
    expect(codeOf(() => parseDecision({ decision_maker: 'LLM' }))).toBe(
      'SF-SYS-003:DECISION_MAKER_INVALID',
    );
    expect(codeOf(() => parseDecision({ decision_maker: 'HUMAN', basis_ref: 'has space' }))).toBe(
      'SF-SYS-003:DECISION_BASIS_INVALID',
    );
    expect(codeOf(() => parseDecision({ decision_maker: 'HUMAN', ai_assisted: 'yes' }))).toBe(
      'SF-SYS-003:DECISION_AI_ASSISTED_INVALID',
    );
  });

  it('enforces the boundary', () => {
    const officer = { type: 'OFFICER' as const, id: OFFICER };
    expect(codeOf(() => assertDecisionBoundary(officer, { decision_maker: 'AI' }, false))).toBe(
      'SF-AUTH-002:AI_FINAL_DECISION_FORBIDDEN',
    );
    expect(codeOf(() => assertDecisionBoundary(officer, undefined, false))).toBe('OK');
    expect(codeOf(() => assertDecisionBoundary(officer, { decision_maker: 'HUMAN' }, true))).toBe(
      'OK',
    );
    expect(
      codeOf(() =>
        assertDecisionBoundary(
          { type: 'SYSTEM', id: SYSTEM },
          { decision_maker: 'RULES', basis_ref: 'r:1' },
          true,
        ),
      ),
    ).toBe('OK');
  });
});

describe('structural validators', () => {
  it('request context', () => {
    expect(isRequestContext(ctx(T1, 'CITIZEN', CITIZEN))).toBe(true);
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), extra: 1 })).toBe(false);
    expect(isRequestContext({ ...ctx(T1, 'INTEGRATION', CITIZEN), purpose: undefined })).toBe(
      false,
    );
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), roles: ['A', 'A'] })).toBe(false);
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), office_id: 'x' })).toBe(false);
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), purpose: 'bad purpose' })).toBe(
      false,
    );
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), trace_id: 'x' })).toBe(false);
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), auth_assurance: 'X' })).toBe(false);
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), correlation_id: 'x' })).toBe(false);
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), jurisdiction_ids: ['x'] })).toBe(
      false,
    );
    expect(
      isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), actor: { type: 'AI', id: CITIZEN } }),
    ).toBe(false);
    expect(isRequestContext({ ...ctx(T1, 'CITIZEN', CITIZEN), tenant_id: 'x' })).toBe(false);
    expect(isRequestContext([])).toBe(false);
  });

  it('envelope and audit', () => {
    expect(isEventEnvelope({})).toBe(false);
    expect(isAuditEvent(null)).toBe(false);
    expect(
      isAuditEvent({
        audit_id: CITIZEN,
        occurred_at: '2026-10-05T10:00:00.000Z',
        tenant_id: T1,
        cell_id: 'cell-01',
        actor_type: 'OFFICER',
        actor_id: OFFICER,
        action: 'X_Y',
        action_class: 'DECISION',
        resource_type: 'ApplicationCase',
        resource_id: 'r',
        correlation_id: SYSTEM,
        trace_id: '0af7651916cd43dd8448eb211c80319c',
        result: 'SUCCESS',
      }),
    ).toBe(false);
  });

  it('canonical json and hashing', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: undefined, c: null }] })).toBe(
      '{"a":[1,{"c":null}],"b":1}',
    );
    expect(canonicalJson(undefined)).toBe('null');
    expect(sha256Of({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
