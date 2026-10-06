import { Cmp028Error, detail } from './errors.js';

export interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

export interface SqlQueryable {
  query<R = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface SqlClient extends SqlQueryable {
  release(): void;
}

/** Structurally satisfied by pg.Pool. The component never imports a driver directly. */
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

const OWN_SCHEMAS: readonly string[] = ['sf_appeal', 'sf_platform'];
const SCHEMA_QUALIFIER = /\b(sf_[a-z0-9_]+)\s*\./gi;

/**
 * Constitution #23 / ADR-0006: CMP-028 SQL may only name its own schema (and the shared session
 * accessor schema). Original case tables are reached only through the CMP-015 command port.
 */
export function assertOwnSchemaSql(text: string): void {
  for (const match of text.matchAll(SCHEMA_QUALIFIER)) {
    const schema = (match[1] ?? '').toLowerCase();
    if (!OWN_SCHEMAS.includes(schema)) {
      throw new Cmp028Error('SF-SYS-001', detail('CROSS_COMPONENT_SQL_FORBIDDEN'));
    }
  }
}

export function guardClient(client: SqlClient): SqlClient {
  return {
    query: async (text, values) => {
      assertOwnSchemaSql(text);
      return await client.query(text, values);
    },
    release: () => client.release(),
  };
}
