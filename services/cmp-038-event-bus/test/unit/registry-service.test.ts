import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { snapshotRegistry } from '@serviceform/outbox';
import { syncRegistry } from '../../src/registry/service.js';

describe('syncRegistry', () => {
  it('inserts topics, skips existing schema versions, and adds the next version', async () => {
    const example = snapshotRegistry().getTopic('sf.example.events');
    if (!example) throw new Error('missing topic');
    const sqls: string[] = [];
    const client = {
      query: async (sql: string) => {
        sqls.push(sql);
        if (sql.includes('FROM sf_event_bus.event_schema')) {
          return {
            rows: [
              {
                event_type: 'ExampleAggregateCreated',
                schema_version: 1,
                data_schema: example.schemas[0]?.data_schema,
              },
            ],
          };
        }
        return { rowCount: 1 };
      },
    } as unknown as pg.PoolClient;
    await syncRegistry(client, [
      {
        ...example,
        schemas: [
          ...example.schemas,
          {
            event_type: 'ExampleAggregateCreated',
            schema_version: 1,
            data_schema: { type: 'object', additionalProperties: true },
          },
        ],
      },
    ]);
    await syncRegistry(client, [
      {
        ...example,
        schemas: [
          {
            event_type: 'ExampleAggregateCreated',
            schema_version: 2,
            data_schema: {
              type: 'object',
              properties: { extra: { type: 'string' } },
              additionalProperties: true,
            },
          },
        ],
      },
    ]);
    expect(sqls.some((s) => s.includes('INSERT INTO sf_event_bus.topic'))).toBe(true);
  });

  it('inserts the first schema version and refuses incompatible or skipped versions', async () => {
    const example = snapshotRegistry().getTopic('sf.example.events');
    if (!example) throw new Error('missing topic');
    const empty = {
      query: async (sql: string) => {
        if (sql.includes('FROM sf_event_bus.event_schema')) return { rows: [] };
        return { rowCount: 1 };
      },
    } as unknown as pg.PoolClient;
    await syncRegistry(empty, [example]);

    const existing = {
      query: async (sql: string) => {
        if (sql.includes('FROM sf_event_bus.event_schema')) {
          return {
            rows: [
              {
                event_type: 'ExampleAggregateCreated',
                schema_version: 1,
                data_schema: example.schemas[0]?.data_schema,
              },
            ],
          };
        }
        return { rowCount: 1 };
      },
    } as unknown as pg.PoolClient;
    await expect(
      syncRegistry(existing, [
        {
          ...example,
          schemas: [
            {
              event_type: 'ExampleAggregateCreated',
              schema_version: 3,
              data_schema: { type: 'object', additionalProperties: true },
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      syncRegistry(existing, [
        {
          ...example,
          schemas: [
            {
              event_type: 'ExampleAggregateCreated',
              schema_version: 2,
              data_schema: {
                type: 'object',
                required: ['must'],
                properties: { must: { type: 'string' } },
              },
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });
});
