import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotRegistry } from '@serviceform/outbox';

const mocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === 'ROLLBACK') return { rowCount: 0 };
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };
  return { client, pool };
});

vi.mock('pg', () => ({
  default: {
    Pool: class {
      connect = mocks.pool.connect;
      end = mocks.pool.end;
    },
  },
}));

import { loadTopicsFile, main } from '../../src/registry/sync.js';

describe('registry sync CLI helpers', () => {
  beforeEach(() => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sf_event_bus.event_schema')) return { rows: [], rowCount: 0 };
      if (sql === 'ROLLBACK') throw new Error('already rolled back');
      return { rowCount: 1, rows: [] };
    });
  });

  it('loads the shipped topics file', () => {
    const topics = loadTopicsFile();
    expect(topics).toEqual(snapshotRegistry().allTopics());
  });

  it('commits a registry sync', async () => {
    await main();
    expect(mocks.client.query).toHaveBeenCalledWith('COMMIT');
    expect(mocks.pool.end).toHaveBeenCalled();
  });

  it('rolls back when sync fails', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return { rowCount: 0 };
      if (sql === 'ROLLBACK') return { rowCount: 0 };
      throw new Error('sync-fail');
    });
    await expect(main()).rejects.toThrow(/sync-fail/);
    expect(mocks.client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
