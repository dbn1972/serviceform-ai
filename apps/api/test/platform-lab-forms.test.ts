import { describe, expect, it } from 'vitest';
import {
  canonicalSha256,
  StudioPublishedFormPort,
  type FormRequestLike,
  type PublishedFormLike,
} from '../src/platform/forms.js';

class NotFound extends Error {}

const CATALOGUE_FORM = 'ind-soc-002.application';

const TENANT = '0d15ba00-0001-4000-8000-0d15ba0000d1';
const DOC = '0d15ba00-00c1-4000-8000-0d15ba0000c1';
const PKG = {
  form_id: 'lab.studio.application',
  json_schema: { type: 'object', properties: { name: { type: 'string' } } },
  ui_schema: { type: 'Categorization', elements: [] },
};

function request(patch: Partial<FormRequestLike> = {}): FormRequestLike {
  return {
    tenantId: TENANT,
    formKey: PKG.form_id,
    versionId: DOC,
    contentHash: canonicalSha256(PKG),
    correlationId: '0d15ba00-00c2-4000-8000-0d15ba0000c2',
    ...patch,
  };
}

const emptyCatalogue = {
  async resolve(): Promise<PublishedFormLike> {
    throw new NotFound();
  },
};

function port(read: ConstructorParameters<typeof StudioPublishedFormPort>[0]['read']) {
  return new StudioPublishedFormPort({
    catalogue: emptyCatalogue,
    read,
    isNotFound: (err) => err instanceof NotFound,
    notFound: () => new NotFound(),
  });
}

// REQ: Phase C-1 — CMP-009 resolves Studio forms frozen in CMP-033 by hash pin (SAMPLE_LAB host).
describe('StudioPublishedFormPort', () => {
  it('prefers the SIMULATED catalogue and does not read CMP-033 for catalogue pins', async () => {
    const catalogued: PublishedFormLike = {
      tenant_id: TENANT,
      form_key: CATALOGUE_FORM,
      version_id: '0d15ba00-0010-4000-8000-0d15ba000010',
      content_hash: `sha256:${'a'.repeat(64)}`,
      status: 'PUBLISHED',
      payload: {},
    };
    let reads = 0;
    const p = new StudioPublishedFormPort({
      catalogue: { resolve: async () => catalogued },
      read: async () => {
        reads += 1;
        return null;
      },
      isNotFound: () => false,
      notFound: () => new NotFound(),
    });
    expect(await p.resolve(request())).toBe(catalogued);
    expect(reads).toBe(0);
  });

  it('resolves a PUBLISHED CMP-033 form by document id and recomputes its hash', async () => {
    const seen: unknown[] = [];
    const p = port(async (input) => {
      seen.push(input);
      return { document_id: DOC, payload: { pages: [], form_package: PKG, content_hash: 'x' } };
    });
    const form = await p.resolve(request());
    expect(seen).toEqual([{ tenantId: TENANT, documentId: DOC, kind: 'FORM' }]);
    expect(form).toEqual({
      tenant_id: TENANT,
      form_key: PKG.form_id,
      version_id: DOC,
      content_hash: canonicalSha256(PKG),
      status: 'PUBLISHED',
      payload: PKG,
    });
  });

  it('reports tampered content through the recomputed hash, not the declared one', async () => {
    const tampered = { ...PKG, json_schema: { type: 'object', properties: {} } };
    const p = port(async () => ({
      document_id: DOC,
      payload: { form_package: tampered, content_hash: canonicalSha256(PKG) },
    }));
    const form = await p.resolve(request());
    expect(form.content_hash).not.toBe(request().contentHash);
  });

  it('is not-found for unknown, unpublished or non-designer documents and rethrows other faults', async () => {
    await expect(port(async () => null).resolve(request())).rejects.toBeInstanceOf(NotFound);
    await expect(
      port(async () => ({ document_id: DOC, payload: { pages: [] } })).resolve(request()),
    ).rejects.toBeInstanceOf(NotFound);
    const failing = new StudioPublishedFormPort({
      catalogue: {
        resolve: async () => {
          throw new Error('timeout');
        },
      },
      read: async () => null,
      isNotFound: (err) => err instanceof NotFound,
      notFound: () => new NotFound(),
    });
    await expect(failing.resolve(request())).rejects.toThrow('timeout');
  });

  it('canonical hash ignores key order', () => {
    expect(canonicalSha256({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      canonicalSha256({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});
