import { describe, expect, it } from 'vitest';
import {
  AllowAllAuthorizer,
  ctxFor,
  FakeConnectorBindingPort,
  FakeFeeQuotePort,
  FEE_QUOTE_ID,
  fixtureIdem,
  fixtureToken,
  TENANT_A,
  TENANT_B,
  TEST_RUN_ID,
  TxProbe,
  requireDefined,
} from '../doubles/fixtures.js';
import { MemoryPaymentRepository } from '../doubles/memory-repo.js';
import { buildPaymentService } from '../../src/index.js';
import { SimulatedPspConnector } from '../../src/connectors/simulated-psp.js';
import { buildSimulationMarker } from '../../src/domain/simulation.js';
import type { SimulationMarker } from '../../src/domain/simulation.js';
import { Cmp021Error } from '../../src/errors.js';
import { signPayload, simulatorSecret } from '../../src/connectors/simulated-psp.js';
import { validateCreateIntentInput } from '../../src/service/input.js';

function makeService(env = 'LOCAL') {
  const repo = new MemoryPaymentRepository();
  const probe = new TxProbe();
  probe.repo = repo;
  const connectorBinding = new FakeConnectorBindingPort(probe, env as never);
  const feeQuote = new FakeFeeQuotePort(probe);
  const binding = requireDefined(connectorBinding.binding, 'binding');
  const marker = buildSimulationMarker(binding, TEST_RUN_ID) as SimulationMarker;
  const gateway = new SimulatedPspConnector(marker);
  const service = buildPaymentService({
    repository: repo,
    authorizer: new AllowAllAuthorizer(),
    feeQuote,
    connectorBinding,
    gateway,
    runtimeEnvironment: env as never,
    clock: () => new Date('2026-10-10T02:00:00Z'),
  });
  return { service, repo, probe, feeQuote, connectorBinding, gateway };
}

describe('createIntent', () => {
  it('creates an intent and returns SF-CON-PAYMENT-INTENT view', async () => {
    const { service, repo } = makeService();
    const ctx = ctxFor(TENANT_A);
    const result = await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      fixtureIdem(['test', 'create', '001'], 'a'),
    );
    expect(result.status).toBe(201);
    const body = result.body as Record<string, unknown>;
    expect(body['contract_id']).toBe('SF-CON-PAYMENT-INTENT');
    expect(body['amount_locked_from_fee_quote']).toBe(true);
    expect(body['client_supplied_amount_forbidden']).toBe(true);
    expect(body['connector_mode']).toBe('SIMULATED');
    expect(body['simulation_marker_required_when_simulated']).toBe(true);
    expect(repo.tenant(TENANT_A).outbox).toHaveLength(2);
  });

  it('priorResult replay: does not re-call fee quote or gateway on second identical request', async () => {
    const { service, feeQuote } = makeService();
    const ctx = ctxFor(TENANT_A);
    const idem = fixtureIdem(['test', 'replay', '001'], 'z');
    const first = await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      idem,
    );
    const callsAfterFirst = feeQuote.calls;
    const second = await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      idem,
    );
    expect(second.body).toEqual(first.body);
    expect(second.status).toBe(201);
    expect(feeQuote.calls).toBe(callsAfterFirst); // no second fee quote fetch
  });

  it('rejects client-supplied amount (SF-SYS-003 from validateCreateIntentInput)', () => {
    for (const body of [
      { fee_quote_id: FEE_QUOTE_ID, amount: 999 },
      { fee_quote_id: FEE_QUOTE_ID, amount_minor: 999 },
      { fee_quote_id: FEE_QUOTE_ID, currency: 'XTS' },
      { fee_quote_id: FEE_QUOTE_ID, total_amount_minor: 999 },
    ]) {
      const err = (() => {
        try {
          validateCreateIntentInput(body);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(Cmp021Error);
      expect((err as Cmp021Error).code).toBe('SF-SYS-003');
      expect((err as Cmp021Error).statusCode).toBe(400);
    }
  });

  it('port calls are outside TX', async () => {
    const { service, probe } = makeService();
    const ctx = ctxFor(TENANT_A);
    await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      fixtureIdem(['test', 'probe', '001'], 'c'),
    );
    expect(probe.violations).toBe(0);
  });

  it('cross-tenant fee quote is denied', async () => {
    const { service, feeQuote } = makeService();
    requireDefined(feeQuote.quotes.get(FEE_QUOTE_ID), 'quote').tenant_id = TENANT_B;
    const ctx = ctxFor(TENANT_A);
    await expect(
      service.createIntent(
        ctx,
        { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
        fixtureIdem(['test', 'cross', '001'], 'd'),
      ),
    ).rejects.toThrow(Cmp021Error);
  });

  it('missing fee quote returns 404', async () => {
    const { service } = makeService();
    const ctx = ctxFor(TENANT_A);
    await expect(
      service.createIntent(
        ctx,
        { fee_quote_id: '00000000-0000-4000-8000-000000000001', test_run_id: TEST_RUN_ID },
        fixtureIdem(['test', '404', '001'], 'e'),
      ),
    ).rejects.toThrow(Cmp021Error);
  });
});

describe('applyCallback', () => {
  it('VERIFIED callback transitions intent to CAPTURED and applies financial effect once', async () => {
    const { service, repo } = makeService();
    const ctx = ctxFor(TENANT_A);
    const intentResult = await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      fixtureIdem(['test', 'cap', '001'], 'f'),
    );
    const intentBody = intentResult.body as Record<string, unknown>;
    const paymentIntentId = String(intentBody['payment_intent_id']);
    const callbackPayload = {
      payment_intent_id: paymentIntentId,
      outcome: 'CAPTURED',
    };
    const secret = simulatorSecret(TEST_RUN_ID);
    const sig = signPayload(secret, callbackPayload);
    const cbCtx = ctxFor(TENANT_A, '77777777-7777-4777-8777-777777777777', 'INTEGRATION');
    const cbResult = await service.applyCallback(cbCtx, {
      raw: callbackPayload,
      headers: { 'x-sim-signature': sig },
      exactly_once_key: `cb-key-001-xxxxxx`,
      idempotency_key: `idem-key-001-xxxx`,
    });
    expect(cbResult.status).toBe(201);
    const cbBody = cbResult.body as Record<string, unknown>;
    expect(cbBody['verification_result']).toBe('VERIFIED');
    expect(cbBody['financial_effect_applied']).toBe(true);
    expect(cbBody['signature_verified']).toBe(true);
    expect(cbBody['duplicate_financial_effect_forbidden']).toBe(true);
    // intent should now be CAPTURED
    const state = repo.tenant(TENANT_A);
    const intent = state.intents.get(paymentIntentId);
    expect(intent?.status).toBe('CAPTURED');
  });

  it('duplicate callback returns prior result with zero second financial effect (SF-PAY-002)', async () => {
    const { service, repo } = makeService();
    const ctx = ctxFor(TENANT_A);
    const intentResult = await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      fixtureIdem(['test', 'dup', '002'], 'g'),
    );
    const intentBody = intentResult.body as Record<string, unknown>;
    const paymentIntentId = String(intentBody['payment_intent_id']);
    const callbackPayload = { payment_intent_id: paymentIntentId, outcome: 'CAPTURED' };
    const sig = signPayload(simulatorSecret(TEST_RUN_ID), callbackPayload);
    const cbCtx = ctxFor(TENANT_A, '77777777-7777-4777-8777-777777777777', 'INTEGRATION');
    const exactly_once_key = 'dup-key-exact-001';
    const first = await service.applyCallback(cbCtx, {
      raw: callbackPayload,
      headers: { 'x-sim-signature': sig },
      exactly_once_key,
      idempotency_key: fixtureToken('idem', 'dup', '001', 'xxx'),
    });
    const second = await service.applyCallback(cbCtx, {
      raw: callbackPayload,
      headers: { 'x-sim-signature': sig },
      exactly_once_key,
      idempotency_key: fixtureToken('idem', 'dup', '002', 'xxx'),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    // exactly once effect: only one effect claimed
    expect(repo.tenant(TENANT_A).exactlyOnceEffects.size).toBe(1);
  });

  it('REJECTED callback: no financial effect when signature fails', async () => {
    const { service, repo } = makeService();
    const ctx = ctxFor(TENANT_A);
    const intentResult = await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      fixtureIdem(['test', 'rej', '002'], 'h'),
    );
    const intentBody = intentResult.body as Record<string, unknown>;
    const paymentIntentId = String(intentBody['payment_intent_id']);
    // Wrong signature → rejected, no financial effect
    const cbCtx = ctxFor(TENANT_A, '77777777-7777-4777-8777-777777777777', 'INTEGRATION');
    const cbResult = await service.applyCallback(cbCtx, {
      raw: { payment_intent_id: paymentIntentId, outcome: 'CAPTURED' },
      headers: { 'x-sim-signature': 'wrong-signature-value' },
      exactly_once_key: fixtureToken('rej', 'once', 'exact', '001'),
      idempotency_key: fixtureToken('idem', 'rej', '001', 'xxxxx'),
    });
    expect(cbResult.status).toBe(201);
    const cbBody = cbResult.body as Record<string, unknown>;
    expect(cbBody['verification_result']).toBe('REJECTED');
    expect(cbBody['financial_effect_applied']).toBe(false);
    expect(cbBody['signature_verified']).toBe(false);
    // intent should still be CREATED (no status change on rejected)
    const state = repo.tenant(TENANT_A);
    const intent = state.intents.get(paymentIntentId);
    expect(intent?.status).toBe('CREATED');
  });
});

describe('getIntent', () => {
  it('returns 404 for unknown intent', async () => {
    const { service } = makeService();
    const ctx = ctxFor(TENANT_A);
    await expect(service.getIntent(ctx, '00000000-0000-4000-8000-000000000099')).rejects.toThrow(
      Cmp021Error,
    );
  });

  it('returns stored intent after create', async () => {
    const { service } = makeService();
    const ctx = ctxFor(TENANT_A);
    const created = await service.createIntent(
      ctx,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      fixtureIdem(['test', 'get', '001'], 'i'),
    );
    const intentId = String((created.body as Record<string, unknown>)['payment_intent_id']);
    const found = await service.getIntent(ctx, intentId);
    expect(found.status).toBe(200);
    expect((found.body as Record<string, unknown>)['payment_intent_id']).toBe(intentId);
  });
});

describe('INT-013 fail-closed', () => {
  it('fails closed when connector binding port is unbound', async () => {
    const repo = new MemoryPaymentRepository();
    const service = buildPaymentService({
      repository: repo,
      authorizer: new AllowAllAuthorizer(),
      runtimeEnvironment: 'LOCAL',
    });
    const ctx = ctxFor(TENANT_A);
    await expect(
      service.createIntent(
        ctx,
        { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
        fixtureIdem(['test', 'unbound', '001'], 'j'),
      ),
    ).rejects.toThrow(Cmp021Error);
  });
});
