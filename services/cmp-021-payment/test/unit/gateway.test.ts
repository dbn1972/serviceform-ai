import { describe, expect, it } from 'vitest';
import {
  SimulatedPspConnector,
  signPayload,
  simulatorSecret,
} from '../../src/connectors/simulated-psp.js';
import { TEST_RUN_ID, simulatedBinding } from '../doubles/fixtures.js';
import { buildSimulationMarker } from '../../src/domain/simulation.js';
import type { SimulationMarker } from '../../src/domain/simulation.js';

function makeConnector(): SimulatedPspConnector {
  const binding = simulatedBinding();
  const marker = buildSimulationMarker(binding, TEST_RUN_ID) as SimulationMarker;
  return new SimulatedPspConnector(marker);
}

describe('SimulatedPspConnector', () => {
  it('createSession returns CREATED status with sim refs', async () => {
    const connector = makeConnector();
    const result = await connector.createSession({
      paymentIntentId: '00000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-a',
      applicationId: 'app-a',
      feeQuoteId: 'quote-a',
      amountMinor: 1000n,
      currency: 'XTS',
      idempotencyKey: 'idem-key-001',
      simulationMarker: connector.simulation,
    });
    expect(result.initialStatus).toBe('CREATED');
    expect(result.pspSessionRef).toContain('sim:');
    expect(result.pspRedirectUrl).toContain('simulator.local');
  });

  it('verifyCallback with valid HMAC returns verified=true', async () => {
    const connector = makeConnector();
    const payload = {
      payment_intent_id: '00000000-0000-4000-8000-000000000001',
      outcome: 'CAPTURED',
    };
    const secret = simulatorSecret(TEST_RUN_ID);
    const sig = signPayload(secret, payload);
    const result = await connector.verifyCallback({
      raw: payload,
      headers: { 'x-sim-signature': sig },
    });
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('CAPTURED');
    expect(result.paymentIntentId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('verifyCallback with wrong HMAC returns verified=false', async () => {
    const connector = makeConnector();
    const payload = {
      payment_intent_id: '00000000-0000-4000-8000-000000000001',
      outcome: 'CAPTURED',
    };
    const result = await connector.verifyCallback({
      raw: payload,
      headers: { 'x-sim-signature': 'wrong-signature' },
    });
    expect(result.verified).toBe(false);
  });

  it('verifyCallback without signature returns verified=false', async () => {
    const connector = makeConnector();
    const payload = {
      payment_intent_id: '00000000-0000-4000-8000-000000000001',
      outcome: 'CAPTURED',
    };
    const result = await connector.verifyCallback({ raw: payload, headers: {} });
    expect(result.verified).toBe(false);
  });

  it('FAILED outcome passes through', async () => {
    const connector = makeConnector();
    const payload = {
      payment_intent_id: '00000000-0000-4000-8000-000000000001',
      outcome: 'FAILED',
    };
    const secret = simulatorSecret(TEST_RUN_ID);
    const sig = signPayload(secret, payload);
    const result = await connector.verifyCallback({
      raw: payload,
      headers: { 'x-sim-signature': sig },
    });
    expect(result.outcome).toBe('FAILED');
  });
});
