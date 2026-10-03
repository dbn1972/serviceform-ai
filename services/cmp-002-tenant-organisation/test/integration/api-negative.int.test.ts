import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ACTOR_A,
  ACTOR_B,
  ACTOR_OFFICER,
  bearer,
  buildApp,
  closeHarness,
  ctx,
  seedTenants,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';
import { fixtures } from '../doubles/context-resolver.js';
import type { ContractAuthorizer } from '../doubles/authorizer.js';

let h: Harness;
let app!: FastifyInstance;
let authorizer: ContractAuthorizer;

beforeAll(async () => {
  h = await setupHarness();
  await seedTenants(h);
  const built = await buildApp(h);
  app = built.app;
  authorizer = built.authorizer;
  fixtures.set('officer-t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
  fixtures.set(
    'admin-a',
    ctx({
      tenant_id: null,
      actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A },
      auth_assurance: 'MFA',
    }),
  );
  fixtures.set(
    'admin-b',
    ctx({
      tenant_id: null,
      actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_B },
      auth_assurance: 'MFA',
    }),
  );
  fixtures.set(
    'admin-nomfa',
    ctx({
      tenant_id: null,
      actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A },
      auth_assurance: 'PASSWORD',
    }),
  );
});
afterAll(async () => {
  await app.close();
  await closeHarness(h);
});

describe('API tenant isolation and privileged path', () => {
  it('001-17/23 forged tenant header is 403 and GET other tenant is 403', async () => {
    const forged = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1', { 'x-tenant-id': T2 }),
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json()['error_code']).toBe('SF-TEN-002');
    const other = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T2}`,
      headers: bearer('officer-t1'),
    });
    expect(other.statusCode).toBe(403);
    expect(JSON.stringify(other.json())).not.toContain(
      T2.slice(0, 8) === T2.slice(0, 8) ? 'tenant-two' : 'no',
    );
    expect(JSON.stringify(other.json())).not.toContain('tenant-two');
  });

  it('001-19 tenant_id in body is 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-t1'), 'idempotency-key': 'idem-key-01' },
      payload: { tenant_id: T2, code: 'org-a', name: 'A', organisation_type_code: 'DEPT' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()['error_code']).toBe('SF-SYS-003');
  });

  it('001-24 missing context is 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/tenants/${T1}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()['error_code']).toBe('SF-AUTH-001');
  });

  it('001-28 tenant officer is denied on admin routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('officer-t1'), 'idempotency-key': 'idem-key-02' },
      payload: {
        code: 'denied-one',
        display_name: 'Denied',
        cell_id: 'cell-01',
        isolation_model: 'POOL',
        reason: 'should-fail',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()['error_code']).toBe('SF-AUTH-002');
  });

  it('PRIVILEGED_ADMIN without MFA is denied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('admin-nomfa'), 'idempotency-key': 'idem-key-03' },
      payload: {
        code: 'denied-two',
        display_name: 'Denied',
        cell_id: 'cell-01',
        isolation_model: 'POOL',
        reason: 'should-fail',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates a tenant, organisation, office and activates it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('admin-a'), 'idempotency-key': 'idem-create-tenant' },
      payload: {
        code: 'tenant-flow-01',
        display_name: 'Flow',
        cell_id: 'cell-09',
        isolation_model: 'POOL',
        reason: 'create-for-flow',
      },
    });
    expect(created.statusCode).toBe(201);
    const tenantId = created.json()['tenant_id'] as string;
    fixtures.set(
      'officer-flow',
      ctx({ tenant_id: tenantId, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    const org = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': 'idem-create-org' },
      payload: { code: 'hq', name: 'Headquarters', organisation_type_code: 'DEPT' },
    });
    expect(org.statusCode).toBe(201);
    const orgId = org.json()['organisation_id'] as string;
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': 'idem-create-org' },
      payload: { code: 'hq', name: 'Headquarters', organisation_type_code: 'DEPT' },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()['organisation_id']).toBe(orgId);
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': 'idem-create-org' },
      payload: { code: 'other', name: 'Other', organisation_type_code: 'DEPT' },
    });
    expect(conflict.statusCode).toBe(409);
    const office = await app.inject({
      method: 'POST',
      url: '/v1/offices',
      headers: { ...bearer('officer-flow'), 'idempotency-key': 'idem-office' },
      payload: { organisation_id: orgId, code: 'front', name: 'Front desk' },
    });
    expect(office.statusCode).toBe(201);
    const officeId = office.json()['office_id'] as string;
    const act = await app.inject({
      method: 'POST',
      url: `/v1/offices/${officeId}/activate`,
      headers: { ...bearer('officer-flow'), 'idempotency-key': 'idem-act' },
      payload: {},
    });
    expect(act.statusCode).toBe(200);
    const act2 = await app.inject({
      method: 'POST',
      url: `/v1/offices/${officeId}/activate`,
      headers: { ...bearer('officer-flow'), 'idempotency-key': 'idem-act-2' },
      payload: {},
    });
    expect(act2.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('officer-flow'),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()['items']).toHaveLength(1);
    const cycle = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${orgId}/versions`,
      headers: { ...bearer('officer-flow'), 'idempotency-key': 'idem-cycle' },
      payload: { parent_id: orgId, reason: 'self' },
    });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json()['details']?.[0]?.['code']).toBe('HIERARCHY_CYCLE');
  });

  it('maker-checker placement requires a different admin', async () => {
    const tenantId = T1;
    const propose = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${tenantId}/placement-proposals`,
      headers: { ...bearer('admin-a'), 'idempotency-key': 'idem-prop-1' },
      payload: { cell_id: 'cell-77', isolation_model: 'BRIDGE', reason: 'move-cell' },
    });
    expect(propose.statusCode).toBe(201);
    const proposalId = propose.json()['proposal_id'] as string;
    const self = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${tenantId}/placement-proposals/${proposalId}/approve`,
      headers: { ...bearer('admin-a'), 'idempotency-key': 'idem-self-appr' },
      payload: { reason: 'same-actor' },
    });
    expect(self.statusCode).toBeGreaterThanOrEqual(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${tenantId}/placement-proposals/${proposalId}/approve`,
      headers: { ...bearer('admin-b'), 'idempotency-key': 'idem-appr-b' },
      payload: { reason: 'second-person' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('001-21 invalid identifiers are 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/organisations?limit=201',
      headers: bearer('officer-t1'),
    });
    expect(res.statusCode).toBe(400);
    const inj = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}' OR 1=1--`,
      headers: bearer('officer-t1'),
    });
    expect(inj.statusCode).toBe(400);
  });

  it('GET tenant and offices for the context tenant succeed without T2 leakage', async () => {
    const tenant = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1'),
    });
    expect(tenant.statusCode).toBe(200);
    expect(tenant.json()['code']).toBe('tenant-one');
    expect(JSON.stringify(tenant.json())).not.toContain(T2);
    const offices = await app.inject({
      method: 'GET',
      url: '/v1/offices',
      headers: bearer('officer-t1'),
    });
    expect(offices.statusCode).toBe(200);
    expect(JSON.stringify(offices.json())).not.toContain('CANARY');
  });

  it('001-25 authz deny is 403 and PDP throw is 503', async () => {
    authorizer.denies.add('ORGANISATION_READ');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('officer-t1'),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()['error_code']).toBe('SF-AUTH-002');
    authorizer.denies.clear();
    authorizer.throws = true;
    const down = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('officer-t1'),
    });
    expect(down.statusCode).toBe(503);
    expect(down.json()['error_code']).toBe('SF-SYS-004');
    authorizer.throws = false;
  });

  it('001-24/30 privileged admin without tenant is 401 on tenant routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('admin-a'),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()['error_code']).toBe('SF-TEN-001');
  });

  it('001-32 missing idempotency key is 400', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: bearer('officer-t1'),
      payload: { code: 'no-key', name: 'No', organisation_type_code: 'DEPT' },
    });
    expect(missing.statusCode).toBe(400);
  });

  it('001-22 bad cursor is 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/organisations?cursor=not-base64',
      headers: bearer('officer-t1'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('001-18 spoofed actor header is 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1', { 'x-sf-actor-type': 'PRIVILEGED_ADMIN' }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()['error_code']).toBe('SF-TEN-002');
  });
});
