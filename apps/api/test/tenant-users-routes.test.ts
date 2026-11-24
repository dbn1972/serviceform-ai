import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  SimulatedTenantUserDirectory,
  registerTenantUserAdminRoutes,
  type TenantUserAuthzPort,
  type TenantUserRequestContext,
} from '../src/platform/tenant-users.js';

const T1 = '0d15ba00-0001-4000-8000-0d15ba0000d1';
const T2 = '0d15ba00-0002-4000-8000-0d15ba0000d2';
const ACTOR = '0d15ba00-0f04-4000-8000-0d15ba000f04';

function officerCtx(tenantId: string, roles = ['TENANT_ADMIN_STUDIO']): TenantUserRequestContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-lab',
    actor: { type: 'OFFICER', id: ACTOR },
    roles,
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '00000000-0000-4000-8000-000000000099',
    trace_id: '0'.repeat(32),
  };
}

async function buildApp(opts: {
  directory: SimulatedTenantUserDirectory;
  authorizer: TenantUserAuthzPort;
  resolveContext: (req: unknown) => Promise<TenantUserRequestContext | null>;
}) {
  const app = Fastify({ logger: false });
  await registerTenantUserAdminRoutes(app, opts);
  await app.ready();
  return app;
}

describe('SF-71 tenant-users Fastify routes (IDOR / OPA-deny)', () => {
  it('lists only the session tenant users (cross-tenant IDOR negative)', async () => {
    const directory = new SimulatedTenantUserDirectory();
    const foreign = await directory.create(T2, {
      username: 'foreign.user',
      display_name: 'Foreign',
      roles: ['STUDIO_DESIGNER'],
    });
    await directory.create(T1, {
      username: 'home.user',
      display_name: 'Home',
      roles: ['TENANT_ADMIN_STUDIO'],
    });
    const authorizer: TenantUserAuthzPort = {
      decide: async () => ({ allow: true }),
    };
    const app = await buildApp({
      directory,
      authorizer,
      resolveContext: async () => officerCtx(T1),
    });
    const list = await app.inject({ method: 'GET', url: '/v1/admin/tenant-users' });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      users: { user_id: string; tenant_id: string }[];
      certified: boolean;
      g6_issued: boolean;
      adr_0007_accepted: boolean;
      production_idp_claimed: boolean;
    };
    expect(body.users.every((u) => u.tenant_id === T1)).toBe(true);
    expect(body.users.some((u) => u.user_id === foreign.user_id)).toBe(false);
    expect(body.certified).toBe(false);
    expect(body.g6_issued).toBe(false);
    expect(body.adr_0007_accepted).toBe(false);
    expect(body.production_idp_claimed).toBe(false);

    const idor = await app.inject({
      method: 'GET',
      url: `/v1/admin/tenant-users/${foreign.user_id}`,
    });
    expect(idor.statusCode).toBe(404);
    expect(idor.json()).toMatchObject({ error_code: 'SF-SYS-002' });

    const patchIdor = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/tenant-users/${foreign.user_id}`,
      payload: { display_name: 'Hijack' },
    });
    expect(patchIdor.statusCode).toBe(404);

    const rolesIdor = await app.inject({
      method: 'PUT',
      url: `/v1/admin/tenant-users/${foreign.user_id}/roles`,
      payload: { roles: ['TENANT_ADMIN_STUDIO'] },
    });
    expect(rolesIdor.statusCode).toBe(404);
    await app.close();
  });

  it('OPA deny returns 403 SF-AUTH-002', async () => {
    const directory = new SimulatedTenantUserDirectory();
    const authorizer: TenantUserAuthzPort = {
      decide: async () => ({ allow: false }),
    };
    const app = await buildApp({
      directory,
      authorizer,
      resolveContext: async () => officerCtx(T1, ['SAMPLE_LAB_CASE_OFFICER']),
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/tenant-users' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    await app.close();
  });

  it('authorizer outage returns 503 SF-SYS-004 (fail-closed)', async () => {
    const directory = new SimulatedTenantUserDirectory();
    const authorizer: TenantUserAuthzPort = {
      decide: async () => {
        throw new Error('PDP down');
      },
    };
    const app = await buildApp({
      directory,
      authorizer,
      resolveContext: async () => officerCtx(T1),
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/tenant-users' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error_code: 'SF-SYS-004' });
    await app.close();
  });

  it('refuses client-supplied tenant_id body with SF-TEN-002', async () => {
    const directory = new SimulatedTenantUserDirectory();
    const authorizer: TenantUserAuthzPort = {
      decide: async () => ({ allow: true }),
    };
    const app = await buildApp({
      directory,
      authorizer,
      resolveContext: async () => officerCtx(T1),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenant-users',
      payload: {
        username: 'evil.override',
        display_name: 'Evil',
        tenant_id: T2,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect((await directory.list(T2)).some((u) => u.username === 'evil.override')).toBe(false);
    await app.close();
  });

  it('unauthenticated / non-officer sessions are 401', async () => {
    const directory = new SimulatedTenantUserDirectory();
    const authorizer: TenantUserAuthzPort = {
      decide: async () => ({ allow: true }),
    };
    const app = await buildApp({
      directory,
      authorizer,
      resolveContext: async () => null,
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/tenant-users' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    await app.close();
  });

  it('create success logs omit email/username/display_name', async () => {
    const directory = new SimulatedTenantUserDirectory();
    const authorizer: TenantUserAuthzPort = {
      decide: async () => ({ allow: true }),
    };
    const app = await buildApp({
      directory,
      authorizer,
      resolveContext: async () => officerCtx(T1),
    });
    const spy = vi.spyOn(app.log, 'info');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenant-users',
      payload: {
        username: 'pii.user',
        display_name: 'Secret Name',
        email: 'secret@example.invalid',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(spy).toHaveBeenCalled();
    const createLogs = spy.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((payload) => payload['event'] === 'tenant_user_create');
    expect(createLogs.length).toBeGreaterThan(0);
    for (const payload of createLogs) {
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('display_name');
      expect(payload).not.toHaveProperty('username');
      expect(payload).not.toHaveProperty('req');
      expect(JSON.stringify(payload)).not.toContain('secret@example.invalid');
      expect(JSON.stringify(payload)).not.toContain('Secret Name');
      expect(payload).toHaveProperty('user_id');
      expect(payload['tenant_bound']).toBe(true);
    }
    await app.close();
  });
});
