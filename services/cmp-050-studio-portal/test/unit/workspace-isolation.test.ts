import { describe, expect, it } from 'vitest';
import { Cmp050Error } from '../../src/errors.js';
import { TenantWorkspace } from '../../src/workspace.js';
import { sessionFromLogin } from '../../src/session.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('TenantWorkspace INT-011 CROSS_TENANT_LEAKAGE=0', () => {
  it('isolates bags and object references', () => {
    const ws = new TenantWorkspace<{ secret: string }>();
    const a = sessionFromLogin({
      tenant_id: tenantA,
      actor_id: actor,
      roles: ['STUDIO_DESIGNER'],
      surface: 'service_studio',
    });
    const b = sessionFromLogin({
      tenant_id: tenantB,
      actor_id: actor,
      roles: ['STUDIO_DESIGNER'],
      surface: 'service_studio',
    });
    const record = { secret: 'tenant-a-only' };
    ws.set(a, 'doc-1', record);
    expect(ws.get(b, 'doc-1')).toBeUndefined();
    ws.set(b, 'doc-1', { secret: 'tenant-b-only' });
    expect(ws.get(a, 'doc-1')?.secret).toBe('tenant-a-only');
    expect(() => ws.assertNoCrossTenantLeakage(tenantA, tenantB)).not.toThrow();
    ws.bag(b).set('leaked', record);
    expect(() => ws.assertNoCrossTenantLeakage(tenantA, tenantB)).toThrow(Cmp050Error);
  });
});
