import { describe, expect, it } from 'vitest';
import { Cmp050Error } from '../../src/errors.js';
import { assertNoTenantIdentifyingHeaders, isForbiddenHeaderName } from '../../src/headers.js';

describe('INT-011 portal header refusal', () => {
  it('rejects tenant and x-sf headers', () => {
    expect(isForbiddenHeaderName('X-Tenant-Id')).toBe(true);
    expect(isForbiddenHeaderName('x-sf-tenant')).toBe(true);
    expect(isForbiddenHeaderName('x-roles')).toBe(true);
    expect(isForbiddenHeaderName('content-type')).toBe(false);
    expect(() => assertNoTenantIdentifyingHeaders({ 'x-tenant-id': 'anything' })).toThrow(
      Cmp050Error,
    );
    expect(() => assertNoTenantIdentifyingHeaders({ forwarded: 'for=1.1.1.1;tenant=abc' })).toThrow(
      Cmp050Error,
    );
  });

  it('allows ordinary headers', () => {
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        'content-type': 'application/json',
        accept: 'application/json',
      }),
    ).not.toThrow();
  });
});
