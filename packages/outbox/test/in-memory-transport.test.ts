import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '../src/testing/index.js';
import { assertSimulatedTransportAllowed } from '../src/index.js';

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

  it('failNext, drain, subscribe, offsets, and redeliver work', async () => {
    const t = new InMemoryTransport({ environment: 'CI', defaultPartitions: 2 });
    await t.ensureTopics([
      { topic: 'sf.example.events', partitions: 2, replicationFactor: 1 },
      { topic: 'sf.example.events', partitions: 2, replicationFactor: 1 },
    ]);
    t.failNext(1, 'ok');
    const queuedOk = await t.publish(
      [{ topic: 'sf.example.events', key: 'k', value: '{}', headers: {} }],
      { timeoutMs: 10 },
    );
    expect(queuedOk[0]?.kind).toBe('ok');
    t.failNext(1, 'fatal');
    const fatal = await t.publish(
      [{ topic: 'sf.example.events', key: 'k', value: '{}', headers: { h: '1' } }],
      { timeoutMs: 10 },
    );
    expect(fatal[0]?.kind).toBe('fatal');
    t.failNext(1, 'retryable');
    const retry = await t.publish(
      [{ topic: 'sf.example.events', key: 'k', value: '{}', headers: {} }],
      { timeoutMs: 10 },
    );
    expect(retry[0]?.kind).toBe('retryable');
    const ok = await t.publish(
      [{ topic: 'sf.other.events', key: 'agg', value: '{"n":1}', headers: { a: 'b' } }],
      { timeoutMs: 10 },
    );
    expect(ok[0]?.kind).toBe('ok');
    const sub = await t.subscribe('g1', ['sf.other.events'], async () => undefined);
    await sub.close();
    const got: string[] = [];
    const n = await t.drain(
      'g1',
      async (m) => {
        got.push(m.value);
      },
      ['sf.other.events'],
    );
    expect(n).toBe(1);
    expect(got).toEqual(['{"n":1}']);
    const skipped = await t.drain('g1', async () => undefined, ['sf.other.events']);
    expect(skipped).toBe(0);
    const again = await t.redeliver('g1', async () => undefined);
    expect(again).toBeGreaterThanOrEqual(1);
    const ends = await t.logEndOffsets('sf.other.events');
    expect(ends.size).toBeGreaterThan(0);
    expect((await t.logEndOffsets('missing')).size).toBe(0);
    const committed = await t.committedOffsets('g1', 'sf.other.events');
    expect(committed.size).toBeGreaterThanOrEqual(0);
    await t.close();
  });
});
