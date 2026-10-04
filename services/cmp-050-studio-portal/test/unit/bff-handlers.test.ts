import { describe, expect, it } from 'vitest';
import {
  createSessionResponse,
  proxyPlatformResponse,
  readSessionResponse,
} from '../../src/bff-handlers.js';
import { loadPortalConfig } from '../../src/config.js';
import { SESSION_COOKIE } from '../../src/session.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = loadPortalConfig({ SF_ENVIRONMENT: 'LOCAL' });

describe('BFF session + proxy (INT-011)', () => {
  it('refuses client tenant headers on login', () => {
    const res = createSessionResponse({
      headers: { 'x-tenant-id': tenantB },
      body: { tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] },
      surface: 'service_studio',
      config,
      secureCookie: false,
    });
    expect(res.status).toBe(403);
    expect((res.body as { error_code: string }).error_code).toBe('SF-TEN-002');
    expect(JSON.stringify(res.body)).not.toContain(tenantB);
  });

  it('issues a tenant-scoped cookie and refuses the other tenant on forged header later', async () => {
    const created = createSessionResponse({
      headers: { 'content-type': 'application/json' },
      body: { tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] },
      surface: 'service_studio',
      config,
      secureCookie: false,
    });
    expect(created.status).toBe(201);
    expect(created.setCookie).toContain(SESSION_COOKIE);
    expect(JSON.stringify(created.body)).toContain(tenantA);
    const cookie = created.setCookie?.split(';')[0];
    const read = readSessionResponse({
      headers: {},
      cookieHeader: cookie,
      expectedSurface: 'service_studio',
      config,
    });
    expect(read.status).toBe(200);
    expect((read.body as { tenant_id: string }).tenant_id).toBe(tenantA);

    const denied = await proxyPlatformResponse({
      headers: { 'x-sf-tenant': tenantB },
      cookieHeader: cookie,
      method: 'GET',
      pathParts: ['metadata', 'documents', 'd0000000-0000-4000-8000-000000000001'],
      body: undefined,
      expectedSurface: 'service_studio',
      config,
      fetchImpl: (async () => new Response('{}')) as typeof fetch,
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain(tenantB);
  });

  it('fails closed when the host API is unset', async () => {
    const created = createSessionResponse({
      headers: {},
      body: { tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] },
      surface: 'service_studio',
      config,
      secureCookie: false,
    });
    const proxied = await proxyPlatformResponse({
      headers: {},
      cookieHeader: created.setCookie?.split(';')[0],
      method: 'POST',
      pathParts: ['metadata', 'documents'],
      body: {
        kind: 'SERVICE',
        document_key: 'generic.service',
        payload: { code: 'generic_service', title: 'x' },
      },
      expectedSurface: 'service_studio',
      config,
      fetchImpl: (async () => new Response('{}')) as typeof fetch,
    });
    expect(proxied.status).toBe(503);
    expect((proxied.body as { error_code: string }).error_code).toBe('SF-SYS-004');
  });
});
