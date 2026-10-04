import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { envelopeOf } from '../../src/db/outbox.js';
import { auditEvent } from '../../src/audit.js';
import { mapPgError, Cmp004Error } from '../../src/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('CMP-004 contracts', () => {
  it('parses OpenAPI, AsyncAPI and isolation declarations', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, unknown>;
    };
    expect(openapi.paths['/v1/identity/citizen/otp/challenges']).toBeTruthy();
    expect(asyncapi.channels['sf.identity.events.v1']).toBeTruthy();
    const decls = JSON.parse(read('contracts/isolation.json')) as Array<{ entity: string }>;
    for (const d of decls) {
      expect(validate('isolation-declaration', d).valid, d.entity).toBe(true);
    }
  });

  it('validates domain and audit envelopes', () => {
    const env = envelopeOf({
      eventType: 'CitizenSessionIssued',
      tenantId: null,
      cellId: 'cell-01',
      aggregateType: 'CitizenSession',
      aggregateId: '9d3a1b8c-e4a0-4d2c-b59d-c08b6cae4f19',
      aggregateVersion: 1,
      occurredAt: '2026-10-04T09:00:00.000Z',
      correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      actor: { type: 'CITIZEN', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      data: { session_id: '9d3a1b8c-e4a0-4d2c-b59d-c08b6cae4f19' },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
    const ctx = {
      tenant_id: '11111111-1111-4111-8111-111111111111' as const,
      cell_id: 'cell-01',
      actor: { type: 'OFFICER' as const, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      roles: ['SERVICE_CHECKER'],
      jurisdiction_ids: [],
      auth_assurance: 'MFA' as const,
      correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    };
    const audit = auditEvent(ctx, {
      action: 'OFFICER_SESSION_ISSUE',
      actionClass: 'WRITE',
      resourceType: 'OfficerSession',
      resourceId: '9d3a1b8c-e4a0-4d2c-b59d-c08b6cae4f19',
      result: 'SUCCESS',
      classification: 'TENANT_SCOPED',
      now: new Date('2026-10-04T09:00:00Z'),
    });
    expect(validate('audit-event', audit).valid).toBe(true);
  });

  it('outbox migration Up matches the frozen template after substitution', () => {
    const renderedTemplate = readFileSync(
      join(root, '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_identity')
      .replaceAll('{cmp}', 'CMP-004')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759500800001_cmp-004-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(renderedTemplate);
    const templateOffset = up.indexOf(renderedTemplate);
    const afterTemplate = up.slice(templateOffset + renderedTemplate.length);
    expect(afterTemplate).toMatch(/ALTER TABLE sf_identity\.outbox_event OWNER TO sf_migrator/);
    const templateSection = up.slice(templateOffset, templateOffset + renderedTemplate.length);
    expect(templateSection).toBe(renderedTemplate);
    expect(templateSection).not.toMatch(/OWNER TO/i);
  });

  it('maps postgres errors', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError(new Cmp004Error('SF-AUTH-001')).code).toBe('SF-AUTH-001');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
  });
});
