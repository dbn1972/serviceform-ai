import type pg from 'pg';
import { quoteIdentRaw } from '../identifiers.js';
import { OUTBOX_TABLE, OUTBOX_TABLE_PLATFORM } from '../sql.js';

export interface DiscoveredTable {
  schema: string;
  table: typeof OUTBOX_TABLE | typeof OUTBOX_TABLE_PLATFORM;
}

export async function discoverOutboxTables(
  client: pg.PoolClient,
  allowlist?: readonly string[],
): Promise<DiscoveredTable[]> {
  const result = await client.query<{ schema: string; table: string; relkind: string }>(
    `SELECT n.nspname AS schema, c.relname AS table, c.relkind::text AS relkind
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND c.relname IN ('outbox_event', 'outbox_event_platform')
       AND has_table_privilege(c.oid, 'SELECT,UPDATE')`,
  );
  const out: DiscoveredTable[] = [];
  for (const row of result.rows) {
    if (row.relkind !== 'r' && row.relkind !== 'p') continue;
    if (allowlist && !allowlist.includes(row.schema)) continue;
    if (row.table === OUTBOX_TABLE || row.table === OUTBOX_TABLE_PLATFORM) {
      out.push({ schema: row.schema, table: row.table });
    }
  }
  return out;
}

export function qualified(schema: string, table: string): string {
  return quoteIdentRaw(schema) + '.' + quoteIdentRaw(table);
}
