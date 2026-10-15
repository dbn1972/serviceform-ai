import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validate, type RequestContext } from '@serviceform/contracts';
import { envelopeOf } from '../../src/db/outbox.js';
import { auditEvent } from '../../src/audit.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const officer: RequestContext = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('CMP-058 component contracts', () => {
  it('parses OpenAPI and AsyncAPI JSON with semantic registry interfaces', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, unknown>;
    };
    expect(openapi.paths['/elements']).toBeTruthy();
    expect(openapi.paths['/elements/{id}']).toBeTruthy();
    expect(openapi.paths['/elements/{id}/publish']).toBeTruthy();
    expect(openapi.paths['/bindings']).toBeTruthy();
    expect(asyncapi.channels['sf.semantics.events.v1']).toBeTruthy();
    expect(asyncapi.channels['sf.audit.ingest.v1']).toBeTruthy();
  });

  it('validates isolation declarations', () => {
    const iso = JSON.parse(read('contracts/isolation.json')) as {
      entities: { entity: string; isolation_class: string; owner_component: string; rls?: string }[];
    };
    for (const row of iso.entities) {
      const rls =
        row.rls ??
        (row.isolation_class === 'TENANT_SCOPED' ? 'FORCE' : 'NOT_APPLICABLE');
      expect(
        validate('isolation-declaration', {
          entity: row.entity,
          owner_component: row.owner_component,
          isolation_class: row.isolation_class,
          rls,
        }).valid,
      ).toBe(true);
    }
  });

  it('validates domain event envelopes and audit', () => {
    const elementId = randomUUID();
    const eventData = {
      element_id: elementId,
      version: 1,
      element_code: 'semantic.applicant.full_name_ref',
      privacy_classification: 'PII',
    };
    const env = envelopeOf({
      eventType: 'SemanticElementDraftCreated',
      tenantId: null,
      cellId: 'cell-01',
      aggregateType: 'SemanticElement',
      aggregateId: elementId,
      aggregateVersion: 1,
      occurredAt: '2026-10-15T10:00:00.000Z',
      correlationId: randomUUID(),
      actor: { type: 'PRIVILEGED_ADMIN', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      data: eventData,
    });
    expect(validate('event-envelope', env).valid).toBe(true);

    const audit = auditEvent(officer, {
      action: 'SEMANTIC_ELEMENT_CREATE',
      actionClass: 'WRITE',
      resourceType: 'SemanticElement',
      resourceId: elementId,
      result: 'SUCCESS',
      now: new Date('2026-10-15T10:00:00.000Z'),
      classification: 'GLOBAL',
    });
    expect(validate('audit-event', audit).valid).toBe(true);
  });

  it('SF-CON-SEMANTIC-ELEMENT: contract id, status, and no invented policy fields', () => {
    const schema = JSON.parse(
      readFileSync(
        join(here, '../../../../contracts/m09/schemas/semantic-element.schema.json'),
        'utf8',
      ),
    ) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties['contract_id']).toBeTruthy();
    expect(schema.properties['invented_statutory_policy_forbidden']).toBeTruthy();
    const required = schema.required ?? [];
    expect(required).toContain('invented_statutory_policy_forbidden');
    expect(schema.properties).not.toHaveProperty('government_policy_meaning');
    expect(schema.properties).not.toHaveProperty('statutory_definition');
  });
});
