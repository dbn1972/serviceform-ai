import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '../src/testing/in-memory-transport.js';
import { assertSimulatedTransportAllowed } from '../src/transport/types.js';

describe('in-memory transport (U8, U9, 004-23)', () => {
  it('refuses SIMULATED unless SF_ENVIRONMENT is an exact D-04 value', () => {
    expect(() => assertSimulatedTransportAllowed(undefined)).toThrow(/refused/);
    expect(() => assertSimulatedTransportAllowed('')).toThrow(/refused/);
    expect(() => assertSimulatedTransportAllowed('PRODUCTION')).toThrow(/refused/);
    expect(() => assertSimulatedTransportAllowed('UAT')).toThrow(/refused/);
    expect(() => assertSimulatedTransportAllowed('PREPROD')).toThrow(/refused/);
    expect(() => assertSimulatedTransportAllowed('production')).toThrow(/refused/);
    expect(() => assertSimulatedTransportAllowed(' PRODUCTION')).toThrow(/refused/);
    expect(() => new InMemoryTransport({ environment: 'PRODUCTION' })).toThrow(/refused/);
    expect(() => assertSimulatedTransportAllowed('CI')).not.toThrow();
  });

  it('down() makes publish retryable and up() restores', async () => {
    const t = new InMemoryTransport({ environment: 'CI' });
    t.down();
    const down = await t.publish(
      [{ topic: 'sf.example.events', key: 'k', value: '{}', headers: {} }],
      { timeoutMs: 1000 },
    );
    expect(down[0]?.kind).toBe('retryable');
    t.up();
    const up = await t.publish(
      [{ topic: 'sf.example.events', key: 'k', value: '{}', headers: {} }],
      { timeoutMs: 1000 },
    );
    expect(up[0]?.kind).toBe('ok');
  });
});
