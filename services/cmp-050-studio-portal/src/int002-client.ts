import type { PlatformTransport } from './proxy.js';
import { assertPlatformPath } from './proxy.js';
import { randomUUID } from 'node:crypto';

function idem(): string {
  return randomUUID();
}

export function createInt002Client(transport: PlatformTransport) {
  return {
    createMetadataDocument(body: {
      kind: string;
      document_key: string;
      payload: unknown;
      schema_id?: string;
    }) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath('metadata/documents'),
        body,
        idempotencyKey: idem(),
      });
    },
    getMetadataDocument(id: string) {
      return transport.send({
        method: 'GET',
        path: assertPlatformPath(`metadata/documents/${id}`),
      });
    },
    patchMetadataDocument(id: string, payload: unknown) {
      return transport.send({
        method: 'PATCH',
        path: assertPlatformPath(`metadata/documents/${id}`),
        body: { payload },
        idempotencyKey: idem(),
      });
    },
    validateMetadataDocument(id: string) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath(`metadata/documents/${id}/validate`),
        idempotencyKey: idem(),
      });
    },
    composeMetadataBundle(body: { bundle_key: string; document_ids: string[] }) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath('metadata/bundles'),
        body,
        idempotencyKey: idem(),
      });
    },
    createTenantServiceBinding(body: {
      binding_key: string;
      offering_ref: string;
      metadata_bundle_ref: string;
      pins?: unknown;
    }) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath('tenant-service-bindings'),
        body,
        idempotencyKey: idem(),
      });
    },
    getTenantServiceBinding(id: string) {
      return transport.send({
        method: 'GET',
        path: assertPlatformPath(`tenant-service-bindings/${id}`),
      });
    },
    publishTenantServiceBinding(id: string) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath(`tenant-service-bindings/${id}/publish`),
        idempotencyKey: idem(),
      });
    },
    createPublicationRequest(body: { subject_id: string; proposed_hash: string }) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath('publication-requests'),
        body: { ...body, subject_type: 'TENANT_SERVICE_BINDING' },
        idempotencyKey: idem(),
      });
    },
    getPublicationRequest(id: string) {
      return transport.send({
        method: 'GET',
        path: assertPlatformPath(`publication-requests/${id}`),
      });
    },
    submitPublicationRequest(id: string) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath(`publication-requests/${id}/submit`),
        idempotencyKey: idem(),
      });
    },
    approvePublicationRequest(id: string) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath(`publication-requests/${id}/approve`),
        idempotencyKey: idem(),
      });
    },
    rejectPublicationRequest(id: string) {
      return transport.send({
        method: 'POST',
        path: assertPlatformPath(`publication-requests/${id}/reject`),
        idempotencyKey: idem(),
      });
    },
  };
}

export type Int002Client = ReturnType<typeof createInt002Client>;
