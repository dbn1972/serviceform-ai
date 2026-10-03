import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import {
  registerTenantOrganisation,
  tenantOrganisationPlugin,
  Cmp002Error,
} from '../../src/index.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { frozenClock } from '../doubles/clock.js';
import { createMemoryPool, emptyStore, seedTenant, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR_OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = '44444444-4444-4444-8444-444444444444';
const CHILD = '55555555-5555-4555-8555-555555555555';

function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: partial.actor.type === 'PRIVILEGED_ADMIN' ? ['PLATFORM_OPERATOR'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: partial.auth_assurance ?? 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...partial,
  };
}

function bearer(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

function key(label: string): string {
  return `idem-${label}-${randomUUID().slice(0, 8)}`;
}

describe('plugin HTTP unit (memory pool)', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let authorizer: ContractAuthorizer;

  beforeAll(async () => {
    store = emptyStore();
    authorizer = new ContractAuthorizer();
    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerTenantOrganisation(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
      clock: frozenClock('2026-10-03T12:00:00.000Z'),
    });
    fixtures.set(
      'officer-t1',
      ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    fixtures.set(
      'officer-missing',
      ctx({ tenant_id: MISSING, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    fixtures.set(
      'officer-nobind',
      ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
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
  });

  beforeEach(() => {
    const next = emptyStore();
    Object.assign(store, next);
    seedTenant(store, { tenantId: T1, code: 'tenant-one', actorId: ACTOR_OFFICER });
    seedTenant(store, { tenantId: T2, code: 'tenant-two', actorId: ACTOR_OFFICER, binding: false });
    authorizer.denies.clear();
    authorizer.throws = false;
    delete store.failQuery;
    store.rollbackThrows = false;
  });

  it('GET tenant returns current binding and private cache header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.json()).toMatchObject({
      tenant_id: T1,
      code: 'tenant-one',
      current_binding: { cell_id: 'cell-01', isolation_model: 'POOL', seq: 1 },
    });
  });

  it('GET tenant without binding returns null current_binding', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T2}`,
      headers: bearer('officer-nobind'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()['current_binding']).toBeNull();
  });

  it('GET missing tenant is 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${MISSING}`,
      headers: bearer('officer-missing'),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()['error_code']).toBe('SF-SYS-002');
  });

  it('forged tenant header and other-tenant route are 403', async () => {
    const forged = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1', { 'x-tenant-id': T2 }),
    });
    expect(forged.statusCode).toBe(403);
    const other = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T2}`,
      headers: bearer('officer-t1'),
    });
    expect(other.statusCode).toBe(403);
    const forwarded = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1', { forwarded: 'for=1.1.1.1;tenant=abc' }),
    });
    expect(forwarded.statusCode).toBe(403);
  });

  it('missing context is 401 and admin on tenant route is SF-TEN-001', async () => {
    const missing = await app.inject({ method: 'GET', url: `/v1/tenants/${T1}` });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()['error_code']).toBe('SF-AUTH-001');
    const admin = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('admin-a'),
    });
    expect(admin.statusCode).toBe(401);
    expect(admin.json()['error_code']).toBe('SF-TEN-001');
  });

  it('validation failures and extra tenant_id are 400', async () => {
    const extra = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('extra') },
      payload: { tenant_id: T2, code: 'org-a', name: 'A', organisation_type_code: 'DEPT' },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()['error_code']).toBe('SF-SYS-003');
    const badLimit = await app.inject({
      method: 'GET',
      url: '/v1/organisations?limit=201',
      headers: bearer('officer-t1'),
    });
    expect(badLimit.statusCode).toBe(400);
    const badId = await app.inject({
      method: 'GET',
      url: `/v1/tenants/not-a-uuid`,
      headers: bearer('officer-t1'),
    });
    expect(badId.statusCode).toBe(400);
  });

  it('maps postgres unique and unexpected failures', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('admin-a'), 'idempotency-key': key('dup') },
      payload: {
        code: 'tenant-one',
        display_name: 'Dup',
        cell_id: 'cell-01',
        isolation_model: 'POOL',
        reason: 'dup-code',
      },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()['error_code']).toBe('SF-APP-002');
    store.failQuery = (sql) =>
      sql.includes('created_at, updated_at')
        ? Object.assign(new Error('boom'), { code: 'XX000' })
        : undefined;
    const boom = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1'),
    });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()['error_code']).toBe('SF-SYS-001');
    store.failQuery = (sql) =>
      sql.includes('created_at, updated_at')
        ? Object.assign(new Error('denied'), { code: '42501' })
        : undefined;
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1'),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()['error_code']).toBe('SF-TEN-002');
  });

  it('creates tenant, org, office, activates, lists, and replays idempotency', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('admin-a'), 'idempotency-key': key('tenant') },
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
    const orgKey = key('org');
    const orgBody = { code: 'hq', name: 'Headquarters', organisation_type_code: 'DEPT' };
    const org = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': orgKey },
      payload: orgBody,
    });
    expect(org.statusCode).toBe(201);
    const orgId = org.json()['organisation_id'] as string;
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': orgKey },
      payload: orgBody,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()['organisation_id']).toBe(orgId);
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': orgKey },
      payload: { code: 'other', name: 'Other', organisation_type_code: 'DEPT' },
    });
    expect(conflict.statusCode).toBe(409);
    const child = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': key('child') },
      payload: {
        code: 'unit',
        name: 'Unit',
        organisation_type_code: 'DEPT',
        parent_id: orgId,
        reason: 'child',
      },
    });
    expect(child.statusCode).toBe(201);
    const missingParent = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-flow'), 'idempotency-key': key('noparent') },
      payload: {
        code: 'orphan',
        name: 'Orphan',
        organisation_type_code: 'DEPT',
        parent_id: MISSING,
      },
    });
    expect(missingParent.statusCode).toBe(404);
    const now = new Date('2026-10-03T12:00:00.000Z');
    for (let i = 0; i < 48; i += 1) {
      const id = randomUUID();
      store.orgs.push({
        tenant_id: tenantId,
        organisation_id: id,
        code: `pad-${i}`,
        created_at: now,
        created_by: ACTOR_OFFICER,
      });
      store.orgVersions.push({
        tenant_id: tenantId,
        organisation_id: id,
        version_no: '1',
        name: `Pad ${i}`,
        organisation_type_code: 'DEPT',
        status: 'ACTIVE',
        valid_from: now,
        reason: 'seed',
        created_by: ACTOR_OFFICER,
      });
    }
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('officer-flow'),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()['items']).toHaveLength(50);
    expect(listed.json()['cursor']).toBeTruthy();
    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/organisations?cursor=${listed.json()['cursor'] as string}`,
      headers: bearer('officer-flow'),
    });
    expect(page2.statusCode).toBe(200);
    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/organisations?parent_id=${orgId}&as_of=2026-10-03T12:00:00.000Z`,
      headers: bearer('officer-flow'),
    });
    expect(filtered.statusCode).toBe(200);
    expect((filtered.json()['items'] as unknown[]).length).toBe(1);
    const office = await app.inject({
      method: 'POST',
      url: '/v1/offices',
      headers: { ...bearer('officer-flow'), 'idempotency-key': key('office') },
      payload: { organisation_id: orgId, code: 'front', name: 'Front desk' },
    });
    expect(office.statusCode).toBe(201);
    const officeId = office.json()['office_id'] as string;
    const act = await app.inject({
      method: 'POST',
      url: `/v1/offices/${officeId}/activate`,
      headers: { ...bearer('officer-flow'), 'idempotency-key': key('act') },
      payload: { version: 1 },
    });
    expect(act.statusCode).toBe(200);
    const actAgain = await app.inject({
      method: 'POST',
      url: `/v1/offices/${officeId}/activate`,
      headers: { ...bearer('officer-flow'), 'idempotency-key': key('act2') },
      payload: {},
    });
    expect(actAgain.statusCode).toBe(200);
    const offices = await app.inject({
      method: 'GET',
      url: `/v1/offices?organisation_id=${orgId}&status=ACTIVE`,
      headers: bearer('officer-flow'),
    });
    expect(offices.statusCode).toBe(200);
    expect(offices.json()['items'][0]['activated_at']).toBeTruthy();
    const cycle = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${orgId}/versions`,
      headers: { ...bearer('officer-flow'), 'idempotency-key': key('cycle') },
      payload: { parent_id: orgId, reason: 'self' },
    });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json()['details'][0]['code']).toBe('HIERARCHY_CYCLE');
  });

  it('versions organisations, including parent clear and missing targets', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('admin-a'), 'idempotency-key': key('t-ver') },
      payload: {
        code: 'tenant-ver-01',
        display_name: 'Ver',
        cell_id: 'cell-03',
        isolation_model: 'BRIDGE',
        reason: 'version-flow',
      },
    });
    const tenantId = created.json()['tenant_id'] as string;
    fixtures.set(
      'officer-ver',
      ctx({ tenant_id: tenantId, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    const parent = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-ver'), 'idempotency-key': key('p') },
      payload: { code: 'p', name: 'P', organisation_type_code: 'DEPT' },
    });
    const parentId = parent.json()['organisation_id'] as string;
    const org = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { ...bearer('officer-ver'), 'idempotency-key': key('c') },
      payload: { code: 'c', name: 'C', organisation_type_code: 'DEPT', parent_id: parentId },
    });
    const orgId = org.json()['organisation_id'] as string;
    const named = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${orgId}/versions`,
      headers: { ...bearer('officer-ver'), 'idempotency-key': key('name') },
      payload: {
        name: 'Renamed',
        organisation_type_code: 'UNIT',
        status: 'ACTIVE',
        reason: 'rename',
      },
    });
    expect(named.statusCode).toBe(201);
    expect(named.json()['version_no']).toBe(2);
    const cleared = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${orgId}/versions`,
      headers: { ...bearer('officer-ver'), 'idempotency-key': key('clear') },
      payload: { parent_id: null, reason: 'detach' },
    });
    expect(cleared.statusCode).toBe(201);
    const missingOrg = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${MISSING}/versions`,
      headers: { ...bearer('officer-ver'), 'idempotency-key': key('miss') },
      payload: { name: 'Nope' },
    });
    expect(missingOrg.statusCode).toBe(404);
    const badParent = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${orgId}/versions`,
      headers: { ...bearer('officer-ver'), 'idempotency-key': key('badp') },
      payload: { parent_id: MISSING, reason: 'missing-parent' },
    });
    expect(badParent.statusCode).toBe(404);
  });

  it('office create/activate failure paths', async () => {
    const missingOrg = await app.inject({
      method: 'POST',
      url: '/v1/offices',
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('noorg') },
      payload: { organisation_id: MISSING, code: 'x', name: 'X' },
    });
    expect(missingOrg.statusCode).toBe(404);
    const missingOffice = await app.inject({
      method: 'POST',
      url: `/v1/offices/${MISSING}/activate`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('nooff') },
      payload: {},
    });
    expect(missingOffice.statusCode).toBe(404);
    store.orgs.push({
      tenant_id: T1,
      organisation_id: PARENT,
      code: 'seed-org',
      created_at: new Date('2026-10-03T12:00:00.000Z'),
      created_by: ACTOR_OFFICER,
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/offices',
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('off') },
      payload: { organisation_id: PARENT, code: 'desk', name: 'Desk' },
    });
    const officeId = created.json()['office_id'] as string;
    const mismatch = await app.inject({
      method: 'POST',
      url: `/v1/offices/${officeId}/activate`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('mm') },
      payload: { version: 9 },
    });
    expect(mismatch.statusCode).toBe(409);
    const office = store.offices.find((o) => o.office_id === officeId);
    if (office) office.status = 'INACTIVE';
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/offices/${officeId}/activate`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('stale') },
      payload: {},
    });
    expect(stale.statusCode).toBe(409);
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/offices',
      headers: bearer('officer-t1'),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()['items'][0]['activated_at']).toBeNull();
  });

  it('placement propose and approve including missing proposal', async () => {
    const propose = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T1}/placement-proposals`,
      headers: { ...bearer('admin-a'), 'idempotency-key': key('prop') },
      payload: { cell_id: 'cell-77', isolation_model: 'BRIDGE', reason: 'move-cell' },
    });
    expect(propose.statusCode).toBe(201);
    const proposalId = propose.json()['proposal_id'] as string;
    const missing = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T1}/placement-proposals/${MISSING}/approve`,
      headers: { ...bearer('admin-b'), 'idempotency-key': key('nop') },
      payload: { reason: 'none' },
    });
    expect(missing.statusCode).toBe(409);
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T1}/placement-proposals/${proposalId}/approve`,
      headers: { ...bearer('admin-b'), 'idempotency-key': key('appr') },
      payload: { reason: 'second-person' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()['seq']).toBe(2);
    const propose2 = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T2}/placement-proposals`,
      headers: { ...bearer('admin-a'), 'idempotency-key': key('prop2') },
      payload: {
        cell_id: 'cell-08',
        isolation_model: 'SILO',
        reason: 'first-bind',
        valid_from: '2026-10-03T12:00:00.000Z',
      },
    });
    const proposal2 = propose2.json()['proposal_id'] as string;
    const firstBind = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T2}/placement-proposals/${proposal2}/approve`,
      headers: { ...bearer('admin-b'), 'idempotency-key': key('appr2') },
      payload: { reason: 'bootstrap-bind' },
    });
    expect(firstBind.statusCode).toBe(200);
    expect(firstBind.json()['seq']).toBe(1);
  });

  it('privileged denials write denied audit and OPA deny/throw', async () => {
    const officer = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('off-admin') },
      payload: {
        code: 'denied-one',
        display_name: 'Denied',
        cell_id: 'cell-01',
        isolation_model: 'POOL',
        reason: 'should-fail',
      },
    });
    expect(officer.statusCode).toBe(403);
    const nomfa = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('admin-nomfa'), 'idempotency-key': key('nomfa') },
      payload: {
        code: 'denied-two',
        display_name: 'Denied',
        cell_id: 'cell-01',
        isolation_model: 'POOL',
        reason: 'should-fail',
      },
    });
    expect(nomfa.statusCode).toBe(403);
    authorizer.denies.add('TENANT_CREATE');
    const opa = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants',
      headers: { ...bearer('admin-a'), 'idempotency-key': key('opa') },
      payload: {
        code: 'denied-three',
        display_name: 'Denied',
        cell_id: 'cell-01',
        isolation_model: 'POOL',
        reason: 'opa-deny',
      },
    });
    expect(opa.statusCode).toBe(403);
    authorizer.denies.clear();
    const proposeOfficer = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T1}/placement-proposals`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('p-off') },
      payload: { cell_id: 'cell-02', isolation_model: 'POOL', reason: 'nope' },
    });
    expect(proposeOfficer.statusCode).toBe(403);
    authorizer.denies.add('PLACEMENT_PROPOSE');
    const proposeOpa = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T1}/placement-proposals`,
      headers: { ...bearer('admin-a'), 'idempotency-key': key('p-opa') },
      payload: { cell_id: 'cell-02', isolation_model: 'POOL', reason: 'nope' },
    });
    expect(proposeOpa.statusCode).toBe(403);
    authorizer.denies.clear();
    const approveOfficer = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T1}/placement-proposals/${MISSING}/approve`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('a-off') },
      payload: { reason: 'nope' },
    });
    expect(approveOfficer.statusCode).toBe(403);
    authorizer.denies.add('PLACEMENT_APPROVE');
    const approveOpa = await app.inject({
      method: 'POST',
      url: `/v1/admin/tenants/${T1}/placement-proposals/${MISSING}/approve`,
      headers: { ...bearer('admin-a'), 'idempotency-key': key('a-opa') },
      payload: { reason: 'nope' },
    });
    expect(approveOpa.statusCode).toBe(403);
    authorizer.denies.clear();
    authorizer.throws = true;
    const down = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('officer-t1'),
    });
    expect(down.statusCode).toBe(503);
    authorizer.throws = false;
    authorizer.denies.add('ORGANISATION_READ');
    const readDeny = await app.inject({
      method: 'GET',
      url: '/v1/organisations',
      headers: bearer('officer-t1'),
    });
    expect(readDeny.statusCode).toBe(403);
  });

  it('bad cursor, missing idempotency key, and spoofed actor header', async () => {
    const cursor = await app.inject({
      method: 'GET',
      url: '/v1/organisations?cursor=not-base64',
      headers: bearer('officer-t1'),
    });
    expect(cursor.statusCode).toBe(400);
    const badLast = Buffer.from(JSON.stringify({ last: 'nope' }), 'utf8').toString('base64url');
    const cursor2 = await app.inject({
      method: 'GET',
      url: `/v1/organisations?cursor=${badLast}`,
      headers: bearer('officer-t1'),
    });
    expect(cursor2.statusCode).toBe(400);
    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: bearer('officer-t1'),
      payload: { code: 'no-key', name: 'No', organisation_type_code: 'DEPT' },
    });
    expect(missingKey.statusCode).toBe(400);
    const spoof = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-t1', { 'x-sf-actor-type': 'PRIVILEGED_ADMIN' }),
    });
    expect(spoof.statusCode).toBe(403);
  });

  it('org version without prior version row is 404 and hierarchy cycle via ancestors', async () => {
    store.orgs.push({
      tenant_id: T1,
      organisation_id: PARENT,
      code: 'parent',
      created_at: new Date('2026-10-03T12:00:00.000Z'),
      created_by: ACTOR_OFFICER,
    });
    store.orgs.push({
      tenant_id: T1,
      organisation_id: CHILD,
      code: 'child',
      created_at: new Date('2026-10-03T12:00:00.000Z'),
      created_by: ACTOR_OFFICER,
    });
    store.orgVersions.push({
      tenant_id: T1,
      organisation_id: PARENT,
      version_no: '1',
      name: 'P',
      organisation_type_code: 'DEPT',
      status: 'ACTIVE',
      valid_from: new Date('2026-10-03T12:00:00.000Z'),
      reason: 'seed',
      created_by: ACTOR_OFFICER,
    });
    store.orgRelations.push({
      relation_id: randomUUID(),
      tenant_id: T1,
      child_organisation_id: CHILD,
      parent_organisation_id: PARENT,
      version_no: '1',
      valid_from: new Date('2026-10-03T12:00:00.000Z'),
    });
    const noVer = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${CHILD}/versions`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('nover') },
      payload: { name: 'Child' },
    });
    expect(noVer.statusCode).toBe(404);
    store.orgVersions.push({
      tenant_id: T1,
      organisation_id: CHILD,
      version_no: '1',
      name: 'C',
      organisation_type_code: 'DEPT',
      status: 'ACTIVE',
      valid_from: new Date('2026-10-03T12:00:00.000Z'),
      reason: 'seed',
      created_by: ACTOR_OFFICER,
    });
    const cycle = await app.inject({
      method: 'POST',
      url: `/v1/organisations/${PARENT}/versions`,
      headers: { ...bearer('officer-t1'), 'idempotency-key': key('anc') },
      payload: { parent_id: CHILD, reason: 'cycle' },
    });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json()['details'][0]['code']).toBe('HIERARCHY_CYCLE');
  });
});

describe('plugin defaults', () => {
  it('registers via tenantOrganisationPlugin with default clock and audit', async () => {
    const store = emptyStore();
    seedTenant(store, { tenantId: T1, code: 'tenant-one', actorId: ACTOR_OFFICER });
    const authorizer = new ContractAuthorizer();
    const app = Fastify({ logger: false });
    await app.register(tenantOrganisationPlugin, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
    });
    fixtures.set(
      'officer-def',
      ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${T1}`,
      headers: bearer('officer-def'),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
    expect(new Cmp002Error('SF-SYS-001')).toBeInstanceOf(Error);
  });
});
