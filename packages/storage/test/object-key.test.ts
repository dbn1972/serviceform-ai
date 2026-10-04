import { describe, expect, it } from 'vitest';
import { buildObjectKey, newObjectId } from '../src/object-key.js';

describe('object-key', () => {
  it('builds tenant/cell scoped key without PII', () => {
    const objectId = newObjectId();
    const key = buildObjectKey({
      tenantId: '11111111-1111-4111-8111-111111111111',
      cellId: 'cell-01',
      objectId,
      contentSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    });
    expect(key).toContain('t/11111111-1111-4111-8111-111111111111/');
    expect(key).toContain('/c/cell-01/');
    expect(key).toContain(`/o/${objectId}/`);
    expect(key.endsWith('/abcdef012345')).toBe(true);
  });
});
