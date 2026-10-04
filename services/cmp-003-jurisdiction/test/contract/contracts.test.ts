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
  jurisdiction_ids: ['5fad7b4e-a06c-4d9e-b15f-8c4d2e6a0b75'],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('CMP-003 component contracts', () => {
  it('parses OpenAPI and AsyncAPI JSON with Eng interfaces', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, unknown>;
    };
    expect(openapi.paths['/v1/jurisdictions']).toBeTruthy();
    expect(openapi.paths['/v1/jurisdictions/{id}/children']).toBeTruthy();
    expect(openapi.paths['/v1/jurisdiction/resolve']).toBeTruthy();
    expect(openapi.paths['/v1/jurisdiction-types']).toBeTruthy();
    expect(asyncapi.channels['sf.jurisdiction.events.v1']).toBeTruthy();
    expect(asyncapi.channels['sf.audit.ingest.v1']).toBeTruthy();
  });

  it('validates domain event envelopes and audit', () => {
    const env = envelopeOf({
      eventType: 'JurisdictionVersionPublished',
      tenantId: officer.tenant_id,
      cellId: officer.cell_id,
      aggregateType: 'Jurisdiction',
      aggregateId: randomUUID(),
      aggregateVersion: 2,
      occurredAt: '2026-10-04T09:00:00.000Z',
      correlationId: officer.correlation_id,
      actor: officer.actor,
      data: {
        jurisdiction_id: randomUUID(),
        version_no: 2,
        name: 'Node A',
        status: 'PUBLISHED',
        valid_from: '2026-10-04T09:00:00.000Z',
      },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
    const audit = auditEvent(officer, {
      action: 'JURISDICTION_PUBLISH',
      actionClass: 'WRITE',
      resourceType: 'Jurisdiction',
      resourceId: randomUUID(),
      result: 'SUCCESS',
      now: new Date('2026-10-04T09:00:00Z'),
    });
    expect(validate('audit-event', audit).valid).toBe(true);
  });

  it('outbox migration Up matches the frozen template after substitution', () => {
    const renderedTemplate = readFileSync(
      join(root, '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_jurisdiction')
      .replaceAll('{cmp}', 'CMP-003')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759500600001_cmp-003-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(renderedTemplate);
    const templateOffset = up.indexOf(renderedTemplate);
    const afterTemplate = up.slice(templateOffset + renderedTemplate.length);
    expect(templateOffset).toBeGreaterThanOrEqual(0);
    expect(afterTemplate).toMatch(/ALTER TABLE sf_jurisdiction\.outbox_event OWNER TO sf_migrator/);
    expect(afterTemplate).toMatch(
      /ALTER TABLE sf_jurisdiction\.outbox_event_platform OWNER TO sf_migrator/,
    );
  });

  it('schema migration declares isolation and privilege role without hard-coded levels', () => {
    const sql = readFileSync(
      join(root, '../../db/migrations/1759500600000_cmp-003-jurisdiction.sql'),
      'utf8',
    );
    expect(sql).toContain('sf:isolation');
    expect(sql).toContain('sf_cmp003_rw');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/\b(STATE|DISTRICT|VILLAGE|TALUKA)\b/);
    expect(sql).not.toContain('sf_tenant_org');
  });
});
