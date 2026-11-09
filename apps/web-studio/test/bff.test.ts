/**
 * SF-M10-B-4: Studio BFF unit tests.
 * After the B-4 upgrade, handleCreateSession calls the SIMULATED IdP endpoint.
 * Without SF_API_BASE_URL set, all calls fail closed with SF-SYS-004 (no host).
 */
import { describe, expect, it } from 'vitest';
import { handleCreateSession, handlePlatformProxy, handleReadSession, SESSION_COOKIE } from '../lib/handlers';

const tenantB = '22222222-2222-4222-8222-222222222222';

describe('studio BFF INT-011 (SF-M10-B-4 CMP-004 session)', () => {
  it('refuses tenant-identifying request headers (SF-TEN-002)', async () => {
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantB },
        body: JSON.stringify({ subject: 'sample-lab-studio-designer-1' }),
      }),
      'service_studio',
    );
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('SF-TEN-002');
    expect(body).not.toContain(tenantB);
  });

  it('rejects missing subject field with SF-SYS-003', async () => {
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: '' }),
      }),
      'service_studio',
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('SF-SYS-003');
  });

  it('fails closed (SF-SYS-004) without SF_API_BASE_URL', async () => {
    // No SF_API_BASE_URL set → platform() returns 503
    const res = await handleCreateSession(
      new Request('http://studio.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'sample-lab-studio-designer-1' }),
      }),
      'service_studio',
    );
    expect(res.status).toBe(503);
    const body = JSON.parse(await res.text()) as { error_code: string };
    expect(body.error_code).toBe('SF-SYS-004');
  });

  it('returns 401 (SF-AUTH-001) from handleReadSession when no valid CMP-004 token in cookie', async () => {
    const res = handleReadSession(
      new Request('http://studio.local/api/session', {
        headers: { cookie: `${SESSION_COOKIE}=v1.local.session` },
      }),
      ['service_studio'],
    );
    const resolved = await (res as unknown as Promise<Response>);
    expect(resolved.status).toBe(401);
  });

  it('proxied call fails closed (SF-SYS-004 or SF-AUTH-001) with no valid token or no host', async () => {
    const proxied = await handlePlatformProxy(
      new Request('http://studio.local/api/platform/metadata/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ['metadata', 'documents'],
      ['service_studio'],
    );
    // No token → SF-AUTH-001; no host → SF-SYS-004
    expect([401, 503]).toContain(proxied.status);
    const denied = JSON.parse(await proxied.text()) as { error_code: string };
    expect(['SF-AUTH-001', 'SF-SYS-004']).toContain(denied.error_code);
  });

  it('refuses disallowed paths (SF-AUTH-002)', async () => {
    const proxied = await handlePlatformProxy(
      new Request('http://studio.local/api/platform/../secrets', {
        headers: {
          cookie: `${SESSION_COOKIE}=${'a'.repeat(40)}`,
        },
      }),
      ['..', 'secrets'],
      ['service_studio'],
    );
    expect(proxied.status).toBe(403);
    expect(await proxied.text()).toContain('SF-AUTH-002');
  });
});
