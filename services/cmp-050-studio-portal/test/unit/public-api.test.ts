import { describe, expect, it } from 'vitest';
import {
  Cmp050Error,
  assertPlatformPath,
  assertResourceTenant,
  cookieHeader,
  createHttpTransport,
  createInt002Client,
  loadPortalConfig,
  requireTenantMatch,
  sessionFromLogin,
} from '../../src/index.js';

describe('CMP-050 public surface', () => {
  it('covers leftover client and config paths', async () => {
    const session = sessionFromLogin({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      roles: ['STUDIO_DESIGNER'],
      surface: 'service_studio',
    });
    expect(() => assertResourceTenant(session, session.tenant_id)).not.toThrow();
    expect(() => assertResourceTenant(session, '22222222-2222-4222-8222-222222222222')).toThrow(
      Cmp050Error,
    );
    requireTenantMatch(session, session.tenant_id);
    expect(cookieHeader('tok', true)).toContain('Secure');
    expect(assertPlatformPath('publication-requests')).toBe('/v1/publication-requests');
    const cfg = loadPortalConfig({
      SF_ENVIRONMENT: 'LOCAL',
      SF_PORTAL_SESSION_SECRET: 'sixteen-chars-min',
    });
    expect(cfg.sessionSecret).toBe('sixteen-chars-min');

    const calls: string[] = [];
    const transport = createHttpTransport('http://127.0.0.1:9', async (url, init) => {
      calls.push(`${init?.method ?? ''} ${String(url)}`);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const client = createInt002Client(transport);
    await client.getMetadataDocument('d0000000-0000-4000-8000-000000000001');
    await client.patchMetadataDocument('d0000000-0000-4000-8000-000000000001', {
      code: 'x',
      title: 'y',
    });
    await client.getTenantServiceBinding('e0000000-0000-4000-8000-000000000001');
    await client.getPublicationRequest('f0000000-0000-4000-8000-000000000001');
    await client.rejectPublicationRequest('f0000000-0000-4000-8000-000000000001');
    expect(calls.length).toBe(5);
    await expect(
      createHttpTransport('', fetch).send({ method: 'GET', path: 'metadata/documents' }),
    ).rejects.toBeInstanceOf(Cmp050Error);
  });
});
