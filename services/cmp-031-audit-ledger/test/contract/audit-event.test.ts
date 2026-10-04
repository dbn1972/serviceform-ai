import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { buildAuditEvent, toOutboxRow, toSubmittedEnvelope } from '@serviceform/audit-client';
import type { RequestContext } from '@serviceform/contracts';

const valid = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../../contracts/shared/examples/valid/audit-event.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const ctx: RequestContext = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['AUDITOR'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('CMP-031 contracts (SF-CON-AUDIT-EVENT)', () => {
  it('valid example still validates', () => {
    expect(validate('audit-event', valid).valid).toBe(true);
  });

  it('rejects extra top-level fields', () => {
    expect(validate('audit-event', { ...valid, aadhaar_number: 'x' }).valid).toBe(false);
  });

  it('buildAuditEvent fills context and envelope/outbox validate', () => {
    const { event } = buildAuditEvent(ctx, {
      occurred_at: '2026-10-03T09:00:00Z',
      action: 'EXAMPLE_OVERRIDE',
      action_class: 'OVERRIDE',
      resource_type: 'ExampleAggregate',
      resource_id: '9d3a1b8c-e4a0-4d2c-b59d-c08b6cae4f19',
      result: 'SUCCESS',
      reason: 'Synthetic example reason',
      classification: 'TENANT_SCOPED',
    });
    expect(event.tenant_id).toBe(ctx.tenant_id);
    expect(validate('audit-event', event).valid).toBe(true);
    const env = toSubmittedEnvelope(event);
    expect(validate('event-envelope', env).valid).toBe(true);
    expect(() => toOutboxRow(env)).not.toThrow();
  });
});
