import { describe, expect, it } from 'vitest';
import {
  METADATA_KINDS,
  composeFingerprint,
  createFingerprint,
  isDocumentKey,
  isMetadataKind,
  isUuid,
  patchFingerprint,
  payloadHash,
  publishFingerprint,
  schemaIdForKind,
  sha256Fingerprint,
  validateFingerprint,
  validateKindPayload,
  type MetadataKind,
} from '../../src/domain/kinds.js';

function expectFail(kind: MetadataKind, payload: unknown): void {
  expect(() => validateKindPayload(kind, payload)).toThrow();
}

describe('CMP-033 kind payload schemas', () => {
  it('rejects non-objects and unknown kinds', () => {
    expect(isMetadataKind('SERVICE')).toBe(true);
    expect(isMetadataKind('NOT_A_KIND')).toBe(false);
    expectFail('SERVICE', null);
    expectFail('SERVICE', []);
    expectFail('SERVICE', 'x');
  });

  it('validates SERVICE / OFFERING / CREDENTIAL', () => {
    validateKindPayload('SERVICE', { code: 'generic_service', title: 'Service' });
    expectFail('SERVICE', { code: 'Bad', title: 'x' });
    expectFail('SERVICE', { code: 'generic_service' });
    validateKindPayload('OFFERING', {
      service_document_key: 'svc.alpha',
      jurisdiction_scope: 'TENANT',
    });
    validateKindPayload('OFFERING', {
      service_document_key: 'svc.alpha',
      jurisdiction_scope: 'PLATFORM',
    });
    expectFail('OFFERING', { service_document_key: 'Bad', jurisdiction_scope: 'TENANT' });
    expectFail('OFFERING', { service_document_key: 'svc.alpha', jurisdiction_scope: 'CELL' });
    validateKindPayload('CREDENTIAL', { template_key: 'tpl.generic' });
    expectFail('CREDENTIAL', { template_key: 'Bad' });
  });

  it('validates FORM / RULES / EVIDENCE graphs', () => {
    validateKindPayload('FORM', {
      pages: [{ id: 'page.one', fields: [{ id: 'field.a', control: 'text' }] }],
    });
    expectFail('FORM', { pages: [] });
    expectFail('FORM', { pages: ['x'] });
    expectFail('FORM', { pages: [{ id: 'Bad', fields: [{ id: 'field.a', control: 'text' }] }] });
    expectFail('FORM', { pages: [{ id: 'page.one', fields: ['x'] }] });
    expectFail('FORM', { pages: [{ id: 'page.one', fields: [{ id: 'Bad', control: 'text' }] }] });
    expectFail('FORM', { pages: [{ id: 'page.one', fields: [{ id: 'field.a' }] }] });
    validateKindPayload('RULES', { rule_pack_id: 'pack.alpha', engine: 'GORULES' });
    expectFail('RULES', { rule_pack_id: 'Bad', engine: 'GORULES' });
    expectFail('RULES', { rule_pack_id: 'pack.alpha', engine: 'OTHER' });
    validateKindPayload('EVIDENCE', {
      requirements: [{ id: 'req.one', artifact_type: 'pdf' }],
    });
    expectFail('EVIDENCE', { requirements: ['x'] });
    expectFail('EVIDENCE', { requirements: [{ id: 'Bad', artifact_type: 'pdf' }] });
  });

  it('validates FEE / WORKFLOW / SLA / ACCESS / NOTIFICATION', () => {
    validateKindPayload('FEE', { items: [{ id: 'fee.one', amount_minor: 100 }] });
    expectFail('FEE', { items: ['x'] });
    expectFail('FEE', { items: [{ id: 'Bad', amount_minor: 1 }] });
    expectFail('FEE', { items: [{ id: 'fee.one', amount_minor: -1 }] });
    expectFail('FEE', { items: [{ id: 'fee.one', amount_minor: 1.5 }] });
    validateKindPayload('WORKFLOW', { steps: [{ id: 'step.one', type: 'task' }] });
    expectFail('WORKFLOW', { steps: ['x'] });
    expectFail('WORKFLOW', { steps: [{ id: 'Bad', type: 'task' }] });
    validateKindPayload('SLA', { clocks: [{ id: 'clock.one', duration_iso: 'P1D' }] });
    expectFail('SLA', { clocks: ['x'] });
    expectFail('SLA', { clocks: [{ id: 'Bad', duration_iso: 'P1D' }] });
    expectFail('SLA', { clocks: [{ id: 'clock.one', duration_iso: '1 day' }] });
    validateKindPayload('ACCESS', { roles: ['SERVICE_CHECKER'] });
    expectFail('ACCESS', { roles: ['officer'] });
    validateKindPayload('NOTIFICATION', {
      templates: [{ id: 'tpl.one', channel: 'EMAIL' }],
    });
    validateKindPayload('NOTIFICATION', {
      templates: [{ id: 'tpl.one', channel: 'SMS' }],
    });
    expectFail('NOTIFICATION', { templates: ['x'] });
    expectFail('NOTIFICATION', { templates: [{ id: 'Bad', channel: 'EMAIL' }] });
    expectFail('NOTIFICATION', { templates: [{ id: 'tpl.one', channel: 'PUSH' }] });
  });

  it('covers fingerprints, keys, schema ids', () => {
    expect(METADATA_KINDS).toContain('SERVICE');
    expect(schemaIdForKind('SERVICE')).toBe('sf.metadata.kind.service.v1');
    expect(payloadHash({ a: 1 }).startsWith('sha256:')).toBe(true);
    expect(sha256Fingerprint(['a', 'b']).length).toBeGreaterThan(10);
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('not-uuid')).toBe(false);
    expect(isDocumentKey('doc.alpha')).toBe(true);
    expect(isDocumentKey('Bad')).toBe(false);
    expect(createFingerprint({ kind: 'SERVICE', document_key: 'k', schema_id: 's', payload: {} }));
    expect(patchFingerprint('id', { x: 1 }));
    expect(validateFingerprint('id'));
    expect(publishFingerprint('id'));
    expect(composeFingerprint({ bundle_key: 'b.one', document_ids: ['b', 'a'] }));
  });
});
