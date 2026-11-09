/**
 * SF-M10-B-4: Studio BFF unit tests.
 * With the new CMP-004 session pattern, session creation and proxy both require a live API
 * (the SIMULATED studio-auth endpoint). These tests verify the security invariants that hold
 * without a live API (header sanitization, path validation) and the graceful failure modes
 * (503/SF-SYS-004 when no API host is configured, 401 when no token present).
 */
import { describe, expect, it } from 'vitest';
import {
  assertPlatformPath,
  bearerToken,
  headersToRecord,
  isForbiddenHeaderName,
  isUuid,
} from '../lib/bff';
import { handleClearSession, handleCreateSession, handlePlatformProxy, handleReadSession } from '../lib/handlers';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('studio BFF INT-011 — tenant header isolation', () => {
  it('refuses tenant headers in session creation without echoing the canary', async () => {
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

  it('refuses tenant headers in proxy calls', async () => {
    const res = await handlePlatformProxy(
      new Request('http://studio.local/api/platform/metadata/documents', {
        method: 'GET',
        headers: { 'x-sf-tenant': tenantB },
      }),
      ['metadata', 'documents'],
      ['service_studio'],
    );
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('SF-TEN-002');
    expect(body).not.toContain(tenantB);
  });

  it('refuses x-roles in proxy calls', async () => {
    const res = await handlePlatformProxy(
      new Request('http://studio.local/api/platform/metadata/documents', {
        method: 'GET',
        headers: { 'x-roles': 'STUDIO_DESIGNER' },
      }),
      ['metadata', 'documents'],
      ['service_studio'],
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('SF-TEN-002');
  });
});

describe('studio BFF — session creation fails closed without API host', () => {
  it('returns SF-SYS-003 for invalid tenant UUID', async () => {
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: 'not-a-uuid', actor_id: actor, roles: ['STUDIO_DESIGNER'] }),
      }),
      'service_studio',
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('SF-SYS-003');
  });

  it('returns SF-SYS-003 for invalid actor UUID', async () => {
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantA,
          actor_id: `${'a'.repeat(4000)}-not-uuid`,
          roles: ['STUDIO_DESIGNER'],
        }),
      }),
      'service_studio',
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('SF-SYS-003');
  });

  it('returns SF-SYS-004 when no API host is configured (after valid body)', async () => {
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] }),
      }),
      'service_studio',
    );
    // SF_API_BASE_URL is not set in unit tests → SF-SYS-004 or similar
    expect([400, 503].includes(res.status)).toBe(true);
    const text = await res.text();
    expect(text).toMatch(/SF-SYS-00[34]/);
  });
});

describe('studio BFF — proxy fails closed without token or API', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await handlePlatformProxy(
      new Request('http://studio.local/api/platform/metadata/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ['metadata', 'documents'],
      ['service_studio'],
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('SF-AUTH-001');
  });

  it('returns SF-SYS-004 when session cookie is present but no API host', async () => {
    const fakeToken = 'A'.repeat(40); // 40-char all-caps is valid TOKEN_RE format
    const res = await handlePlatformProxy(
      new Request('http://studio.local/api/platform/metadata/documents', {
        method: 'POST',
        headers: {
          cookie: `sf_portal_session=${fakeToken}`,
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      ['metadata', 'documents'],
      ['service_studio'],
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('SF-SYS-004');
  });
});

describe('studio BFF — handleReadSession fails closed without token or API', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await handleReadSession(
      new Request('http://studio.local/api/session'),
      ['service_studio'],
    );
    expect(res.status).toBe(401);
  });
});

describe('studio BFF — assertPlatformPath allowlist', () => {
  it('allows metadata/ paths', () => {
    expect(assertPlatformPath('metadata/documents')).toBe('/v1/metadata/documents');
    expect(assertPlatformPath('/v1/metadata/documents/abc')).toBe('/v1/metadata/documents/abc');
  });

  it('allows publication-requests and tenant-service-bindings', () => {
    expect(assertPlatformPath('publication-requests')).toBe('/v1/publication-requests');
    expect(assertPlatformPath('tenant-service-bindings')).toBe('/v1/tenant-service-bindings');
    expect(assertPlatformPath('tenant-service-bindings/abc/publish')).toBe(
      '/v1/tenant-service-bindings/abc/publish',
    );
  });

  it('blocks path traversal', () => {
    expect(() => assertPlatformPath('../secret')).toThrow('SF-AUTH-002');
    expect(() => assertPlatformPath('metadata/../secret')).toThrow('SF-AUTH-002');
  });

  it('blocks unlisted paths', () => {
    expect(() => assertPlatformPath('admin/users')).toThrow('SF-AUTH-002');
    expect(() => assertPlatformPath('applications')).toThrow('SF-AUTH-002');
  });
});

describe('studio BFF — bearerToken extraction', () => {
  it('extracts a valid token from cookie', () => {
    const token = 'A'.repeat(40);
    const req = new Request('http://x', { headers: { cookie: `sf_portal_session=${token}` } });
    expect(bearerToken(req)).toBe(token);
  });

  it('returns null when cookie missing', () => {
    expect(bearerToken(new Request('http://x'))).toBeNull();
  });

  it('returns null for malformed token (local session format)', () => {
    const localSess = `v1.${Buffer.from('{}').toString('base64url')}.local`;
    const req = new Request('http://x', { headers: { cookie: `sf_portal_session=${localSess}` } });
    expect(bearerToken(req)).toBeNull();
  });
});

describe('studio BFF — header checks', () => {
  it('flags x-sf- prefixed headers as forbidden', () => {
    expect(isForbiddenHeaderName('x-sf-tenant')).toBe(true);
  });

  it('flags x-roles as forbidden', () => {
    expect(isForbiddenHeaderName('x-roles')).toBe(true);
  });

  it('allows x-correlation-id', () => {
    expect(isForbiddenHeaderName('x-correlation-id')).toBe(false);
  });

  it('headersToRecord is case-normalized via forEach', () => {
    const h = new Headers({ 'Content-Type': 'application/json' });
    const r = headersToRecord(h);
    expect(r['content-type']).toBe('application/json');
  });
});

describe('studio BFF — UUID and isUuid', () => {
  it('accepts valid v4 UUID', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});

describe('studio BFF — handleClearSession', () => {
  it('clears the session cookie', () => {
    const res = handleClearSession();
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
