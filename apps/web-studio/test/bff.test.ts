import { describe, expect, it } from 'vitest';
import { handleCreateSession, handlePlatformProxy, handleReadSession } from '../lib/handlers';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('studio BFF INT-011', () => {
  it('refuses tenant headers and does not echo the canary tenant', async () => {
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantB },
        body: JSON.stringify({ tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] }),
      }),
      'service_studio',
    );
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('SF-TEN-002');
    expect(body).not.toContain(tenantB);
  });

  it('binds the session tenant and fails closed without API host', async () => {
    const created = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] }),
      }),
      'service_studio',
    );
    expect(created.status).toBe(201);
    const cookie = created.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    const read = handleReadSession(
      new Request('http://studio.local/api/session', { headers: { cookie: cookie ?? '' } }),
      ['service_studio'],
    );
    expect(read.status).toBe(200);
    expect(((await read.json()) as { tenant_id: string }).tenant_id).toBe(tenantA);

    const proxied = await handlePlatformProxy(
      new Request('http://studio.local/api/platform/metadata/documents', {
        method: 'POST',
        headers: { cookie: cookie ?? '', 'content-type': 'application/json' },
        body: '{}',
      }),
      ['metadata', 'documents'],
      ['service_studio'],
    );
    expect(proxied.status).toBe(503);
    const denied = JSON.parse(await proxied.text()) as { error_code: string };
    expect(denied.error_code).toBe('SF-SYS-004');
    expect(JSON.stringify(denied)).not.toContain(tenantB);
  });

  it('rejects non-UUID tenant/actor ids without regex matching', async () => {
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant_id: `${'a'.repeat(4000)}-not-uuid`,
          actor_id: actor,
          roles: ['STUDIO_DESIGNER'],
        }),
      }),
      'service_studio',
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('SF-SYS-003');
  });
});
