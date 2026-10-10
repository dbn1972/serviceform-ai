import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFeeApi, type ApiResponse } from '../../src/api/handler.js';
import { buildFeeService, PgFeeRepository } from '../../src/index.js';
import type { TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  APPLICATION_ID,
  ctxFor,
  FakeApplicationPins,
  FakeFeePolicy,
  FakeFeeRules,
  FEE_POLICY_FIXED,
  FEE_POLICY_RULES,
  fixedPolicy,
  TENANT_A,
  TENANT_B,
  TxProbe,
} from '../doubles/fixtures.js';
import { asSqlPool, closeHarness, setupHarness, type Harness } from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-020 API over real PostgreSQL (FORCE RLS runtime login)', () => {
  let h: Harness;
  let probe: TxProbe;
  let pins: FakeApplicationPins;
  let policies: FakeFeePolicy;
  let rules: FakeFeeRules;
  let state: { ctx: TenantContext };
  let call: (
    method: string,
    path: string,
    body?: unknown,
    key?: string | null,
  ) => Promise<ApiResponse>;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  beforeEach(async () => {
    await h.admin.query(
      'TRUNCATE sf_fee.fee_quote_line, sf_fee.fee_quote, sf_fee.idempotency_record, sf_fee.outbox_event CASCADE',
    );
    const repo = new PgFeeRepository(asSqlPool(h.rt));
    probe = new TxProbe();
    probe.repo = repo;
    pins = new FakeApplicationPins(probe);
    policies = new FakeFeePolicy(probe);
    rules = new FakeFeeRules(probe);
    state = { ctx: ctxFor(TENANT_A) };
    const service = buildFeeService({
      repository: repo,
      authorizer: new AllowAllAuthorizer(),
      applicationPins: pins,
      feePolicy: policies,
      feeRules: rules,
    });
    const api = createFeeApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
    let n = 0;
    call = (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> = {};
      if (key !== null) headers['idempotency-key'] = key ?? `int-key-${String(n).padStart(6, '0')}`;
      return api.handle({ method, path, headers, body });
    };
  });

  it('issues, persists, replays and reads a metadata-only quote', async () => {
    const created = await call(
      'POST',
      '/v1/fee-quotes',
      { application_id: APPLICATION_ID },
      'int-replay-01',
    );
    expect(created.status).toBe(201);
    const q = created.body as Body;
    expect(q).toMatchObject({
      total_amount_minor: 13023,
      amount_source: 'FEE_POLICY_METADATA',
      fee_policy_version_id: FEE_POLICY_FIXED,
    });

    const replay = await call(
      'POST',
      '/v1/fee-quotes',
      { application_id: APPLICATION_ID },
      'int-replay-01',
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    expect(pins.calls).toBe(1);

    const read = await call('GET', `/v1/fee-quotes/${q['quote_id']}`, undefined, null);
    expect(read.body).toEqual(created.body);

    const rows = await h.admin.query(
      `SELECT topic, event_type, tenant_id::text AS tenant_id FROM sf_fee.outbox_event ORDER BY seq`,
    );
    expect(rows.rows).toEqual([
      { topic: 'sf.fee.events.v1', event_type: 'FeeQuoteIssued', tenant_id: TENANT_A },
      { topic: 'sf.audit.ingest.v1', event_type: 'AuditEventSubmitted', tenant_id: TENANT_A },
    ]);
    const idem = await h.admin.query(
      `SELECT status, response_status FROM sf_fee.idempotency_record`,
    );
    expect(idem.rows).toEqual([{ status: 'COMPLETED', response_status: 201 }]);
    expect(probe.violations).toBe(0);
  });

  it('rules-sourced quote round-trips exact integers beyond 2^53 / 2 through bigint columns', async () => {
    pins.pinPolicy(FEE_POLICY_RULES);
    rules.outputs = { line_amount_minor: '4503599627370000' };
    const res = await call('POST', '/v1/fee-quotes', {
      application_id: APPLICATION_ID,
      facts: { category_code: 'A' },
    });
    expect(res.status).toBe(201);
    expect((res.body as Body)['total_amount_minor']).toBe(4503599627370500);
    const stored = await h.admin.query(
      `SELECT total_amount_minor::text AS t, amount_source, rule_content_hash IS NOT NULL AS has_rule FROM sf_fee.fee_quote`,
    );
    expect(stored.rows).toEqual([
      { t: '4503599627370500', amount_source: 'RULES_ENGINE', has_rule: true },
    ]);
    const read = await call(
      'GET',
      `/v1/fee-quotes/${(res.body as Body)['quote_id']}`,
      undefined,
      null,
    );
    expect(read.body).toEqual(res.body);
  });

  it('concurrent identical requests under different keys yield one immutable quote', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        call(
          'POST',
          '/v1/fee-quotes',
          { application_id: APPLICATION_ID },
          `int-conc-${String(i).padStart(4, '0')}`,
        ),
      ),
    );
    const ids = new Set(results.map((r) => (r.body as Body)['quote_id']));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    const count = await h.admin.query('SELECT count(*)::int AS n FROM sf_fee.fee_quote');
    expect(count.rows[0]?.['n']).toBe(1);
    const events = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_fee.outbox_event WHERE event_type = 'FeeQuoteIssued'`,
    );
    expect(events.rows[0]?.['n']).toBe(1);
  });

  it('wrong tenant cannot read or list; CROSS_TENANT_LEAKAGE = 0', async () => {
    const created = await call('POST', '/v1/fee-quotes', { application_id: APPLICATION_ID });
    const id = (created.body as Body)['quote_id'] as string;
    state.ctx = ctxFor(TENANT_B);
    const read = await call('GET', `/v1/fee-quotes/${id}`, undefined, null);
    expect(read.status).toBe(404);
    const list = await call(
      'GET',
      `/v1/applications/${APPLICATION_ID}/fee-quotes`,
      undefined,
      null,
    );
    expect((list.body as Body)['quotes']).toEqual([]);
    expect(JSON.stringify([read.body, list.body])).not.toContain(id);
  });

  it('a refused calculation writes nothing (no quote, outbox or idempotency row)', async () => {
    policies.versions.set(
      FEE_POLICY_FIXED,
      fixedPolicy({ lines: [{ code: 'A', basis: 'FIXED_AMOUNT', amount_minor: 9.99 }] }),
    );
    const res = await call('POST', '/v1/fee-quotes', { application_id: APPLICATION_ID });
    expect(res.status).toBe(409);
    const counts = await h.admin.query(
      `SELECT (SELECT count(*) FROM sf_fee.fee_quote)::int AS quotes,
              (SELECT count(*) FROM sf_fee.fee_quote_line)::int AS lines,
              (SELECT count(*) FROM sf_fee.idempotency_record)::int AS idem,
              (SELECT count(*) FROM sf_fee.outbox_event)::int AS outbox`,
    );
    expect(counts.rows[0]).toEqual({ quotes: 0, lines: 0, idem: 0, outbox: 0 });
  });
});
