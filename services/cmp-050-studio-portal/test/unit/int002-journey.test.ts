import { describe, expect, it } from 'vitest';
import { Cmp050Error } from '../../src/errors.js';
import { createInt002Client } from '../../src/int002-client.js';
import { assertPlatformPath, type PlatformTransport } from '../../src/proxy.js';
import { makerCheckerUx } from '../../src/maker-checker-ux.js';
import { sessionFromLogin } from '../../src/session.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const maker = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const checker = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function memoryPlatform(): PlatformTransport & { store: Map<string, Record<string, unknown>> } {
  const store = new Map<string, Record<string, unknown>>();
  return {
    store,
    async send(req) {
      const path = assertPlatformPath(req.path);
      if (req.method === 'POST' && path === '/v1/metadata/documents') {
        const body = req.body as { kind: string; document_key: string };
        const document_id = 'd0000000-0000-4000-8000-000000000001';
        const row = { document_id, ...body, status: 'DRAFT' };
        store.set(`doc:${document_id}`, row);
        return { status: 201, body: row };
      }
      if (req.method === 'POST' && path.endsWith('/validate')) {
        return { status: 200, body: { status: 'VALIDATED' } };
      }
      if (req.method === 'POST' && path === '/v1/metadata/bundles') {
        return { status: 201, body: { bundle_id: 'b0000000-0000-4000-8000-000000000001' } };
      }
      if (req.method === 'POST' && path === '/v1/tenant-service-bindings') {
        const binding_id = 'e0000000-0000-4000-8000-000000000001';
        const row = {
          binding_id,
          artifact_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'DRAFT',
        };
        store.set(`bind:${binding_id}`, row);
        return { status: 201, body: row };
      }
      if (req.method === 'POST' && path === '/v1/publication-requests') {
        const request_id = 'f0000000-0000-4000-8000-000000000001';
        const row = {
          request_id,
          status: 'DRAFT',
          maker_principal_id: maker,
          subject_id: (req.body as { subject_id: string }).subject_id,
        };
        store.set(`pub:${request_id}`, row);
        return { status: 201, body: row };
      }
      if (req.method === 'POST' && path.endsWith('/submit')) {
        const row = store.get('pub:f0000000-0000-4000-8000-000000000001');
        if (!row) return { status: 404, body: {} };
        row['status'] = 'SUBMITTED';
        return { status: 200, body: row };
      }
      if (req.method === 'POST' && path.endsWith('/approve')) {
        const row = store.get('pub:f0000000-0000-4000-8000-000000000001');
        if (!row) return { status: 404, body: {} };
        row['status'] = 'APPROVED';
        return { status: 200, body: row };
      }
      if (req.method === 'POST' && path.endsWith('/publish')) {
        const pub = store.get('pub:f0000000-0000-4000-8000-000000000001');
        if (pub?.['status'] !== 'APPROVED')
          return { status: 400, body: { error_code: 'SF-SYS-003' } };
        return { status: 200, body: { status: 'PUBLISHED' } };
      }
      return { status: 404, body: {} };
    },
  };
}

describe('INT-002 studio journey (client)', () => {
  it('refuses paths outside the platform allowlist', () => {
    expect(() => assertPlatformPath('internal/admin')).toThrow(Cmp050Error);
    expect(assertPlatformPath('v1/metadata/documents')).toBe('/v1/metadata/documents');
  });

  it('runs validate → submit → checker approve → publish', async () => {
    const transport = memoryPlatform();
    const client = createInt002Client(transport);
    const created = await client.createMetadataDocument({
      kind: 'SERVICE',
      document_key: 'generic.service',
      payload: { code: 'generic_service', title: 'Generic service' },
    });
    expect(created.status).toBe(201);
    const docId = (created.body as { document_id: string }).document_id;
    expect((await client.validateMetadataDocument(docId)).status).toBe(200);
    expect(
      (await client.composeMetadataBundle({ bundle_key: 'generic.bundle', document_ids: [docId] }))
        .status,
    ).toBe(201);
    const binding = await client.createTenantServiceBinding({
      binding_key: 'generic.binding',
      offering_ref: 'generic.offering',
      metadata_bundle_ref: 'b0000000-0000-4000-8000-000000000001',
    });
    expect(binding.status).toBe(201);
    const bindingId = (binding.body as { binding_id: string }).binding_id;
    const pub = await client.createPublicationRequest({
      subject_id: bindingId,
      proposed_hash: (binding.body as { artifact_hash: string }).artifact_hash,
    });
    const requestId = (pub.body as { request_id: string }).request_id;
    const makerSession = sessionFromLogin({
      tenant_id: tenant,
      actor_id: maker,
      roles: ['STUDIO_DESIGNER'],
      surface: 'service_studio',
    });
    expect(makerCheckerUx(makerSession, pub.body as never).canSubmit).toBe(true);
    await client.submitPublicationRequest(requestId);
    const submitted = transport.store.get(`pub:${requestId}`);
    const checkerSession = sessionFromLogin({
      tenant_id: tenant,
      actor_id: checker,
      roles: ['STUDIO_CHECKER'],
      surface: 'service_studio',
    });
    expect(makerCheckerUx(checkerSession, submitted as never).canApprove).toBe(true);
    expect(makerCheckerUx(makerSession, submitted as never).canApprove).toBe(false);
    await client.approvePublicationRequest(requestId);
    const published = await client.publishTenantServiceBinding(bindingId);
    expect(published.status).toBe(200);
    expect((published.body as { status: string }).status).toBe('PUBLISHED');
  });
});
