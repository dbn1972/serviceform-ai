import type { Pool } from 'pg';
import { isMetadataKind, isUuid, type MetadataKind } from '../domain/kinds.js';
import { getDocument } from '../repo/document-repo.js';

export interface PublishedDocumentView {
  document_id: string;
  document_key: string;
  kind: MetadataKind;
  payload: unknown;
  payload_hash: string;
  published_at: string;
}

/**
 * Provider read for host composition (for example the CMP-009 FormDefinitionPort): returns a
 * PUBLISHED, therefore immutable, document of `kind` for one tenant, or null. Runs on CMP-033's own
 * pool under FORCE RLS with the tenant set transaction-locally; no other component's SQL.
 */
export async function readPublishedDocument(
  pool: Pool,
  input: { tenantId: string; documentId: string; kind: MetadataKind },
): Promise<PublishedDocumentView | null> {
  if (!isUuid(input.tenantId) || !isUuid(input.documentId) || !isMetadataKind(input.kind)) {
    return null;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', input.tenantId]);
    const row = await getDocument(client, input.tenantId, input.documentId);
    await client.query('COMMIT');
    if (!row || row.status !== 'PUBLISHED' || row.kind !== input.kind || !row.published_at) {
      return null;
    }
    return {
      document_id: row.document_id,
      document_key: row.document_key,
      kind: row.kind,
      payload: row.payload,
      payload_hash: row.payload_hash,
      published_at: new Date(row.published_at).toISOString(),
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
