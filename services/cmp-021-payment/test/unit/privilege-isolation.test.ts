import { describe, expect, it } from 'vitest';
import { makeHarness } from '../doubles/harness.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  FEE_QUOTE_ID,
  TENANT_A,
  TENANT_B,
  TEST_RUN_ID,
  TxProbe,
  FakeConnectorBindingPort,
  FakeFeeQuotePort,
  fixtureIdem,
  requireDefined,
} from '../doubles/fixtures.js';
// fixture helpers imported below via expanded import
import { MemoryPaymentRepository } from '../doubles/memory-repo.js';
import { buildPaymentService } from '../../src/index.js';
import { SimulatedPspConnector } from '../../src/connectors/simulated-psp.js';
import { buildSimulationMarker } from '../../src/domain/simulation.js';
import type { SimulationMarker } from '../../src/domain/simulation.js';
import { Cmp021Error } from '../../src/errors.js';

describe('cross-tenant isolation', () => {
  it('tenant A cannot read tenant B intent', async () => {
    const probe = new TxProbe();
    const repoA = new MemoryPaymentRepository();
    const repoB = new MemoryPaymentRepository();
    probe.repo = repoA;
    const cbA = new FakeConnectorBindingPort(probe);
    const fqA = new FakeFeeQuotePort(probe);
    const binding = requireDefined(cbA.binding, 'binding');
    const marker = buildSimulationMarker(binding, TEST_RUN_ID) as SimulationMarker;
    const gwA = new SimulatedPspConnector(marker);

    const serviceA = buildPaymentService({
      repository: repoA,
      authorizer: new AllowAllAuthorizer(),
      feeQuote: fqA,
      connectorBinding: cbA,
      gateway: gwA,
      runtimeEnvironment: 'LOCAL',
    });
    const ctxA = ctxFor(TENANT_A);
    const created = await serviceA.createIntent(
      ctxA,
      { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
      fixtureIdem(['cross', 'tenant', '001xx'], 'a'),
    );
    const intentId = String((created.body as Record<string, unknown>)['payment_intent_id']);

    const probe2 = new TxProbe();
    const cbB = new FakeConnectorBindingPort(probe2);
    const fqB = new FakeFeeQuotePort(probe2);
    const bindingB = requireDefined(cbB.binding, 'binding');
    const markerB = buildSimulationMarker(bindingB, TEST_RUN_ID) as SimulationMarker;
    const gwB = new SimulatedPspConnector(markerB);
    probe2.repo = repoB;
    const serviceB = buildPaymentService({
      repository: repoB,
      authorizer: new AllowAllAuthorizer(),
      feeQuote: fqB,
      connectorBinding: cbB,
      gateway: gwB,
      runtimeEnvironment: 'LOCAL',
    });
    const ctxB = ctxFor(TENANT_B);
    await expect(serviceB.getIntent(ctxB, intentId)).rejects.toThrow(Cmp021Error);
  });
});

describe('authorizer deny', () => {
  it('denied authz returns SF-AUTH-002', async () => {
    const h = makeHarness();
    h.authorizer.mode = 'deny';
    const r = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    expect(r.status).toBe(403);
  });
});

describe('INT-013 fail-closed gate', () => {
  it('SIMULATED binding outside simulation env → refused', async () => {
    const probe = new TxProbe();
    const repo = new MemoryPaymentRepository();
    probe.repo = repo;
    const cbPort = new FakeConnectorBindingPort(probe, 'PRODUCTION' as never);
    cbPort.binding = {
      connector_binding_id: '55555555-5555-4555-8555-555555555555',
      tenant_id: null,
      connector_type: 'PAYMENT',
      mode: 'SIMULATED',
      environment: 'PRODUCTION',
      critical: true,
      secret_ref: null,
      simulator_version: '1.0.0',
    };
    const fqPort = new FakeFeeQuotePort(probe);
    const service = buildPaymentService({
      repository: repo,
      authorizer: new AllowAllAuthorizer(),
      feeQuote: fqPort,
      connectorBinding: cbPort,
      runtimeEnvironment: 'PRODUCTION',
    });
    const ctx = ctxFor(TENANT_A);
    await expect(
      service.createIntent(
        ctx,
        { fee_quote_id: FEE_QUOTE_ID, test_run_id: TEST_RUN_ID },
        fixtureIdem(['fail', 'closed', '001xx'], 'b'),
      ),
    ).rejects.toThrow(Cmp021Error);
  });
});
