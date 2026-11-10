import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalContentHash } from '../../src/domain/kinds.js';
import { readPublishedDocument } from '../../src/service/published.js';
import {
  bearer,
  buildApp,
  closeHarness,
  installTenant,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const formPackage = {
  form_id: 'lab.int.application',
  json_schema: {
    type: 'object',
    title: 'Integration form',
    additionalProperties: false,
    required: ['applicant_name'],
    properties: { applicant_name: { type: 'string', title: 'Name', minLength: 1 } },
  },
  ui_schema: {
    type: 'Categorization',
    elements: [
      {
        type: 'Category',
        label: 'Applicant',
        elements: [{ type: 'Control', scope: '#/properties/applicant_name' }],
      },
    ],
  },
};

// REQ: Phase C-1 — a Studio FORM version is validated against its canonical hash, frozen
// (PUBLISHED, immutable) and readable by the host only for its own tenant under FORCE RLS.
describe('CMP-033 Studio FORM documents (real PostgreSQL, FORCE RLS)', () => {
  it('validates the hash, freezes the version and serves it to its tenant only', async () => {
    const { app } = await buildApp(h);
    installTenant('t1f', T1);
    const content_hash = canonicalContentHash(formPackage);
    const payload = {
      pages: [{ id: 'applicant', fields: [{ id: 'applicant_name', control: 'text' }] }],
      form_package: formPackage,
      content_hash,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1f', { 'idempotency-key': 'idem-form-1' }),
      payload: { kind: 'FORM', document_key: 'lab.int.application.v1.0.0', payload },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { document_id: string }).document_id;

    const tamperedId = (
      (
        await app.inject({
          method: 'POST',
          url: '/v1/metadata/documents',
          headers: bearer('t1f', { 'idempotency-key': 'idem-form-2' }),
          payload: {
            kind: 'FORM',
            document_key: 'lab.int.application.v1.1.0',
            payload: { ...payload, content_hash: `sha256:${'0'.repeat(64)}` },
          },
        })
      ).json() as { document_id: string }
    ).document_id;
    const refused = await app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${tamperedId}/validate`,
      headers: bearer('t1f', { 'idempotency-key': 'idem-form-3' }),
    });
    expect(refused.statusCode).toBe(400);
    expect(JSON.stringify(refused.json())).toContain('/payload/content_hash');

    for (const [step, key] of [
      ['validate', 'idem-form-4'],
      ['publish', 'idem-form-5'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/metadata/documents/${id}/${step}`,
        headers: bearer('t1f', { 'idempotency-key': key }),
      });
      expect(res.statusCode).toBe(200);
    }
    const frozen = await app.inject({
      method: 'PATCH',
      url: `/v1/metadata/documents/${id}`,
      headers: bearer('t1f', { 'idempotency-key': 'idem-form-6' }),
      payload: { payload },
    });
    expect(frozen.statusCode).toBe(400);
    await app.close();

    const own = await readPublishedDocument(h.rt, { tenantId: T1, documentId: id, kind: 'FORM' });
    expect(own?.document_id).toBe(id);
    expect(canonicalContentHash((own?.payload as { form_package: unknown }).form_package)).toBe(
      content_hash,
    );
    expect(
      await readPublishedDocument(h.rt, { tenantId: T2, documentId: id, kind: 'FORM' }),
    ).toBeNull();
    expect(
      await readPublishedDocument(h.rt, { tenantId: T1, documentId: tamperedId, kind: 'FORM' }),
    ).toBeNull();
  });
});
