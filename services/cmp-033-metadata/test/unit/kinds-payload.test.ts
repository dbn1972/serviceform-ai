import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  METADATA_KINDS,
  canonicalContentHash,
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

  // REQ: Phase C-1 — a FORM version is pinned by the canonical hash of exactly what validated.
  it('verifies an embedded Studio form_package against its declared content hash', () => {
    const pages = [{ id: 'applicant', fields: [{ id: 'applicant_name', control: 'text' }] }];
    const form_package = {
      form_id: 'lab.generic.application',
      json_schema: {
        type: 'object',
        title: 'Generic',
        properties: { applicant_name: { type: 'string', title: 'Name' } },
        required: ['applicant_name'],
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
    const content_hash = canonicalContentHash(form_package);
    const reordered = {
      ui_schema: form_package.ui_schema,
      json_schema: form_package.json_schema,
      form_id: form_package.form_id,
    };
    expect(canonicalContentHash(reordered)).toBe(content_hash);
    validateKindPayload('FORM', { pages, form_package, content_hash, authoring: { tool: 'x' } });
    expectFail('FORM', { pages, form_package, content_hash: `sha256:${'0'.repeat(64)}` });
    expectFail('FORM', { pages, form_package, content_hash: 'md5:abc' });
    expectFail('FORM', { pages, form_package });
    expectFail('FORM', { pages, content_hash });
    expectFail('FORM', { pages, form_package: [], content_hash });
    expectFail('FORM', {
      pages,
      form_package: { ...form_package, form_id: 'Bad Key' },
      content_hash: canonicalContentHash({ ...form_package, form_id: 'Bad Key' }),
    });
    const noObject = { ...form_package, json_schema: { type: 'string' } };
    expectFail('FORM', {
      pages,
      form_package: noObject,
      content_hash: canonicalContentHash(noObject),
    });
    const noLayout = { ...form_package, ui_schema: [] };
    expectFail('FORM', {
      pages,
      form_package: noLayout,
      content_hash: canonicalContentHash(noLayout),
    });
    const extra = { ...form_package, script: 'x' };
    expectFail('FORM', { pages, form_package: extra, content_hash: canonicalContentHash(extra) });
    const tampered = {
      ...form_package,
      json_schema: { ...form_package.json_schema, required: [] },
    };
    expectFail('FORM', { pages, form_package: tampered, content_hash });
  });

  // REQ: Phase C-2 — a WORKFLOW version is pinned by the CMP-016 graph_hash of what validated.
  it('verifies an embedded Studio workflow_graph against its declared graph hash', () => {
    const steps = [
      { id: 'start', type: 'START' },
      { id: 'end', type: 'END' },
    ];
    const workflow_graph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [{ from_node: 'START', to_node: 'END' }],
    };
    const graph_hash = canonicalContentHash(workflow_graph);
    expect(graph_hash).toBe(
      'sha256:' +
        createHash('sha256')
          .update(
            '{"edges":[{"from_node":"START","to_node":"END"}],"nodes":[{"kind":"START","node_id":"START"},{"kind":"END","node_id":"END"}]}',
          )
          .digest('hex'),
    );
    const layout = { nodes: { START: { x: 0, y: 0, label: 'Start' } } };
    validateKindPayload('WORKFLOW', { steps, workflow_graph, graph_hash, layout });
    expectFail('WORKFLOW', { steps, workflow_graph, graph_hash: `sha256:${'0'.repeat(64)}` });
    expectFail('WORKFLOW', { steps, workflow_graph });
    expectFail('WORKFLOW', { steps, graph_hash });
    expectFail('WORKFLOW', { steps, workflow_graph: [], graph_hash });
    expectFail('WORKFLOW', {
      steps,
      workflow_graph: { ...workflow_graph, script: 'x' },
      graph_hash,
    });
    expectFail('WORKFLOW', { steps, workflow_graph: { nodes: [], edges: [] }, graph_hash });
    expectFail('WORKFLOW', { steps, workflow_graph, graph_hash, layout: [] });
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
