import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  claimBatch,
  discardDeadLetter,
  markDeadLettered,
  markPublished,
  purgePublished,
  replayDeadLetter,
  scheduleRetry,
} from '../src/publisher/claim.js';

function client(rows: unknown[], rowCount = rows.length): pg.PoolClient {
  return {
    query: async () => ({ rows, rowCount }),
  } as unknown as pg.PoolClient;
}

describe('claim SQL helpers', () => {
  it('maps claimed rows and no-ops empty publish marks', async () => {
    const claimed = await claimBatch(
      client([{ seq: 9, event_id: 'e', topic: 't', partition_key: 'k' }]),
      'sf_event_bus',
      'outbox_event',
      'w',
      8,
      1000,
    );
    expect(claimed[0]?.seq).toBe('9');
    expect(claimed[0]?.schema).toBe('sf_event_bus');
    expect(await markPublished(client([], 0), 'sf_event_bus', 'outbox_event', [], 'w')).toBe(0);
    expect(await markPublished(client([], 2), 'sf_event_bus', 'outbox_event', ['1'], 'w')).toBe(2);
    expect(
      await scheduleRetry(client([], 1), 'sf_event_bus', 'outbox_event', '1', 'w', 'X', 10),
    ).toBe(1);
    expect(
      await markDeadLettered(client([], 1), 'sf_event_bus', 'outbox_event', '1', 'w', 'X'),
    ).toBe(1);
    expect(
      await purgePublished(client([], 3), 'sf_event_bus', 'outbox_event', 't', '7 days', 10),
    ).toBe(3);
    expect(await replayDeadLetter(client([], 1), 'sf_event_bus', 'outbox_event', '1')).toBe(1);
    expect(await discardDeadLetter(client([], 1), 'sf_event_bus', 'outbox_event', '1')).toBe(1);
  });
});
