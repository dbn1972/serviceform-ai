import type { ActorType, EventEnvelope } from '../domain/validate.js';
import type { Facets } from '../domain/document.js';
import { mapPgError } from '../errors.js';
import type {
  DbSession,
  DocumentQuery,
  DocumentStatus,
  DocumentUpdate,
  SearchDocumentRow,
  SearchStore,
  SearchTx,
} from './types.js';

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  release(err?: Error | boolean): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

export const SCHEMA = 'sf_search';

const D_COLS = [
  'document_id',
  'tenant_id',
  'cell_id',
  'source_cmp_id',
  'source_record_id',
  'source_aggregate_type',
  'source_topic',
  'source_version',
  'source_event_id',
  'source_event_type',
  'source_occurred_at',
  'projection_rule_id',
  'projection_rule_version',
  'facets',
  'status',
  'revision',
  'indexed_at',
  'updated_at',
  'last_correlation_id',
] as const;

const INSERT_VALUES = D_COLS.map((c, i) => (c === 'facets' ? `$${i + 1}::jsonb` : `$${i + 1}`));

const SELECT_D = `SELECT ${D_COLS.join(',')} FROM sf_search.search_document`;

export const SQL = {
  insertInbox: `INSERT INTO sf_search.inbox_event (consumer_group, event_id, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer_group, event_id) DO NOTHING`,
  insertD: `INSERT INTO sf_search.search_document (${D_COLS.join(',')}) VALUES (${INSERT_VALUES.join(',')})`,
  selectBySource: `${SELECT_D} WHERE tenant_id = $1 AND source_cmp_id = $2 AND source_record_id = $3`,
  selectById: `${SELECT_D} WHERE tenant_id = $1 AND document_id = $2`,
  updateD: `UPDATE sf_search.search_document
          SET source_version = $1, source_event_id = $2, source_event_type = $3,
              source_occurred_at = $4, projection_rule_id = $5, projection_rule_version = $6,
              facets = $7::jsonb, status = $8, revision = revision + 1, updated_at = $9,
              last_correlation_id = $10
        WHERE tenant_id = $11 AND document_id = $12 AND revision = $13 AND source_version = $14`,
  query: `${SELECT_D}
        WHERE tenant_id = $1
          AND status = 'ACTIVE'
          AND ($2::text IS NULL OR source_cmp_id = $2)
          AND facets @> $3::jsonb
          AND ($4::uuid IS NULL OR document_id > $4::uuid)
        ORDER BY document_id
        LIMIT $5`,
  insertOutbox: `INSERT INTO sf_search.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version,
         aggregate_type, aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
} as const;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function str(value: unknown): string {
  return String(value);
}

function facetsOf(value: unknown): Facets {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return (parsed ?? {}) as Facets;
}

export function documentFromRow(r: Record<string, unknown>): SearchDocumentRow {
  return {
    document_id: str(r['document_id']),
    tenant_id: str(r['tenant_id']),
    cell_id: str(r['cell_id']),
    source_cmp_id: str(r['source_cmp_id']),
    source_record_id: str(r['source_record_id']),
    source_aggregate_type: str(r['source_aggregate_type']),
    source_topic: str(r['source_topic']),
    source_version: Number(r['source_version']),
    source_event_id: str(r['source_event_id']),
    source_event_type: str(r['source_event_type']),
    source_occurred_at: iso(r['source_occurred_at']),
    projection_rule_id: str(r['projection_rule_id']),
    projection_rule_version: Number(r['projection_rule_version']),
    facets: facetsOf(r['facets']),
    status: str(r['status']) as DocumentStatus,
    revision: Number(r['revision']),
    indexed_at: iso(r['indexed_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: str(r['last_correlation_id']),
  };
}

class PgTx implements SearchTx {
  constructor(
    private readonly client: SqlClient,
    private readonly tenantId: string,
  ) {}

  async recordInbox(consumerGroup: string, eventId: string): Promise<boolean> {
    const r = await this.client.query(SQL.insertInbox, [consumerGroup, eventId, this.tenantId]);
    return (r.rowCount ?? 0) === 1;
  }

  async getDocumentBySource(
    sourceCmpId: string,
    sourceRecordId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<SearchDocumentRow | null> {
    const sql = opts.forUpdate ? `${SQL.selectBySource} FOR UPDATE` : SQL.selectBySource;
    const { rows } = await this.client.query(sql, [this.tenantId, sourceCmpId, sourceRecordId]);
    return rows[0] ? documentFromRow(rows[0]) : null;
  }

  async getDocument(documentId: string): Promise<SearchDocumentRow | null> {
    const { rows } = await this.client.query(SQL.selectById, [this.tenantId, documentId]);
    return rows[0] ? documentFromRow(rows[0]) : null;
  }

  async insertDocument(row: SearchDocumentRow): Promise<void> {
    await this.client.query(
      SQL.insertD,
      D_COLS.map((c) => (c === 'facets' ? JSON.stringify(row.facets) : row[c])),
    );
  }

  async updateDocument(u: DocumentUpdate): Promise<boolean> {
    const res = await this.client.query(SQL.updateD, [
      u.sourceVersion,
      u.sourceEventId,
      u.sourceEventType,
      u.sourceOccurredAt,
      u.projectionRuleId,
      u.projectionRuleVersion,
      JSON.stringify(u.facets),
      u.status,
      u.updatedAt,
      u.correlationId,
      this.tenantId,
      u.documentId,
      u.fromRevision,
      u.fromSourceVersion,
    ]);
    return (res.rowCount ?? 0) === 1;
  }

  async queryDocuments(q: DocumentQuery): Promise<SearchDocumentRow[]> {
    const { rows } = await this.client.query(SQL.query, [
      this.tenantId,
      q.sourceCmpId,
      JSON.stringify(q.facets),
      q.after,
      q.limit,
    ]);
    return rows.map(documentFromRow);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    const partitionKey =
      topic === 'sf.audit.ingest.v1'
        ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
        : envelope.aggregate_id;
    await this.client.query(SQL.insertOutbox, [
      envelope.event_id,
      envelope.tenant_id,
      topic,
      partitionKey,
      envelope.event_type,
      envelope.schema_version,
      envelope.aggregate_type,
      envelope.aggregate_id,
      envelope.aggregate_version,
      JSON.stringify(envelope),
    ]);
  }
}

export class PgSearchStore implements SearchStore {
  constructor(private readonly pool: SqlPool) {}

  async withTx<T>(session: DbSession, fn: (tx: SearchTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const settings: [string, string][] = [
        ['app.tenant_id', session.tenantId],
        ['app.cell_id', session.cellId],
        ['app.actor_type', session.actorType satisfies ActorType],
        ['app.actor_id', session.actorId],
        ['app.correlation_id', session.correlationId],
      ];
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await fn(new PgTx(client, session.tenantId));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }
}
