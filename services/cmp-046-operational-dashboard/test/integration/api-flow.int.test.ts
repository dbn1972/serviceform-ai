import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOpsDashboardApi } from '../../src/api/handler.js';
import { VIEW_CODES, type ViewCode } from '../../src/domain/model.js';
import { buildOpsDashboardService } from '../../src/index.js';
import type { RequestContext } from '../../src/types.js';
import { ctxFor, MutableClock, ScriptedAuthorizer, ScriptedPort } from '../doubles/fixtures.js';
import {
  asSqlPool,
  closeHarness,
  resetData,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-046 API over PostgreSQL (real LOGIN role, FORCE RLS)', () => {
  let h: Harness;
  const holder: { ctx: RequestContext | null } = { ctx: null };
  const ports = Object.fromEntries(VIEW_CODES.map((c) => [c, new ScriptedPort()])) as Record<
    ViewCode,
    ScriptedPort
  >;
  const authorizer = new ScriptedAuthorizer();
  const clock = new MutableClock(Date.parse('2026-10-10T10:00:00Z'));
  let call: (
    m: string,
    p: string,
    body?: unknown,
    key?: string,
  ) => Promise<{ status: number; body: unknown }>;
  let n = 0;

  beforeAll(async () => {
    h = await setupHarness();
    const service = buildOpsDashboardService({
      pool: asSqlPool(h.rt),
      authorizer,
      ports,
      clock: clock.now,
      portTimeoutMs: 500,
    });
    const api = createOpsDashboardApi({
      service,
      resolveContext: () => Promise.resolve(holder.ctx),
    });
    call = (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> = {};
      if (method === 'POST')
        headers['idempotency-key'] = key ?? `it-key-${String(n).padStart(8, '0')}`;
      return api.handle({ method, path, headers, body });
    };
  }, 180_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  beforeEach(async () => {
    await resetData(h.admin);
    holder.ctx = ctxFor(T1);
    authorizer.denyAll = false;
    authorizer.fail = false;
    authorizer.deniedActions.clear();
    for (const p of Object.values(ports)) {
      p.failWith = null;
      p.calls = 0;
    }
  });

  it('refresh -> read -> list persists derived snapshots with outbox event and audit in one transaction', async () => {
    const res = await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {});
    expect(res.status).toBe(200);
    expect((res.body as Body)['view']).toMatchObject({
      status: 'OK',
      snapshot_version: 1,
      non_authoritative: true,
    });
    const got = await call('GET', '/v1/ops/views/SLA_SUMMARY');
    expect(got.status).toBe(200);
    expect((got.body as Body)['metrics']).toHaveLength(3);
    const list = (await call('GET', '/v1/ops/views')).body as Body;
    expect(list['overall_status']).toBe('UNAVAILABLE');
    expect(list['views']).toHaveLength(5);

    const outbox = await h.admin.query(
      'SELECT topic, event_type, status FROM sf_ops_dashboard.outbox_event ORDER BY seq',
    );
    expect(outbox.rows.map((r) => `${r['topic']}:${r['event_type']}`)).toEqual([
      'sf.ops-dashboard.events.v1:OpsViewRefreshed',
      'sf.audit.ingest.v1:AuditEventSubmitted',
      'sf.audit.ingest.v1:AuditEventSubmitted',
      'sf.audit.ingest.v1:AuditEventSubmitted',
    ]);
    const log = await h.admin.query(
      'SELECT outcome, resulting_status FROM sf_ops_dashboard.ops_view_refresh_log',
    );
    expect(log.rows).toEqual([{ outcome: 'SUCCESS', resulting_status: 'OK' }]);
  });

  it('keeps last-known metrics when a refresh fails, bumping the version by one', async () => {
    await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {});
    ports.SLA_SUMMARY.failWith = Object.assign(new Error('down'), { code: 'SLA_PORT_DOWN' });
    clock.advance(60_000);
    const res = await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {});
    expect((res.body as Body)['view']).toMatchObject({
      status: 'UNAVAILABLE',
      snapshot_version: 2,
      last_error_code: 'SLA_PORT_DOWN',
    });
    expect((res.body as Body)['view']['metrics']).toHaveLength(3);
    const row = await h.admin.query(
      'SELECT status, jsonb_array_length(metrics) AS n FROM sf_ops_dashboard.ops_view_snapshot',
    );
    expect(row.rows).toEqual([{ status: 'UNAVAILABLE', n: 3 }]);
  });

  it('isolates tenants end to end and never reads another tenant row', async () => {
    await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {});
    holder.ctx = ctxFor(T2);
    expect((await call('GET', '/v1/ops/views/SLA_SUMMARY')).status).toBe(404);
    await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {});
    const counts = await h.admin.query(
      'SELECT tenant_id, snapshot_version FROM sf_ops_dashboard.ops_view_snapshot ORDER BY tenant_id',
    );
    expect(counts.rows).toEqual([
      { tenant_id: T1, snapshot_version: '1' },
      { tenant_id: T2, snapshot_version: '1' },
    ]);
  });

  it('replays an idempotent refresh and conflicts on a reused key for another view', async () => {
    const first = await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {}, 'idem-key-000001');
    clock.advance(1000);
    const replay = await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {}, 'idem-key-000001');
    expect(replay.body).toEqual(first.body);
    const clash = await call('POST', '/v1/ops/views/EVENT_HEALTH/refresh', {}, 'idem-key-000001');
    expect(clash.status).toBe(409);
    const v = await h.admin.query(
      'SELECT snapshot_version FROM sf_ops_dashboard.ops_view_snapshot',
    );
    expect(v.rows).toEqual([{ snapshot_version: '1' }]);
  });

  it('serialises concurrent refreshes of one view so versions advance strictly by one', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => call('POST', '/v1/ops/views/EVENT_HEALTH/refresh', {})),
    );
    const v = await h.admin.query(
      'SELECT snapshot_version FROM sf_ops_dashboard.ops_view_snapshot',
    );
    const log = await h.admin.query(
      'SELECT count(*)::int AS n FROM sf_ops_dashboard.ops_view_refresh_log',
    );
    expect(Number(v.rows[0]?.['snapshot_version'])).toBe(log.rows[0]?.['n']);
  });

  it('denies and fails closed without touching sources or data', async () => {
    authorizer.deniedActions.add('OPS_REFRESH_VIEW');
    expect((await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {})).status).toBe(403);
    authorizer.deniedActions.clear();
    authorizer.fail = true;
    expect((await call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {})).status).toBe(503);
    expect(ports.SLA_SUMMARY.calls).toBe(0);
    const snapshots = await h.admin.query('SELECT 1 FROM sf_ops_dashboard.ops_view_snapshot');
    expect(snapshots.rows).toEqual([]);
    const audits = await h.admin.query(
      `SELECT envelope -> 'data' ->> 'result' AS result FROM sf_ops_dashboard.outbox_event`,
    );
    expect(audits.rows).toEqual([{ result: 'DENIED' }]);
  });
});
