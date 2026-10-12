import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPaymentApi, type ApiResponse } from '../../src/api/handler.js';
import { buildPaymentService, PgPaymentRepository } from '../../src/index.js';
import { SimulatedPspConnector } from '../../src/connectors/simulated-psp.js';
import { buildSimulationMarker } from '../../src/domain/simulation.js';
import type { SimulationMarker } from '../../src/domain/simulation.js';
import { signPayload, simulatorSecret } from '../../src/connectors/simulated-psp.js';
import type { TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  FakeConnectorBindingPort,
  FakeFeeQuotePort,
  FEE_QUOTE_ID,
  TENANT_A,
  TENANT_B,
  TEST_RUN_ID,
  TxProbe,
  fixtureToken,
} from '../doubles/fixtures.js';
import { asSqlPool, closeHarness, setupHarness, type Harness } from './helpers.js';

type Body = Record<string, unknown>;

describe('CMP-021 API over real PostgreSQL (FORCE RLS runtime login)', () => {
  let h: Harness;
  let probe: TxProbe;
  let connectorBinding: FakeConnectorBindingPort;
  let feeQuote: FakeFeeQuotePort;
  let state: { ctx: TenantContext };
  let call: (
    method: string,
    path: string,
    body?: unknown,
    key?: string | null,
    extraHeaders?: Record<string, string>,
  ) => Promise<ApiResponse>;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  beforeEach(async () => {
    await h.admin.query(
      `TRUNCATE sf_payment.payment_callback, sf_payment.payment_intent,
       sf_payment.exactly_once_effect, sf_payment.idempotency_record,
       sf_payment.outbox_event CASCADE`,
    );
    const repo = new PgPaymentRepository(asSqlPool(h.rt));
    probe = new TxProbe();
    probe.repo = repo;
    connectorBinding = new FakeConnectorBindingPort(probe);
    feeQuote = new FakeFeeQuotePort(probe);
    const binding = connectorBinding.binding!;
    const marker = buildSimulationMarker(binding, TEST_RUN_ID) as SimulationMarker;
    const gateway = new SimulatedPspConnector(marker);
    state = { ctx: ctxFor(TENANT_A) };
    const service = buildPaymentService({
      repository: repo,
      authorizer: new AllowAllAuthorizer(),
      feeQuote,
      connectorBinding,
      gateway,
      runtimeEnvironment: 'LOCAL',
    });
    const api = createPaymentApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
    let n = 0;
    call = (method, path, body, key, extraHeaders = {}) => {
      n += 1;
      const headers: Record<string, string> = { ...extraHeaders };
      if (key !== null) headers['idempotency-key'] = key ?? `int-key-${String(n).padStart(6, '0')}`;
      return api.handle({ method, path, headers, body });
    };
  });

  it('creates intent, persists row, replays identically, reads back', async () => {
    const created = await call(
      'POST',
      '/v1/payment-intents',
      {
        fee_quote_id: FEE_QUOTE_ID,
        test_run_id: TEST_RUN_ID,
      },
      'int-create-01',
    );
    expect(created.status).toBe(201);
    const b = created.body as Body;
    expect(b['contract_id']).toBe('SF-CON-PAYMENT-INTENT');
    expect(b['amount_minor']).toBe(10000);
    expect(b['status']).toBe('CREATED');

    // idempotency replay — does NOT call feeQuote a second time
    const callsBefore = feeQuote.calls;
    const replay = await call(
      'POST',
      '/v1/payment-intents',
      {
        fee_quote_id: FEE_QUOTE_ID,
        test_run_id: TEST_RUN_ID,
      },
      'int-create-01',
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    expect(feeQuote.calls).toBe(callsBefore); // priorResult short-circuits

    // GET reads back persisted row
    const read = await call(
      'GET',
      `/v1/payment-intents/${String(b['payment_intent_id'])}`,
      undefined,
      null,
    );
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);

    // DB: one intent row, two outbox events
    const rows = await h.admin.query(
      `SELECT topic, event_type FROM sf_payment.outbox_event ORDER BY seq`,
    );
    expect(rows.rows).toEqual([
      { topic: 'sf.payment.events.v1', event_type: 'PaymentIntentCreated' },
      { topic: 'sf.audit.ingest.v1', event_type: 'AuditEventSubmitted' },
    ]);
    const idem = await h.admin.query(
      `SELECT status, response_status FROM sf_payment.idempotency_record`,
    );
    expect(idem.rows).toEqual([{ status: 'COMPLETED', response_status: 201 }]);
    expect(probe.violations).toBe(0);
  });

  it('verified callback transitions intent to CAPTURED; duplicate exactly_once_key returns prior (zero second effect)', async () => {
    const created = await call(
      'POST',
      '/v1/payment-intents',
      {
        fee_quote_id: FEE_QUOTE_ID,
        test_run_id: TEST_RUN_ID,
      },
      'int-cb-create-01',
    );
    const paymentIntentId = String((created.body as Body)['payment_intent_id']);

    const onceRef = fixtureToken('int', 'exactly', 'once', '01x');
    const cbBody = {
      payment_intent_id: paymentIntentId,
      outcome: 'CAPTURED',
      exactly_once_key: onceRef,
      idempotency_key: fixtureToken('int', 'cb', 'idem', '001'),
    };
    // SIMULATED HMAC covers the exact request body (same bytes the gateway verifies).
    const sig = signPayload(simulatorSecret(TEST_RUN_ID), cbBody);

    state.ctx = ctxFor(TENANT_A, '77777777-7777-4777-8777-777777777777', 'INTEGRATION' as never);
    const cb1 = await call('POST', '/v1/payment-callbacks', cbBody, 'int-cb-http-idem-001', {
      'x-sim-signature': sig,
    });
    expect(cb1.status).toBe(201);
    const cb1Body = cb1.body as Body;
    expect(cb1Body['verification_result']).toBe('VERIFIED');
    expect(cb1Body['financial_effect_applied']).toBe(true);
    expect(cb1Body['signature_verified']).toBe(true);

    // duplicate with same exactly_once_key — returns 200 with prior body
    const cb2Body = {
      ...cbBody,
      idempotency_key: fixtureToken('int', 'cb', 'idem', '002'),
    };
    const sig2 = signPayload(simulatorSecret(TEST_RUN_ID), cb2Body);
    const cb2 = await call('POST', '/v1/payment-callbacks', cb2Body, 'int-cb-http-idem-002', {
      'x-sim-signature': sig2,
    });
    expect(cb2.status).toBe(200);
    expect(cb2.body).toEqual(cb1.body);

    // DB: intent is CAPTURED; exactly_once_effect has exactly one row
    const intent = await h.admin.query(
      `SELECT status FROM sf_payment.payment_intent WHERE payment_intent_id = $1`,
      [paymentIntentId],
    );
    expect(intent.rows[0]?.['status']).toBe('CAPTURED');
    const effects = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_payment.exactly_once_effect`,
    );
    expect(effects.rows[0]?.['n']).toBe(1);
  });

  it('wrong tenant cannot read or see the intent; CROSS_TENANT_LEAKAGE = 0', async () => {
    const created = await call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    const id = String((created.body as Body)['payment_intent_id']);
    state.ctx = ctxFor(TENANT_B);
    const read = await call('GET', `/v1/payment-intents/${id}`, undefined, null);
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain(id);
  });

  it('refused request writes nothing (no intent or outbox row)', async () => {
    feeQuote.quotes.delete(FEE_QUOTE_ID); // no quote → 404
    const res = await call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    expect(res.status).toBe(404);
    const counts = await h.admin.query(
      `SELECT (SELECT count(*) FROM sf_payment.payment_intent)::int AS intents,
              (SELECT count(*) FROM sf_payment.idempotency_record)::int AS idem,
              (SELECT count(*) FROM sf_payment.outbox_event)::int AS outbox`,
    );
    expect(counts.rows[0]).toEqual({ intents: 0, idem: 0, outbox: 0 });
  });
});
