import { describe, expect, it } from 'vitest';
import { handleCreateSession } from '../lib/handlers';

const tenantA = '11111111-1111-4111-8111-111111111111';
const actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('admin BFF session', () => {
  it('opens a tenant_admin session', async () => {
    const res = await handleCreateSession(
      new Request('http://admin.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantA, actor_id: actor, roles: ['TENANT_ADMIN'] }),
      }),
      'tenant_admin',
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { surface: string; tenant_id: string };
    expect(body.surface).toBe('tenant_admin');
    expect(body.tenant_id).toBe(tenantA);
  });
});
