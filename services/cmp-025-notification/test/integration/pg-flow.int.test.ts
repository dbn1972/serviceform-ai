import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotificationApi } from '../../src/api/handler.js';
import { DefaultConnectorRegistry } from '../../src/connectors/registry.js';
import { PgNotificationRepository, type SqlClient, type SqlPool } from '../../src/repo/pg.js';
import { NotificationDeliveryWorker } from '../../src/service/delivery.js';
import { NotificationService } from '../../src/service/service.js';
import type { RequestContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  BINDING_SMS,
  CANARY_ADDRESS,
  ctxFor,
  DISPATCH_BODY,
  MapBindingPort,
  MapRecipientDirectory,
  simulatedBinding,
  systemCtx,
  TEMPLATE_BODY,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { asSqlPool, asTenant, closeHarness, setupHarness, T1, type Harness } from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Counts open transactions so provider I/O can assert it happens with none open. */
class TxProbePool implements SqlPool {
  open = 0;
  constructor(private readonly inner: SqlPool) {}
  async connect(): Promise<SqlClient> {
    const client = await this.inner.connect();
    return new ProbeClient(client, this);
  }
}

class ProbeClient implements SqlClient {
  constructor(
    private readonly client: SqlClient,
    private readonly pool: TxProbePool,
  ) {}
  async query<R = Record<string, unknown>>(text: string, values?: unknown[]) {
    if (text === 'BEGIN') this.pool.open += 1;
    const out = await this.client.query<R>(text, values);
    if (text === 'COMMIT' || text === 'ROLLBACK') this.pool.open -= 1;
    return out;
  }
  release(): void {
    this.client.release();
  }
}

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

describe('CMP-025 against PostgreSQL (INT-011, INT-013)', () => {
  let h: Harness;
  let probe: TxProbePool;
  let openDuringSend: number[];
  let registry: DefaultConnectorRegistry;
  let state: { ctx: RequestContext | null };
  let api: ReturnType<typeof createNotificationApi>;
  let worker: NotificationDeliveryWorker;
  let bindings: MapBindingPort;
  let recipients: MapRecipientDirectory;
  let counter = 0;

  const call = (method: string, path: string, body?: unknown, key?: string) => {
    counter += 1;
    return api.handle({
      method,
      path,
      headers: { 'idempotency-key': key ?? `pg-flow-key-${String(counter).padStart(6, '0')}` },
      body,
    });
  };

  beforeAll(async () => {
    h = await setupHarness();
    probe = new TxProbePool(asSqlPool(h.rt));
    openDuringSend = [];
    registry = new DefaultConnectorRegistry({
      simulation: {
        testRunId: 'run-cmp025-pg',
        scenarioFor: () => {
          openDuringSend.push(probe.open);
          return 'accepted';
        },
      },
    });
    bindings = new MapBindingPort();
    bindings.bindings.set(BINDING_SMS, simulatedBinding({ tenant_id: null }));
    recipients = new MapRecipientDirectory();
    recipients.addresses.set(`${TENANT_A}:handle.citizen.demo.001`, CANARY_ADDRESS);
    recipients.addresses.set(`${TENANT_B}:handle.citizen.demo.001`, CANARY_ADDRESS);
    const service = new NotificationService({
      repo: new PgNotificationRepository(probe),
      authorizer: new AllowAllAuthorizer(),
      bindings,
      recipients,
      connectors: registry,
      environment: 'CI',
      testRunId: 'run-cmp025-pg',
      clock: () => new Date(),
      workerId: 'worker-pg-1',
    });
    worker = new NotificationDeliveryWorker(service);
    state = { ctx: ctxFor(T1) };
    api = createNotificationApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('publishes templates, dispatches idempotently, drains with provider I/O outside any transaction', async () => {
    expect((await call('POST', '/v1/notification-templates', TEMPLATE_BODY)).status).toBe(201);
    const v2 = await call('POST', '/v1/notification-templates', {
      ...TEMPLATE_BODY,
      body_template: 'v2 {{amount_text}} {{reference_no}}',
    });
    expect((v2.body as Body)['template_version']).toBe(2);

    const a = await call('POST', '/v1/notifications', DISPATCH_BODY, 'pg-dispatch-0001');
    expect(a.status, JSON.stringify(a.body)).toBe(202);
    const id = (a.body as Body)['dispatch'].dispatch_id as string;
    const replay = await call('POST', '/v1/notifications', DISPATCH_BODY, 'pg-dispatch-0001');
    expect(replay.body).toEqual(a.body);
    const conflict = await call(
      'POST',
      '/v1/notifications',
      {
        ...DISPATCH_BODY,
        locale: 'en-IN',
        template_params: { amount_text: 'INR 9', reference_no: 'R-9' },
      },
      'pg-dispatch-0001',
    );
    expect(conflict.status).toBe(409);

    const count = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_notification.notification_dispatch WHERE tenant_id = $1`,
      [T1],
    );
    expect(count.rows[0]?.['n']).toBe(1);

    const out = await worker.deliverDue(systemCtx(T1));
    expect(out).toMatchObject({ claimed: 1, sent: 1 });
    expect(openDuringSend).toEqual([0]);

    const read = await call('GET', `/v1/notifications/${id}`);
    expect(read.status).toBe(200);
    expect((read.body as Body)['status']).toBe('SENT');
    expect((read.body as Body)['attempt_history']).toHaveLength(1);
    expect((read.body as Body)['attempt_history'][0].simulation_marker).toMatchObject({
      simulation: true,
    });
    const sink = must(registry.simulatedConnector(BINDING_SMS)).sink;
    expect(sink[0]?.body).toMatch(/^\[TEST\/SIMULATED run=run-cmp025-pg\] v2 INR 150 /);
  });

  it('writes outbox + audit rows in the same transaction and never persists the address', async () => {
    const events = await h.admin.query(
      `SELECT topic, event_type FROM sf_notification.outbox_event WHERE tenant_id = $1 ORDER BY seq`,
      [T1],
    );
    const types = events.rows.map((r) => r['event_type']);
    expect(types).toEqual(
      expect.arrayContaining([
        'NotificationTemplatePublished',
        'NotificationQueued',
        'NotificationSent',
        'AuditEventSubmitted',
      ]),
    );
    const all = await h.admin.query(
      `SELECT (SELECT string_agg(envelope::text, '') FROM sf_notification.outbox_event) AS o,
              (SELECT string_agg(d::text, '') FROM sf_notification.notification_dispatch d) AS d,
              (SELECT string_agg(a::text, '') FROM sf_notification.dispatch_attempt a) AS a,
              (SELECT string_agg(response_body::text, '') FROM sf_notification.idempotency_record) AS i`,
    );
    const row = all.rows[0] as Record<string, string>;
    for (const v of Object.values(row)) expect(v ?? '').not.toContain(CANARY_ADDRESS);
  });

  it('tenant isolation: another tenant sees nothing, cannot reuse the binding or drain the queue', async () => {
    state.ctx = ctxFor(TENANT_B);
    const id = (
      await h.admin.query(
        `SELECT dispatch_id FROM sf_notification.notification_dispatch WHERE tenant_id = $1`,
        [T1],
      )
    ).rows[0]?.['dispatch_id'] as string;
    expect((await call('GET', `/v1/notifications/${id}`)).status).toBe(404);
    expect(await worker.deliverDue(systemCtx(TENANT_B))).toMatchObject({ claimed: 0 });
    const own = await asTenant(
      h.rt,
      TENANT_B,
      TENANT_B,
      async (c) =>
        (await c.query('SELECT count(*)::int AS n FROM sf_notification.notification_dispatch'))
          .rows[0]?.['n'],
    );
    expect(own).toBe(0);
    state.ctx = ctxFor(T1);
  });

  it('concurrent drains never double-claim a dispatch (FOR UPDATE SKIP LOCKED)', async () => {
    for (let i = 0; i < 6; i += 1) {
      const r = await call(
        'POST',
        '/v1/notifications',
        DISPATCH_BODY,
        `pg-concurrent-${String(i).padStart(4, '0')}`,
      );
      expect(r.status).toBe(202);
    }
    const before = must(registry.simulatedConnector(BINDING_SMS)).sink.length;
    const mk = (id: string) =>
      new NotificationDeliveryWorker(
        new NotificationService({
          repo: new PgNotificationRepository(probe),
          authorizer: new AllowAllAuthorizer(),
          bindings,
          recipients,
          connectors: registry,
          environment: 'CI',
          testRunId: 'run-cmp025-pg',
          clock: () => new Date(),
          workerId: id,
        }),
      );
    const results = await Promise.all([
      mk('w-a').deliverDue(systemCtx(T1), { limit: 6 }),
      mk('w-b').deliverDue(systemCtx(T1), { limit: 6 }),
      mk('w-c').deliverDue(systemCtx(T1), { limit: 6 }),
    ]);
    const claimed = results.reduce((n, r) => n + r.claimed, 0);
    const sent = results.reduce((n, r) => n + r.sent, 0);
    expect(claimed).toBe(6);
    expect(sent).toBe(6);
    expect(must(registry.simulatedConnector(BINDING_SMS)).sink.length - before).toBe(6);
    const attempts = await h.admin.query(
      `SELECT dispatch_id, count(*)::int AS n FROM sf_notification.dispatch_attempt GROUP BY 1 HAVING count(*) > 1`,
    );
    expect(attempts.rows).toEqual([]);
  });

  it('an expired lease is re-claimed after a crash; an unexpired one is not', async () => {
    const r = await call('POST', '/v1/notifications', DISPATCH_BODY, 'pg-lease-0001');
    const id = (r.body as Body)['dispatch'].dispatch_id as string;
    await asTenant(h.rt, T1, T1, async (c) => {
      await c.query(
        `UPDATE sf_notification.notification_dispatch SET status = 'SENDING', attempts = 1,
           lease_owner = 'dead-worker', lease_expires_at = now() + interval '1 hour', aggregate_version = aggregate_version + 1
         WHERE dispatch_id = $1`,
        [id],
      );
    });
    expect(await worker.deliverDue(systemCtx(T1))).toMatchObject({ claimed: 0 });
    await asTenant(h.rt, T1, T1, async (c) => {
      await c.query(
        `UPDATE sf_notification.notification_dispatch SET lease_expires_at = now() - interval '1 second',
           aggregate_version = aggregate_version + 1 WHERE dispatch_id = $1`,
        [id],
      );
    });
    expect(await worker.deliverDue(systemCtx(T1))).toMatchObject({ claimed: 1, sent: 1 });
    const row = (
      await h.admin.query(
        `SELECT status, attempts FROM sf_notification.notification_dispatch WHERE dispatch_id = $1`,
        [id],
      )
    ).rows[0];
    expect(row).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('a mid-transaction failure rolls back the dispatch, idempotency claim and outbox together', async () => {
    const before = (
      await h.admin.query(`SELECT count(*)::int AS n FROM sf_notification.outbox_event`)
    ).rows[0]?.['n'] as number;
    const bad = await call(
      'POST',
      '/v1/notifications',
      { ...DISPATCH_BODY, template_ref: 'tpl.does.not.exist' },
      'pg-rollback-0001',
    );
    expect(bad.status).toBe(404);
    const after = (
      await h.admin.query(`SELECT count(*)::int AS n FROM sf_notification.outbox_event`)
    ).rows[0]?.['n'] as number;
    expect(after).toBe(before);
    const idem = await h.admin.query(
      `SELECT 1 FROM sf_notification.idempotency_record WHERE idempotency_key = 'pg-rollback-0001'`,
    );
    expect(idem.rows).toEqual([]);
  });
});
