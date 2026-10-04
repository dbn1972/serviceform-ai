import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { envelopeOf } from '../../src/db/outbox.js';
import { auditEvent } from '../../src/audit.js';
import type { RequestContext } from '@serviceform/contracts';

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

describe('component contracts', () => {
  it('parses OpenAPI and AsyncAPI JSON', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, unknown>;
    };
    expect(openapi.paths['/v1/consents']).toBeTruthy();
    expect(openapi.paths['/v1/consents/{id}/withdraw']).toBeTruthy();
    expect(openapi.paths['/v1/privacy/access-check']).toBeTruthy();
    expect(asyncapi.channels['sf.consent-privacy.events.v1']).toBeTruthy();
    expect(asyncapi.channels['sf.audit.ingest.v1']).toBeTruthy();
  });

  it('validates domain event envelopes', () => {
    const env = envelopeOf({
      eventType: 'ConsentGranted',
      tenantId: officer.tenant_id,
      cellId: officer.cell_id,
      aggregateType: 'Consent',
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      occurredAt: '2026-10-04T09:00:00.000Z',
      correlationId: officer.correlation_id,
      actor: officer.actor,
      data: {
        consent_id: randomUUID(),
        subject_id: randomUUID(),
        purpose_id: randomUUID(),
        notice_id: null,
        representation_basis: 'SELF',
        channel: 'WEB',
        granted_at: '2026-10-04T09:00:00.000Z',
      },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
    const audit = auditEvent(officer, {
      action: 'CONSENT_GRANT',
      actionClass: 'WRITE',
      resourceType: 'Consent',
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
      .replaceAll('{schema}', 'sf_consent_privacy')
      .replaceAll('{cmp}', 'CMP-030')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759500700001_cmp-030-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(renderedTemplate);
    const templateOffset = up.indexOf(renderedTemplate);
    const afterTemplate = up.slice(templateOffset + renderedTemplate.length);
    expect(templateOffset).toBeGreaterThanOrEqual(0);
    expect(afterTemplate).toMatch(
      /ALTER TABLE sf_consent_privacy\.outbox_event OWNER TO sf_migrator/,
    );
    expect(afterTemplate).toMatch(
      /ALTER TABLE sf_consent_privacy\.outbox_event_platform OWNER TO sf_migrator/,
    );
    expect(afterTemplate).toMatch(
      /ALTER TABLE sf_consent_privacy\.inbox_event OWNER TO sf_migrator/,
    );
    expect(afterTemplate).toMatch(
      /ALTER TABLE sf_consent_privacy\.inbox_event_platform OWNER TO sf_migrator/,
    );
    const templateSection = up.slice(templateOffset, templateOffset + renderedTemplate.length);
    expect(templateSection).toBe(renderedTemplate);
    expect(templateSection).not.toMatch(/OWNER TO/i);
    expect(up).toContain('GRANT INSERT ON sf_consent_privacy.outbox_event TO sf_app');
    expect(file).not.toMatch(/GRANT INSERT ON sf_consent_privacy\.\w+ TO sf_cmp030_rw/);
  });
});
