import { describe, expect, it } from 'vitest';
import { ctxFor, FEE_QUOTE_ID, TENANT_A, TEST_RUN_ID, fixtureToken } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import type { ActorType } from '../../src/types.js';

describe('API flow', () => {
  it('POST /v1/payment-intents → 201 with frozen contract shape', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    expect(r.status).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['contract_id']).toBe('SF-CON-PAYMENT-INTENT');
    expect(body['amount_locked_from_fee_quote']).toBe(true);
    expect(body['client_supplied_amount_forbidden']).toBe(true);
    expect(body['status']).toBe('CREATED');
    expect(body['connector_mode']).toBe('SIMULATED');
    expect(body['simulation_marker_required_when_simulated']).toBe(true);
  });

  it('POST /v1/payment-intents with amount in body → 400 (SF-SYS-003)', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      amount: 500,
    });
    expect(r.status).toBe(400);
  });

  it('GET /v1/payment-intents/:id → 200', async () => {
    const h = makeHarness();
    const created = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    const id = (created.body as Record<string, unknown>)['payment_intent_id'] as string;
    const r = await h.call('GET', `/v1/payment-intents/${id}`, undefined, { key: null });
    expect(r.status).toBe(200);
    expect((r.body as Record<string, unknown>)['payment_intent_id']).toBe(id);
  });

  it('GET /v1/payment-intents/bad-uuid → 400', async () => {
    const h = makeHarness();
    const r = await h.call('GET', '/v1/payment-intents/not-a-uuid', undefined, { key: null });
    expect(r.status).toBe(400);
  });

  it('GET unknown route → 404', async () => {
    const h = makeHarness();
    const r = await h.call('GET', '/v1/nope', undefined, { key: null });
    expect(r.status).toBe(404);
  });

  it('missing idempotency key on POST → 400', async () => {
    const h = makeHarness();
    const r = await h.call(
      'POST',
      '/v1/payment-intents',
      { fee_quote_id: FEE_QUOTE_ID },
      { key: null },
    );
    expect(r.status).toBe(400);
  });

  it('tenant-identifying header rejected → 403', async () => {
    const h = makeHarness();
    const r = await h.call(
      'POST',
      '/v1/payment-intents',
      { fee_quote_id: FEE_QUOTE_ID },
      {
        headers: { 'x-tenant-id': 'any' },
      },
    );
    expect(r.status).toBe(403);
  });

  it('full intent→callback→captured flow produces 2 domain events + 2 audit events', async () => {
    const { signPayload, simulatorSecret } = await import('../../src/connectors/simulated-psp.js');
    const h = makeHarness();
    const created = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    const body = created.body as Record<string, unknown>;
    const paymentIntentId = String(body['payment_intent_id']);

    const cbBody = {
      payment_intent_id: paymentIntentId,
      outcome: 'CAPTURED',
      exactly_once_key: fixtureToken('api', 'flow', 'cb', '001xx'),
      idempotency_key: fixtureToken('api', 'flow', 'idem', '001'),
    };
    const sig = signPayload(simulatorSecret(TEST_RUN_ID), cbBody);
    h.state.ctx = ctxFor(
      TENANT_A,
      '77777777-7777-4777-8777-777777777777',
      'INTEGRATION' as ActorType,
    );
    const cbResult = await h.call('POST', '/v1/payment-callbacks', cbBody, {
      headers: { 'x-sim-signature': sig },
    });
    expect(cbResult.status).toBe(201);
    expect((cbResult.body as Record<string, unknown>)['signature_verified']).toBe(true);
    expect((cbResult.body as Record<string, unknown>)['financial_effect_applied']).toBe(true);

    const outbox = h.repo.tenant(TENANT_A).outbox;
    const domainEvents = outbox.filter((e) => e.topic === 'sf.payment.events.v1');
    const auditEvents = outbox.filter((e) => e.topic === 'sf.audit.ingest.v1');
    expect(domainEvents).toHaveLength(2);
    expect(auditEvents).toHaveLength(2);
  });
});
