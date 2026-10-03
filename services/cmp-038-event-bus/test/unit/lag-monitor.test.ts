import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { recordLag } from '../../src/lag/lag-monitor.js';
import { InMemoryTransport } from '@serviceform/outbox/testing';

function pool(onQuery?: (sql: string, params: unknown[]) => void): pg.Pool {
  return {
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        onQuery?.(sql, params ?? []);
        return { rowCount: 1 };
      },
      release: () => undefined,
    }),
  } as unknown as pg.Pool;
}

describe('recordLag', () => {
  it('writes checkpoints for partitions with and without committed offsets', async () => {
    const transport = new InMemoryTransport({ environment: 'CI' });
    await transport.ensureTopics([
      { topic: 'sf.example.events', partitions: 2, replicationFactor: 1 },
    ]);
    await transport.publish(
      [
        { topic: 'sf.example.events', key: 'a', value: '{}', headers: {} },
        { topic: 'sf.example.events', key: 'b', value: '{}', headers: {} },
      ],
      { timeoutMs: 10 },
    );
    await transport.drain('g1', async () => undefined, ['sf.example.events']);
    const sqls: string[] = [];
    await recordLag(
      pool((sql) => sqls.push(sql)),
      transport,
      'sf.example.events',
      'g1',
    );
    expect(sqls.some((s) => s.includes('consumer_checkpoint'))).toBe(true);
    await recordLag(pool(), transport, 'sf.example.events', 'missing-group');
  });
});
