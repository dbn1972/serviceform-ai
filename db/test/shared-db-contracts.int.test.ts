import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DIR, migrate, withClient } from './helpers.js';

/**
 * SF-CON-OUTBOX and SF-CON-DB-SESSION-CONTEXT: the normative outbox template, rendered into a
 * throwaway schema, enforces producer/publisher separation and tenant isolation.
 */
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'sf_outbox_contract';
const template = readFileSync(
  join(DB_DIR, '..', 'contracts/shared/sql/outbox.template.sql'),
  'utf8',
)
  .replaceAll('{schema}', SCHEMA)
  .replaceAll('{cmp}', 'CMP-038');

function envelope(tenant: string | null, id: string) {
  return {
    event_id: id,
    event_type: 'ExampleAggregateCreated',
    schema_version: 1,
    tenant_id: tenant,
    cell_id: 'cell-01',
    aggregate_type: 'ExampleAggregate',
    aggregate_id: id,
    aggregate_version: 1,
    occurred_at: '2026-10-03T09:00:00Z',
    correlation_id: id,
    actor: { type: 'SYSTEM', id },
    data: {},
  };
}

type Q = (sql: string, p?: unknown[]) => Promise<pg.QueryResult>;

const SET_ROLE = {
  sf_app: 'SET LOCAL ROLE sf_app',
  sf_outbox_publisher: 'SET LOCAL ROLE sf_outbox_publisher',
} as const;

async function as(
  role: keyof typeof SET_ROLE,
  tenant: string | null,
  fn: (q: Q) => Promise<unknown>,
) {
  return withClient(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(SET_ROLE[role]);
      if (tenant) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      const out = await fn((sql, p) => c.query(sql, p));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

function insertEvent(q: Q, tenant: string) {
  const id = crypto.randomUUID();
  return q(
    `INSERT INTO sf_outbox_contract.outbox_event (event_id, tenant_id, topic, partition_key, event_type,
       schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)
     VALUES ($1::uuid, $2, 'sf.example.events', $1::text, 'ExampleAggregateCreated', 1, 'ExampleAggregate', $1::uuid, 1, $3)`,
    [id, tenant, JSON.stringify(envelope(tenant, id))],
  );
}

describe('shared DB contracts (REQ: SF-CON-OUTBOX, SF-CON-DB-SESSION-CONTEXT; TI v1.0 s8, s13)', () => {
  beforeAll(async () => {
    migrate('up');
    await withClient((c) =>
      c.query(
        'DROP SCHEMA IF EXISTS sf_outbox_contract CASCADE; CREATE SCHEMA sf_outbox_contract;' +
          ' GRANT USAGE ON SCHEMA sf_outbox_contract TO sf_app;' +
          template,
      ),
    );
  });

  afterAll(async () => {
    await withClient((c) => c.query(`DROP SCHEMA IF EXISTS sf_outbox_contract CASCADE`));
  });

  it('lets a producer insert an event for its own tenant only', async () => {
    await as('sf_app', T1, (q) => insertEvent(q, T1));
    await expect(as('sf_app', T1, (q) => insertEvent(q, T2))).rejects.toThrow(/row-level security/);
    await expect(as('sf_app', null, (q) => insertEvent(q, T1))).rejects.toThrow(
      /row-level security/,
    );
  });

  it('refuses an envelope whose tenant differs from the row', async () => {
    const id = crypto.randomUUID();
    await expect(
      as('sf_app', T1, (q) =>
        q(
          `INSERT INTO sf_outbox_contract.outbox_event (event_id, tenant_id, topic, partition_key, event_type,
             schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)
           VALUES ($1::uuid, $2, 'sf.example.events', $1::text, 'ExampleAggregateCreated', 1, 'ExampleAggregate', $1::uuid, 1, $3)`,
          [id, T1, JSON.stringify(envelope(T2, id))],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('gives producers no read or update access to the outbox', async () => {
    await expect(
      as('sf_app', T1, (q) => q(`SELECT * FROM sf_outbox_contract.outbox_event`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as('sf_app', T1, (q) => q(`UPDATE sf_outbox_contract.outbox_event SET status = 'PUBLISHED'`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets the publisher read all tenants and mark rows, but not rewrite events', async () => {
    await as('sf_app', T2, (q) => insertEvent(q, T2));
    const rows = (await as('sf_outbox_publisher', null, (q) =>
      q(`SELECT DISTINCT tenant_id FROM sf_outbox_contract.outbox_event`),
    )) as pg.QueryResult;
    expect(rows.rows.map((r) => r['tenant_id']).sort()).toEqual([T1, T2]);
    await as('sf_outbox_publisher', null, (q) =>
      q(`UPDATE sf_outbox_contract.outbox_event SET status = 'PUBLISHED', published_at = now()`),
    );
    await expect(
      as('sf_outbox_publisher', null, (q) =>
        q(`UPDATE sf_outbox_contract.outbox_event SET envelope = '{}'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(as('sf_outbox_publisher', null, (q) => insertEvent(q, T1))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('routes null-tenant events to the platform outbox only', async () => {
    const id = crypto.randomUUID();
    await as('sf_app', null, (q) =>
      q(
        `INSERT INTO sf_outbox_contract.outbox_event_platform (event_id, topic, partition_key, event_type,
           schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)
         VALUES ($1::uuid, 'sf.example.platform', $1::text, 'ExampleAggregateCreated', 1, 'ExampleAggregate', $1::uuid, 1, $2)`,
        [id, JSON.stringify(envelope(null, id))],
      ),
    );
    const other = crypto.randomUUID();
    await expect(
      as('sf_app', null, (q) =>
        q(
          `INSERT INTO sf_outbox_contract.outbox_event_platform (event_id, topic, partition_key, event_type,
             schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)
           VALUES ($1::uuid, 'sf.example.platform', $1::text, 'ExampleAggregateCreated', 1, 'ExampleAggregate', $1::uuid, 1, $2)`,
          [other, JSON.stringify(envelope(T1, other))],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('detects a duplicate delivery through the consumer inbox', async () => {
    const id = crypto.randomUUID();
    const record = (q: Q) =>
      q(
        `INSERT INTO sf_outbox_contract.inbox_event (consumer_group, event_id, tenant_id) VALUES ('example-consumer', $1, $2)
         ON CONFLICT DO NOTHING`,
        [id, T1],
      );
    expect(((await as('sf_app', T1, record)) as pg.QueryResult).rowCount).toBe(1);
    expect(((await as('sf_app', T1, record)) as pg.QueryResult).rowCount).toBe(0);
    const seen = (await as('sf_app', T2, (q) =>
      q(`SELECT * FROM sf_outbox_contract.inbox_event`),
    )) as pg.QueryResult;
    expect(seen.rows).toEqual([]);
  });
});
