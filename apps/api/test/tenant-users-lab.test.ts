import { describe, expect, it, vi } from 'vitest';
import {
  KeycloakTenantUserDirectory,
  SimulatedTenantUserDirectory,
  createTenantUserDirectory,
  resolveKeycloakConfig,
  TenantUserDirectoryError,
} from '../src/platform/tenant-users.js';

const T1 = '0d15ba00-0001-4000-8000-0d15ba0000d1';
const T2 = '0d15ba00-0002-4000-8000-0d15ba0000d2';

describe('SF-71 tenant workforce user directory adapters', () => {
  it('defaults to labelled SIMULATED when Keycloak env is unset', () => {
    const dir = createTenantUserDirectory({ env: {} });
    expect(dir.mode).toBe('SIMULATED');
    expect(dir.simulation).toBe(true);
  });

  it('scopes SIMULATED users by tenant_id (no cross-tenant leak)', async () => {
    const dir = new SimulatedTenantUserDirectory([
      {
        officer_id: '0d15ba00-0f04-4000-8000-0d15ba000f04',
        subject: 'sample-lab-tenant-admin-1',
        display_name: 'SAMPLE LAB Tenant Admin',
        tenant_id: T1,
        roles: ['TENANT_ADMIN_STUDIO'],
      },
    ]);
    const created = await dir.create(T2, {
      username: 'other-tenant-user',
      display_name: 'Other',
      roles: ['STUDIO_DESIGNER'],
    });
    expect(created.tenant_id).toBe(T2);
    const t1 = await dir.list(T1);
    const t2 = await dir.list(T2);
    expect(t1.every((u) => u.tenant_id === T1)).toBe(true);
    expect(t2.every((u) => u.tenant_id === T2)).toBe(true);
    expect(t1.some((u) => u.username === 'other-tenant-user')).toBe(false);
    expect(await dir.get(T1, created.user_id)).toBeNull();
  });

  it('creates, updates, and assigns roles without logging PII fields in return shape keys', async () => {
    const dir = new SimulatedTenantUserDirectory();
    const user = await dir.create(T1, {
      username: 'lab.officer.1',
      display_name: 'Lab Officer',
      email: 'lab@example.invalid',
      roles: ['SAMPLE_LAB_CASE_OFFICER'],
    });
    expect(user.user_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const updated = await dir.update(T1, user.user_id, {
      display_name: 'Lab Officer Updated',
      enabled: false,
    });
    expect(updated.enabled).toBe(false);
    expect(updated.display_name).toBe('Lab Officer Updated');
    const withRoles = await dir.assignRoles(T1, user.user_id, [
      'SAMPLE_LAB_CASE_OFFICER',
      'STUDIO_DESIGNER',
    ]);
    expect(withRoles.roles).toEqual(['SAMPLE_LAB_CASE_OFFICER', 'STUDIO_DESIGNER']);
    const catalogue = await dir.roleCatalogue(T1);
    expect(catalogue).toContain('TENANT_ADMIN_STUDIO');
  });

  it('refuses invalid usernames and role codes', async () => {
    const dir = new SimulatedTenantUserDirectory();
    await expect(
      dir.create(T1, { username: 'Bad User', display_name: 'X' }),
    ).rejects.toBeInstanceOf(TenantUserDirectoryError);
    await expect(
      dir.create(T1, {
        username: 'ok.user',
        display_name: 'X',
        roles: ['not-a-role'],
      }),
    ).rejects.toBeInstanceOf(TenantUserDirectoryError);
  });

  it('resolves Keycloak config only when base URL, client, secret, and realm binding exist', () => {
    expect(resolveKeycloakConfig({})).toBeNull();
    expect(
      resolveKeycloakConfig({
        SF_KEYCLOAK_BASE_URL: 'http://keycloak.local',
        SF_KEYCLOAK_ADMIN_CLIENT_ID: 'admin-cli',
        SF_KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret',
      }),
    ).toBeNull();
    const cfg = resolveKeycloakConfig({
      SF_KEYCLOAK_BASE_URL: 'http://keycloak.local/',
      SF_KEYCLOAK_ADMIN_CLIENT_ID: 'admin-cli',
      SF_KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret',
      SF_KEYCLOAK_REALM: 'sf-lab',
      SF_KEYCLOAK_TENANT_ID: T1,
    });
    expect(cfg?.baseUrl).toBe('http://keycloak.local');
    expect(cfg?.realmByTenant[T1]).toBe('sf-lab');
  });

  it('Keycloak adapter filters users by tenant attribute and never returns other-tenant rows', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/users?max=200')) {
        return new Response(
          JSON.stringify([
            {
              id: 'u-t1',
              username: 'tenant-one',
              firstName: 'One',
              enabled: true,
              attributes: { tenant_id: [T1] },
            },
            {
              id: 'u-t2',
              username: 'tenant-two',
              firstName: 'Two',
              enabled: true,
              attributes: { tenant_id: [T2] },
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/role-mappings/realm') && (!init || init.method === 'GET' || !init.method)) {
        return new Response(JSON.stringify([{ name: 'TENANT_ADMIN_STUDIO' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const dir = new KeycloakTenantUserDirectory({
      baseUrl: 'http://keycloak.local',
      adminRealm: 'master',
      clientId: 'admin-cli',
      clientSecret: 'secret',
      realmByTenant: { [T1]: 'sf-lab' },
      tenantAttribute: 'tenant_id',
      fetchImpl,
    });
    const users = await dir.list(T1);
    expect(users).toHaveLength(1);
    expect(users[0]?.user_id).toBe('u-t1');
    expect(users[0]?.tenant_id).toBe(T1);
    expect(users.some((u) => u.user_id === 'u-t2')).toBe(false);
  });
});
