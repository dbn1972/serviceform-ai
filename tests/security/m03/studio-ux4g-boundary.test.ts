import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createSessionResponse,
  proxyPlatformResponse,
  readSessionResponse,
} from '../../../services/cmp-050-studio-portal/src/bff-handlers.js';
import { loadPortalConfig } from '../../../services/cmp-050-studio-portal/src/config.js';
import { SESSION_COOKIE } from '../../../services/cmp-050-studio-portal/src/session.js';
import {
  applyTenantOverlay,
  assertNoCrossTenantLeakage,
} from '../../../packages/ui-ux4g/src/tenant-overlay.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = loadPortalConfig({ SF_ENVIRONMENT: 'LOCAL' });

describe('SF-M03-SEC CMP-050 Studio / CMP-054 UX4G boundary (not CERTIFIED)', () => {
  it('Studio login and proxy refuse client tenant headers with zero leakage', async () => {
    const login = createSessionResponse({
      headers: { 'x-tenant-id': tenantB },
      body: { tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] },
      surface: 'service_studio',
      config,
      secureCookie: false,
    });
    expect(login.status).toBe(403);
    expect((login.body as { error_code: string }).error_code).toBe('SF-TEN-002');
    expect(JSON.stringify(login.body)).not.toContain(tenantB);

    const created = createSessionResponse({
      headers: { 'content-type': 'application/json' },
      body: { tenant_id: tenantA, actor_id: actor, roles: ['STUDIO_DESIGNER'] },
      surface: 'service_studio',
      config,
      secureCookie: false,
    });
    expect(created.status).toBe(201);
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
      fetchImpl: (async () => new Response(JSON.stringify({ leak: tenantB }))) as typeof fetch,
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain(tenantB);
    expect(created.setCookie).toContain(SESSION_COOKIE);
  });

  it('CMP-050 has no Fastify register export; Studio is not mounted on apps/api', () => {
    const idx = readFileSync(join(ROOT, 'services/cmp-050-studio-portal/src/index.ts'), 'utf8');
    expect(idx).not.toMatch(/FastifyInstance|registerStudio|fastify/);
    const host = readFileSync(join(ROOT, 'apps/api/src/composition/m03.ts'), 'utf8');
    expect(host).not.toMatch(/cmp-050/);
  });

  it('CMP-054 overlay CSS is tenant-scoped and CROSS_TENANT_LEAKAGE=0', () => {
    const a = applyTenantOverlay({
      tenantId: tenantA,
      tokens: { '--ux4g-color-primary-600': '#4a2bc2' },
    });
    const b = applyTenantOverlay({
      tenantId: tenantB,
      tokens: { '--ux4g-color-primary-600': '#3d239f' },
    });
    expect(a.cssText).toContain(`data-tenant-id="${tenantA}"`);
    expect(a.cssText).not.toContain(tenantB);
    expect(b.cssText).not.toContain(tenantA);
    expect(() => assertNoCrossTenantLeakage(a, b)).not.toThrow();
    const pkg = readFileSync(join(ROOT, 'packages/ui-ux4g/package.json'), 'utf8');
    expect(pkg).toContain('@serviceform/ui-ux4g');
    expect(pkg).not.toMatch(/fastify/);
  });
});
