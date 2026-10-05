import { describe, expect, it } from 'vitest';
import { parseAssignment, sameAssignment } from '../../src/domain/assignment.js';
import { requestFingerprint } from '../../src/domain/fingerprint.js';
import { matchesAssignment, mismatches, scopeFromContext } from '../../src/domain/resolution.js';
import { canApply, isTerminal, targetState } from '../../src/domain/states.js';
import type { Cmp017Error } from '../../src/errors.js';
import {
  ctxFor,
  JUR_2,
  OFFICER_1,
  ORG_1,
  ORG_2,
  SCOPE_1,
  SCRUTINY_ASSIGNMENT,
} from '../doubles/fixtures.js';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as Cmp017Error).details?.[0]?.code;
  }
  return undefined;
}

describe('state machine', () => {
  it('allows only the frozen lifecycle edges', () => {
    expect(canApply('CLAIM', 'OPEN')).toBe(true);
    expect(canApply('CLAIM', 'CLAIMED')).toBe(false);
    expect(canApply('CLAIM', 'COMPLETED')).toBe(false);
    expect(canApply('CLAIM', 'CANCELLED_CLOSED')).toBe(false);
    expect(canApply('UNCLAIM', 'OPEN')).toBe(false);
    expect(canApply('COMPLETE', 'OPEN')).toBe(false);
    expect(canApply('COMPLETE', 'CLAIMED')).toBe(true);
    expect(canApply('REASSIGN', 'COMPLETED')).toBe(false);
    expect(canApply('CANCEL_CLOSE', 'COMPLETED')).toBe(false);
    expect(targetState('REASSIGN')).toBe('OPEN');
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('OPEN')).toBe(false);
  });
});

describe('assignment metadata (Constitution #19)', () => {
  it('accepts role + organisation/office + jurisdiction + service scope only', () => {
    const a = parseAssignment({ ...SCRUTINY_ASSIGNMENT, service_scope_id: SCOPE_1 });
    expect(a.service_scope_id).toBe(SCOPE_1);
    expect(sameAssignment(a, a)).toBe(true);
  });

  it.each([
    'named_officer',
    'officer_id',
    'assignee',
    'assigned_to_user',
    'employee_code',
    'claimed_principal_id',
    'email',
    'principal_id',
  ])('rejects person-identifying key %s with NAMED_OFFICER_FORBIDDEN', (key) => {
    expect(
      code(() => parseAssignment({ ...SCRUTINY_ASSIGNMENT, [key]: 'Permanent Assignee' })),
    ).toBe('NAMED_OFFICER_FORBIDDEN');
  });

  it('rejects unknown, null and malformed criteria', () => {
    expect(code(() => parseAssignment({ ...SCRUTINY_ASSIGNMENT, region: 'x' }))).toBe(
      'UNKNOWN_FIELD',
    );
    expect(code(() => parseAssignment({ ...SCRUTINY_ASSIGNMENT, office_id: null }))).toBe(
      'INVALID_FIELD',
    );
    expect(code(() => parseAssignment({ ...SCRUTINY_ASSIGNMENT, role_code: 'jane.doe' }))).toBe(
      'INVALID_FIELD',
    );
    expect(code(() => parseAssignment({ ...SCRUTINY_ASSIGNMENT, jurisdiction_id: 'x' }))).toBe(
      'INVALID_FIELD',
    );
    expect(code(() => parseAssignment('nope'))).toBe('OBJECT_REQUIRED');
  });
});

describe('assignment resolution', () => {
  const ctx = ctxFor(OFFICER_1);
  const a = parseAssignment(SCRUTINY_ASSIGNMENT);

  it('matches on role, organisation, office and jurisdiction', () => {
    expect(matchesAssignment(a, scopeFromContext(ctx))).toBe(true);
  });

  it('reports every failing dimension without personal data', () => {
    const other = ctxFor(OFFICER_1, {
      roles: ['CLERK'],
      organisation_id: ORG_2,
      office_id: undefined,
      jurisdiction_ids: [JUR_2],
    });
    expect(mismatches(a, scopeFromContext(other))).toEqual([
      'ROLE',
      'ORGANISATION',
      'OFFICE',
      'JURISDICTION',
    ]);
  });

  it('requires service scope only when the task is scoped, and widens via owning-component ports', () => {
    const scoped = { ...a, service_scope_id: SCOPE_1 };
    expect(mismatches(scoped, scopeFromContext(ctx))).toEqual(['SERVICE_SCOPE']);
    expect(
      matchesAssignment(
        scoped,
        scopeFromContext(ctx, {
          service_scope_ids: [SCOPE_1],
          jurisdiction_ids: [JUR_2],
          organisation_ids: [ORG_1],
        }),
      ),
    ).toBe(true);
    const noOffice = { ...a, office_id: null };
    expect(
      matchesAssignment(noOffice, scopeFromContext(ctxFor(OFFICER_1, { office_id: undefined }))),
    ).toBe(true);
  });
});

describe('request fingerprint', () => {
  it('is order-insensitive for objects and binds method and endpoint', () => {
    const f1 = requestFingerprint('POST', '/x', { a: 1, b: { c: 2, d: [1, 2] } });
    const f2 = requestFingerprint('POST', '/x', { b: { d: [1, 2], c: 2 }, a: 1 });
    expect(f1).toBe(f2);
    expect(f1).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(requestFingerprint('POST', '/y', { a: 1 })).not.toBe(
      requestFingerprint('POST', '/x', { a: 1 }),
    );
    expect(requestFingerprint('POST', '/x', undefined)).toBe(
      requestFingerprint('POST', '/x', null),
    );
  });
});
