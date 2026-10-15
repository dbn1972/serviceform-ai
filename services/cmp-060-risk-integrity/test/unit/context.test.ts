import { describe, it, expect } from 'vitest';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  isUuid,
} from '../../src/context.js';
import { Cmp060Error } from '../../src/errors.js';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = '11111111-1111-4111-8111-111111111111';
const CORR = '44444444-4444-4444-8444-444444444444';

describe('context (INT-011)', () => {
  it('accepts UUIDs', () => {
    expect(isUuid(TENANT)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });

  it('rejects tenant-identifying headers', () => {
    expect(() => assertNoTenantIdentifyingHeaders({ 'x-tenant-id': TENANT })).toThrow(Cmp060Error);
    expect(() => assertNoTenantIdentifyingHeaders({ 'x-sf-tenant': TENANT })).toThrow(Cmp060Error);
  });

  it('allows benign headers', () => {
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        authorization: 'Bearer x',
        'content-type': 'application/json',
      }),
    ).not.toThrow();
  });

  it('requireTenantContext fails closed without tenant', () => {
    expect(() =>
      requireTenantContext({
        tenant_id: null,
        cell_id: 'cell-platform',
        correlation_id: CORR,
        trace_id: 'trace-1',
        actor: { id: ACTOR, type: 'SYSTEM' },
        roles: [],
        jurisdiction_ids: [],
      }),
    ).toThrow(Cmp060Error);
  });

  it('requireTenantContext accepts valid tenant context', () => {
    const ctx = requireTenantContext({
      tenant_id: TENANT,
      cell_id: 'cell-platform',
      correlation_id: CORR,
      trace_id: 'trace-1',
      actor: { id: ACTOR, type: 'SYSTEM' },
      roles: ['officer'],
      jurisdiction_ids: [],
    });
    expect(ctx.tenant_id).toBe(TENANT);
  });
});
