import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import type { AuditEvent, RequestContext } from '@serviceform/contracts';
import { outboxAuditRecorder } from '../../src/audit.js';
import { claimIdempotency, completeIdempotency } from '../../src/db/idempotency.js';
import { envelopeOf, insertOutbox, TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/db/outbox.js';
import { withContextTx } from '../../src/db/tx.js';
import { canonicalJson } from '../../src/domain/fingerprint.js';
import { Cmp002Error } from '../../src/errors.js';
import {
  iso,
  readIdempotencyKey,
  requirePrivileged,
  runCommand,
  writeDenied,
  type RouteDeps,
} from '../../src/routes/helpers.js';
import {
  assertNoCycle,
  currentBinding,
  lockTenant,
  newId,
} from '../../src/repositories/org.repo.js';
import { assertNoTenantIdentifyingHeaders } from '../../src/context.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { frozenClock } from '../doubles/clock.js';
import { createMemoryPool, emptyStore, seedTenant } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PARENT = '44444444-4444-4444-8444-444444444444';
const CHILD = '55555555-5555-4555-8555-555555555555';
const TRACE = '0af7651916cd43dd8448eb211c80319c';

const ctx: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: ACTOR },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: TRACE,
};

const adminCtx: RequestContext = {
  ...ctx,
  tenant_id: null,
  actor: { type: 'PRIVILEGED_ADMIN', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  roles: ['PLATFORM_OPERATOR'],
};

function fakeRequest(headers: Record<string, string | string[]>, url = '/v1/admin/tenants') {
  return { headers, url, method: 'POST', body: { a: 1 }, id: randomUUID() } as never;
}

describe('tx, idempotency, outbox, repo', () => {
  it('withContextTx applies session settings, privileged marker, and rolls back', async () => {
    const store = emptyStore();
    const pool = createMemoryPool(store);
    const out = await withContextTx(pool, ctx, async () => 'ok', {
      privilegedMarker: 'cmp-002-admin',
    });
    expect(out).toBe('ok');
    expect(store.setConfigs.some((s) => s.key === 'app.tenant_id' && s.value === T1)).toBe(true);
    expect(store.setConfigs.some((s) => s.key === 'app.privileged_marker')).toBe(true);
    expect(store.released).toBe(1);

    const adminStore = emptyStore();
    await withContextTx(createMemoryPool(adminStore), adminCtx, async () => undefined);
    expect(adminStore.setConfigs.some((s) => s.key === 'app.tenant_id')).toBe(false);

    store.failQuery = (sql) => (sql === 'COMMIT' ? new Error('commit-fail') : undefined);
    await expect(withContextTx(pool, ctx, async () => 'x')).rejects.toThrow('commit-fail');

    store.failQuery = (sql) => (sql === 'COMMIT' ? new Error('commit-fail') : undefined);
    store.rollbackThrows = true;
    await expect(withContextTx(pool, ctx, async () => 'x')).rejects.toThrow('commit-fail');
  });

  it('claim and complete tenant and platform idempotency branches', async () => {
    const store = emptyStore();
    const pool = createMemoryPool(store);
    const client = await pool.connect();
    const now = new Date('2026-10-03T12:00:00.000Z');
    const base = {
      principalId: ACTOR,
      endpoint: 'POST /v1/organisations',
      key: 'idem-key-01',
      fingerprint: 'sha256:aaa',
      now,
    };
    expect(await claimIdempotency(client, { ...base, tenantId: T1 })).toBe('claimed');
    await completeIdempotency(client, {
      tenantId: T1,
      principalId: ACTOR,
      endpoint: base.endpoint,
      key: base.key,
      status: 201,
      body: { ok: true },
    });
    const replay = await claimIdempotency(client, { ...base, tenantId: T1 });
    expect(replay).toEqual({ status: 201, body: { ok: true } });
    await expect(
      claimIdempotency(client, { ...base, tenantId: T1, fingerprint: 'sha256:bbb' }),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });

    store.idemTenant.push({
      tenant_id: T1,
      principal_id: ACTOR,
      endpoint: 'POST /v1/stuck',
      idempotency_key: 'idem-stuck1',
      request_fingerprint: 'sha256:ccc',
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    await expect(
      claimIdempotency(client, {
        tenantId: T1,
        principalId: ACTOR,
        endpoint: 'POST /v1/stuck',
        key: 'idem-stuck1',
        fingerprint: 'sha256:ccc',
        now,
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });

    expect(
      await claimIdempotency(client, {
        ...base,
        tenantId: null,
        endpoint: 'POST /v1/admin/tenants',
        key: 'idem-plat-01',
      }),
    ).toBe('claimed');
    await completeIdempotency(client, {
      tenantId: null,
      principalId: ACTOR,
      endpoint: 'POST /v1/admin/tenants',
      key: 'idem-plat-01',
      status: 201,
      body: { platform: true },
    });
    const platReplay = await claimIdempotency(client, {
      ...base,
      tenantId: null,
      endpoint: 'POST /v1/admin/tenants',
      key: 'idem-plat-01',
    });
    expect(platReplay).toEqual({ status: 201, body: { platform: true } });
    await expect(
      claimIdempotency(client, {
        ...base,
        tenantId: null,
        endpoint: 'POST /v1/admin/tenants',
        key: 'idem-plat-01',
        fingerprint: 'sha256:zzz',
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });

    store.idemPlatform.push({
      tenant_id: null,
      principal_id: ACTOR,
      endpoint: 'POST /v1/admin/stuck',
      idempotency_key: 'idem-stuck2',
      request_fingerprint: 'sha256:ddd',
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    await expect(
      claimIdempotency(client, {
        tenantId: null,
        principalId: ACTOR,
        endpoint: 'POST /v1/admin/stuck',
        key: 'idem-stuck2',
        fingerprint: 'sha256:ddd',
        now,
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
  });

  it('claim throws when conflict row is missing', async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes('INSERT')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    await expect(
      claimIdempotency(client, {
        tenantId: T1,
        principalId: ACTOR,
        endpoint: 'POST /x',
        key: 'idem-key-01',
        fingerprint: 'sha256:a',
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await expect(
      claimIdempotency(client, {
        tenantId: null,
        principalId: ACTOR,
        endpoint: 'POST /x',
        key: 'idem-key-01',
        fingerprint: 'sha256:a',
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });

  it('insertOutbox validates and splits tenant versus platform tables', async () => {
    const store = emptyStore();
    const client = await createMemoryPool(store).connect();
    const now = '2026-10-03T12:00:00.000Z';
    const tenantEnv = envelopeOf({
      eventType: 'OrganisationChanged',
      tenantId: T1,
      cellId: 'cell-01',
      aggregateType: 'Organisation',
      aggregateId: CHILD,
      aggregateVersion: 1,
      occurredAt: now,
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: { organisation_id: CHILD, change: 'CREATED', version_no: 1, valid_from: now },
    });
    await insertOutbox(client, tenantEnv, TOPIC_DOMAIN);
    expect(store.outbox).toHaveLength(1);
    const platEnv = envelopeOf({
      eventType: 'AuditEventSubmitted',
      tenantId: null,
      cellId: 'cell-01',
      aggregateType: 'AuditEvent',
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      occurredAt: now,
      correlationId: ctx.correlation_id,
      actor: adminCtx.actor,
      data: { audit_id: randomUUID() },
    });
    await insertOutbox(client, platEnv, TOPIC_AUDIT);
    expect(store.outboxPlatform).toHaveLength(1);
    const noAuditId = envelopeOf({
      eventType: 'AuditEventSubmitted',
      tenantId: null,
      cellId: 'cell-01',
      aggregateType: 'AuditEvent',
      aggregateId: CHILD,
      aggregateVersion: 1,
      occurredAt: now,
      correlationId: ctx.correlation_id,
      actor: adminCtx.actor,
      data: {},
    });
    await insertOutbox(client, noAuditId, TOPIC_AUDIT);
    expect(store.outboxPlatform).toHaveLength(2);
    await expect(
      insertOutbox(client, { extra: true } as never, TOPIC_DOMAIN),
    ).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
  });

  it('lockTenant, currentBinding, assertNoCycle, and newId', async () => {
    const store = emptyStore();
    seedTenant(store, { tenantId: T1, code: 'tenant-one', actorId: ACTOR });
    const client = await createMemoryPool(store).connect();
    await lockTenant(client, T1);
    await expect(lockTenant(client, CHILD)).rejects.toMatchObject({ code: 'SF-SYS-002' });
    const binding = await currentBinding(client, T1, new Date('2026-10-03T12:00:00.000Z'));
    expect(binding?.cell_id).toBe('cell-01');
    expect(await currentBinding(client, CHILD, new Date())).toBeNull();
    await assertNoCycle(client, CHILD, null, new Date());
    await expect(assertNoCycle(client, CHILD, CHILD, new Date())).rejects.toMatchObject({
      code: 'SF-SYS-003',
    });
    store.orgRelations.push({
      relation_id: randomUUID(),
      tenant_id: T1,
      child_organisation_id: PARENT,
      parent_organisation_id: CHILD,
      version_no: '1',
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
    });
    await expect(assertNoCycle(client, CHILD, PARENT, new Date())).rejects.toMatchObject({
      code: 'SF-SYS-003',
    });
    const depthClient = {
      query: async (sql: string) => {
        if (sql.includes('SET LOCAL')) return { rows: [], rowCount: 0 };
        return { rows: [{ org_id: PARENT, depth: 128 }], rowCount: 1 };
      },
    } as unknown as PoolClient;
    await expect(assertNoCycle(depthClient, CHILD, PARENT, new Date())).rejects.toMatchObject({
      details: [{ code: 'HIERARCHY_DEPTH' }],
    });
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('outboxAuditRecorder validates and writes', async () => {
    const store = emptyStore();
    const client = await createMemoryPool(store).connect();
    await expect(outboxAuditRecorder.append(client, { no: true } as never)).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    const event: AuditEvent = {
      audit_id: randomUUID(),
      occurred_at: '2026-10-03T12:00:00.000Z',
      tenant_id: T1,
      cell_id: 'cell-01',
      actor_type: 'OFFICER',
      actor_id: ACTOR,
      action: 'ORGANISATION_CREATE',
      action_class: 'WRITE',
      resource_type: 'Organisation',
      resource_id: CHILD,
      correlation_id: ctx.correlation_id,
      trace_id: TRACE,
      result: 'SUCCESS',
      classification: 'TENANT_SCOPED',
    };
    await outboxAuditRecorder.append(client, event);
    expect(store.outbox).toHaveLength(1);
    const platform: AuditEvent = {
      ...event,
      audit_id: randomUUID(),
      tenant_id: null,
      action: 'TENANT_CREATE',
      action_class: 'PRIVILEGED',
      resource_type: 'Tenant',
      reason: 'bootstrap',
    };
    await outboxAuditRecorder.append(client, platform);
    expect(store.outboxPlatform).toHaveLength(1);
  });
});

describe('route helpers', () => {
  it('iso, requirePrivileged, readIdempotencyKey, runCommand, writeDenied', async () => {
    const clock = frozenClock('2026-10-03T12:00:00.000Z');
    expect(iso(clock)).toBe('2026-10-03T12:00:00.000Z');
    requirePrivileged(adminCtx);
    expect(() => requirePrivileged(ctx)).toThrow(Cmp002Error);
    expect(() => requirePrivileged({ ...adminCtx, auth_assurance: 'PASSWORD' })).toThrow(
      Cmp002Error,
    );
    expect(readIdempotencyKey(fakeRequest({ 'idempotency-key': 'idem-key-01' }))).toBe(
      'idem-key-01',
    );
    expect(readIdempotencyKey(fakeRequest({ 'idempotency-key': ['idem-key-02'] }))).toBe(
      'idem-key-02',
    );
    expect(() => readIdempotencyKey(fakeRequest({}))).toThrow(Cmp002Error);
    expect(() => readIdempotencyKey(fakeRequest({ 'idempotency-key': 'short' }))).toThrow(
      Cmp002Error,
    );

    const store = emptyStore();
    seedTenant(store, { tenantId: T1, code: 'tenant-one', actorId: ACTOR });
    const deps: RouteDeps = {
      pool: createMemoryPool(store),
      authorizer: new ContractAuthorizer(),
      audit: { append: async () => undefined },
      clock,
    };
    const first = await runCommand(
      deps,
      fakeRequest({ 'idempotency-key': 'idem-run-01' }),
      ctx,
      'POST /v1/x',
      undefined,
      async () => ({
        status: 201,
        body: { n: 1 },
      }),
    );
    expect(first).toEqual({ status: 201, body: { n: 1 } });
    const replay = await runCommand(
      deps,
      fakeRequest({ 'idempotency-key': 'idem-run-01' }),
      ctx,
      'POST /v1/x',
      undefined,
      async () => ({ status: 500, body: { n: 9 } }),
    );
    expect(replay).toEqual({ status: 201, body: { n: 1 } });

    const denied = {
      ...deps,
      audit: {
        append: async () => {
          throw new Error('audit-down');
        },
      },
    };
    await writeDenied(
      denied,
      ctx,
      fakeRequest({}, '/v1/admin/tenants-unit-a'),
      'TENANT_CREATE',
      'tenant',
      T1,
    );
    await writeDenied(
      denied,
      adminCtx,
      fakeRequest({}, '/v1/admin/tenants-unit-b'),
      'TENANT_CREATE',
      'tenant',
      null,
    );
    for (let i = 0; i < 25; i += 1) {
      await writeDenied(
        deps,
        ctx,
        fakeRequest({}, '/v1/admin/tenants-unit-limit'),
        'TENANT_CREATE',
        'tenant',
        T1,
      );
    }
  });

  it('assertNoTenantIdentifyingHeaders covers forwarded arrays', () => {
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        headers: { forwarded: ['for=1.1.1.1', ' tenant=abc'] },
      } as never),
    ).toThrow(Cmp002Error);
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        headers: { forwarded: ['for=1.1.1.1;tenant=xyz'] },
      } as never),
    ).toThrow(Cmp002Error);
    assertNoTenantIdentifyingHeaders({ headers: { forwarded: 'for=1.1.1.1' } } as never);
    assertNoTenantIdentifyingHeaders({ headers: { forwarded: ['for=1.1.1.1'] } } as never);
    assertNoTenantIdentifyingHeaders({ headers: { forwarded: undefined } } as never);
  });

  it('canonicalJson covers arrays and scalars', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(1)).toBe('1');
    expect(canonicalJson(['b', { z: 1, a: 2 }])).toBe('["b",{"a":2,"z":1}]');
  });
});
