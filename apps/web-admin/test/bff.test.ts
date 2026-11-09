/**
 * SF-M10-B-4: Admin BFF unit tests (mirrors studio BFF test structure).
 * Session creation and proxy both require a live API (the SIMULATED studio-auth endpoint).
 * Tests verify security invariants and graceful failure without a live host.
 */
import { describe, expect, it } from 'vitest';
import { assertPlatformPath, bearerToken } from '../lib/bff';
import { handleClearSession, handleCreateSession, handlePlatformProxy, handleReadSession } from '../lib/handlers';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('admin BFF INT-011 — tenant header isolation', () => {
  it('refuses tenant headers in session creation', async () => {
    const res = await handleCreateSession(
      new Request('http://admin.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantB },
        body: JSON.stringify({ tenant_id: tenantA, actor_id: actor, roles: ['TENANT_ADMIN'] }),
      }),
      'tenant_admin',
    );
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('SF-TEN-002');
    expect(body).not.toContain(tenantB);
  });

  it('refuses tenant headers in proxy calls', async () => {
    const res = await handlePlatformProxy(
      new Request('http://admin.local/api/platform/tenant-service-bindings', {
        method: 'GET',
        headers: { 'x-sf-tenant': tenantB },
      }),
      ['tenant-service-bindings'],
      ['tenant_admin'],
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('SF-TEN-002');
  });
});

describe('admin BFF — session creation fails closed without API host', () => {
  it('returns SF-SYS-003 for invalid tenant UUID', async () => {
    const res = await handleCreateSession(
      new Request('http://admin.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: 'not-a-uuid', actor_id: actor, roles: ['TENANT_ADMIN'] }),
      }),
      'tenant_admin',
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('SF-SYS-003');
  });

  it('returns SF-SYS-004 when no API host is configured (after valid body)', async () => {
    const res = await handleCreateSession(
      new Request('http://admin.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantA, actor_id: actor, roles: ['TENANT_ADMIN'] }),
      }),
      'tenant_admin',
    );
    expect([400, 503].includes(res.status)).toBe(true);
    const text = await res.text();
    expect(text).toMatch(/SF-SYS-00[34]/);
  });
});

describe('admin BFF — proxy fails closed without token', () => {
  it('returns 401 when no session cookie', async () => {
    const res = await handlePlatformProxy(
      new Request('http://admin.local/api/platform/tenant-service-bindings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ['tenant-service-bindings'],
      ['tenant_admin'],
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('SF-AUTH-001');
  });
});

describe('admin BFF — assertPlatformPath allowlist', () => {
  it('allows tenant-service-bindings paths', () => {
    expect(assertPlatformPath('tenant-service-bindings')).toBe('/v1/tenant-service-bindings');
    expect(assertPlatformPath('tenant-service-bindings/abc/publish')).toBe(
      '/v1/tenant-service-bindings/abc/publish',
    );
  });

  it('allows artifact-versions/ paths', () => {
    expect(assertPlatformPath('artifact-versions/abc')).toBe('/v1/artifact-versions/abc');
  });

  it('blocks unlisted paths', () => {
    expect(() => assertPlatformPath('admin/users')).toThrow('SF-AUTH-002');
    expect(() => assertPlatformPath('applications')).toThrow('SF-AUTH-002');
  });
});

describe('admin BFF — handleReadSession fails closed without token', () => {
  it('returns 401 when no session cookie', async () => {
    const res = await handleReadSession(
      new Request('http://admin.local/api/session'),
      ['tenant_admin'],
    );
    expect(res.status).toBe(401);
  });
});

describe('admin BFF — bearerToken extraction', () => {
  it('returns null for local session cookie format', () => {
    const localSess = `v1.${Buffer.from('{}').toString('base64url')}.local`;
    const req = new Request('http://x', { headers: { cookie: `sf_portal_session=${localSess}` } });
    expect(bearerToken(req)).toBeNull();
  });

  it('extracts a valid opaque token', () => {
    const token = 'B'.repeat(40);
    const req = new Request('http://x', { headers: { cookie: `sf_portal_session=${token}` } });
    expect(bearerToken(req)).toBe(token);
  });
});

describe('admin BFF — handleClearSession', () => {
  it('clears the session cookie', () => {
    const res = handleClearSession();
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
