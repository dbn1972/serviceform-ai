import { describe, expect, it } from 'vitest';
import { readPublishedDocument } from '../../src/service/published.js';
import type { DocumentRow } from '../../src/repo/document-repo.js';
import { createMemoryPool, emptyStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';

function row(patch: Partial<DocumentRow>): DocumentRow {
  const now = new Date('2026-11-10T00:00:00.000Z');
  return {
    document_id: DOC,
    tenant_id: T1,
    cell_id: 'cell-local',
    document_key: 'lab.form.v1.0.0',
    kind: 'FORM',
    schema_id: 'sf.metadata.kind.form.v1',
    payload: { pages: [] },
    payload_hash: `sha256:${'a'.repeat(64)}`,
    status: 'PUBLISHED',
    aggregate_version: '3',
    created_by: T1,
    created_at: now,
    updated_at: now,
    validated_at: now,
    published_at: now,
    ...patch,
  };
}

// REQ: Phase C-1 — CMP-009 resolves only PUBLISHED (immutable) FORM documents of the same tenant.
describe('CMP-033 readPublishedDocument (host composition provider read)', () => {
  it('returns a PUBLISHED document of the requested kind for its tenant', async () => {
    const store = emptyStore();
    store.documents.push(row({}));
    const pool = createMemoryPool(store);
    const view = await readPublishedDocument(pool, { tenantId: T1, documentId: DOC, kind: 'FORM' });
    expect(view).toMatchObject({
      document_id: DOC,
      kind: 'FORM',
      published_at: '2026-11-10T00:00:00.000Z',
    });
  });

  it('returns null for drafts, other kinds, other tenants and malformed ids', async () => {
    const store = emptyStore();
    store.documents.push(row({ status: 'VALIDATED', published_at: null }));
    const pool = createMemoryPool(store);
    expect(
      await readPublishedDocument(pool, { tenantId: T1, documentId: DOC, kind: 'FORM' }),
    ).toBeNull();
    store.documents[0] = row({});
    expect(
      await readPublishedDocument(pool, { tenantId: T1, documentId: DOC, kind: 'RULES' }),
    ).toBeNull();
    expect(
      await readPublishedDocument(pool, { tenantId: T2, documentId: DOC, kind: 'FORM' }),
    ).toBeNull();
    expect(
      await readPublishedDocument(pool, { tenantId: 'x', documentId: DOC, kind: 'FORM' }),
    ).toBeNull();
    expect(
      await readPublishedDocument(pool, { tenantId: T1, documentId: DOC, kind: 'NOPE' as 'FORM' }),
    ).toBeNull();
  });
});
