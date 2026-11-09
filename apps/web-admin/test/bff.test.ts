/**
 * SF-M10-B-4: Admin BFF unit tests.
 * After the B-4 upgrade, handleCreateSession calls the SIMULATED IdP endpoint.
 * Without SF_API_BASE_URL set, all calls fail closed.
 */
import { describe, expect, it } from 'vitest';
import { handleCreateSession, SESSION_COOKIE } from '../lib/handlers';

describe('admin BFF session (SF-M10-B-4 CMP-004 session)', () => {
  it('fails closed (SF-SYS-004) without SF_API_BASE_URL', async () => {
    const res = await handleCreateSession(
      new Request('http://admin.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'sample-lab-tenant-admin-1' }),
      }),
      'tenant_admin',
    );
    // No SF_API_BASE_URL → platform() returns 503
    expect(res.status).toBe(503);
    const body = JSON.parse(await res.text()) as { error_code: string };
    expect(body.error_code).toBe('SF-SYS-004');
  });

  it('rejects missing or empty subject with SF-SYS-003', async () => {
    const res = await handleCreateSession(
      new Request('http://admin.local/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: '' }),
      }),
      'tenant_admin',
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('SF-SYS-003');
  });

  it('exposes SESSION_COOKIE name', () => {
    expect(typeof SESSION_COOKIE).toBe('string');
    expect(SESSION_COOKIE.length).toBeGreaterThan(0);
  });
});
