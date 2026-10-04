import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { discoverOutboxTables, qualified } from '../src/publisher/discovery.js';

describe('discoverOutboxTables', () => {
  it('keeps allowlisted outbox tables and skips views and other names', async () => {
    const client = {
      query: async () => ({
        rows: [
          { schema: 'sf_event_bus', table: 'outbox_event', relkind: 'r' },
          { schema: 'sf_event_bus', table: 'outbox_event_platform', relkind: 'p' },
          { schema: 'sf_event_bus', table: 'outbox_event', relkind: 'v' },
          { schema: 'other', table: 'outbox_event', relkind: 'r' },
          { schema: 'sf_event_bus', table: 'orders', relkind: 'r' },
        ],
      }),
    } as unknown as pg.PoolClient;
    const found = await discoverOutboxTables(client, ['sf_event_bus']);
    expect(found).toEqual([
      { schema: 'sf_event_bus', table: 'outbox_event' },
      { schema: 'sf_event_bus', table: 'outbox_event_platform' },
    ]);
    const all = await discoverOutboxTables(client);
    expect(all.some((t) => t.schema === 'other')).toBe(true);
    expect(qualified('sf_event_bus', 'outbox_event')).toBe('"sf_event_bus"."outbox_event"');
  });
});
