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
    expect(openapi.paths['/v1/profiles/{subjectId}']).toBeTruthy();
    expect(openapi.paths['/v1/profiles/{subjectId}/verified-claims/import']).toBeTruthy();
    expect(asyncapi.channels['sf.citizen-profile.events.v1']).toBeTruthy();
    expect(asyncapi.channels['sf.audit.ingest.v1']).toBeTruthy();
  });

  it('validates domain event envelopes without PII payloads', () => {
    const env = envelopeOf({
      eventType: 'ProfileClaimUpserted',
      tenantId: officer.tenant_id,
      cellId: officer.cell_id,
      aggregateType: 'CitizenProfile',
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      occurredAt: '2026-10-04T09:00:00.000Z',
      correlationId: officer.correlation_id,
      actor: officer.actor,
      data: {
        claim_id: randomUUID(),
        section_code: 'IDENTITY',
        claim_code: 'DISPLAY_NAME',
        value_sha256: `sha256:${'a'.repeat(64)}`,
        source_kind: 'SELF',
        verification_status: 'UNVERIFIED',
      },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
    expect(JSON.stringify(env.data)).not.toMatch(/value_text/);
    const audit = auditEvent(officer, {
      action: 'PROFILE_WRITE',
      actionClass: 'WRITE',
      resourceType: 'CitizenProfile',
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
      .replaceAll('{schema}', 'sf_citizen_profile')
      .replaceAll('{cmp}', 'CMP-005')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759500800001_cmp-005-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(renderedTemplate);
    const templateOffset = up.indexOf(renderedTemplate);
    const afterTemplate = up.slice(templateOffset + renderedTemplate.length);
    expect(templateOffset).toBeGreaterThanOrEqual(0);
    expect(afterTemplate).toMatch(
      /ALTER TABLE sf_citizen_profile\.outbox_event OWNER TO sf_migrator/,
    );
    const templateSection = up.slice(templateOffset, templateOffset + renderedTemplate.length);
    expect(templateSection).toBe(renderedTemplate);
    expect(templateSection).not.toMatch(/OWNER TO/i);
    expect(up).toContain('GRANT INSERT ON sf_citizen_profile.outbox_event TO sf_app');
    expect(file).not.toMatch(/GRANT INSERT ON sf_citizen_profile\.\w+ TO sf_cmp005_rw/);
  });

  it('isolation declarations validate', () => {
    const iso = JSON.parse(read('contracts/isolation.json')) as {
      schema: string;
      tables: { name: string; isolation_class: string }[];
    };
    for (const t of iso.tables) {
      const decl = {
        entity: `${iso.schema}.${t.name}`,
        owner_component: 'CMP-005',
        isolation_class: t.isolation_class,
        ...(t.isolation_class === 'TENANT_SCOPED' || t.isolation_class === 'JURISDICTION_SCOPED'
          ? { rls: 'FORCE' as const }
          : t.isolation_class === 'CITIZEN_PRIVATE'
            ? { rls: 'FORCE' as const, justification: 'tenant-owned citizen profile PII' }
            : { rls: 'NOT_APPLICABLE' as const }),
      };
      expect(validate('isolation-declaration', decl).valid, t.name).toBe(true);
    }
  });
});
