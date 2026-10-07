import { describe, expect, it } from 'vitest';
import {
  parseAssignment,
  planTransition,
  resolveTransition,
  TRANSITIONS,
} from '../../src/domain/model.js';
import { Cmp027Error } from '../../src/errors.js';

describe('CMP-027 domain machine', () => {
  it('FILED categorise then route then assign then resolve then close', () => {
    expect(resolveTransition('CATEGORISE', 'FILED')?.to).toBe('CATEGORISED');
    expect(resolveTransition('ROUTE', 'CATEGORISED')?.to).toBe('ROUTED');
    expect(resolveTransition('REQUEST_ASSIGNMENT', 'ROUTED')?.to).toBe('OPEN');
    expect(resolveTransition('RESOLVE', 'OPEN')?.to).toBe('RESOLVED');
    expect(resolveTransition('CLOSE', 'RESOLVED')?.to).toBe('CLOSED');
  });

  it('rejects illegal transitions and stale versions', () => {
    expect(() =>
      planTransition({
        command: 'CLOSE',
        from: 'FILED',
        expectedStatus: 'FILED',
        expectedVersion: 1,
        currentVersion: 1,
      }),
    ).toThrow(Cmp027Error);
    expect(() =>
      planTransition({
        command: 'CATEGORISE',
        from: 'FILED',
        expectedStatus: 'FILED',
        expectedVersion: 1,
        currentVersion: 2,
      }),
    ).toThrow(Cmp027Error);
  });

  it('refuses named officers in assignment metadata', () => {
    expect(() =>
      parseAssignment({
        role_code: 'GRIEVANCE_OFFICER',
        organisation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        jurisdiction_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        officer_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    ).toThrow(Cmp027Error);
    const a = parseAssignment({
      role_code: 'GRIEVANCE_OFFICER',
      organisation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jurisdiction_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      office_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      service_scope_id: null,
    });
    expect(a.role_code).toBe('GRIEVANCE_OFFICER');
    expect(TRANSITIONS.length).toBeGreaterThan(8);
  });
});
