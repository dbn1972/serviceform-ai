import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@serviceform/contracts';
import {
  AuditClientError,
  buildAuditEvent,
  hashChainRow,
  hashEvent,
  toHex,
  toOutboxRow,
  toSubmittedEnvelope,
  GENESIS_HASH_HEX,
} from '../src/index.js';

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

describe('buildAuditEvent', () => {
  it('refuses null-tenant input under a tenant context (003-20)', () => {
    expect(() =>
      buildAuditEvent(ctx, {
        tenant_id: null,
        occurred_at: '2026-10-03T09:00:00Z',
        action: 'EXAMPLE_WRITE',
        resource_type: 'ExampleAggregate',
        resource_id: 'res-1',
        result: 'SUCCESS',
      }),
    ).toThrow(AuditClientError);
  });

  it('drops client_context and hashes stably', () => {
    const { event, dropped_client_context } = buildAuditEvent(ctx, {
      occurred_at: '2026-10-03T09:00:00Z',
      action: 'EXAMPLE_WRITE',
      action_class: 'WRITE',
      resource_type: 'ExampleAggregate',
      resource_id: 'res-1',
      result: 'SUCCESS',
      classification: 'TENANT_SCOPED',
      client_context: { source_ip: '203.0.113.10' },
    });
    expect(dropped_client_context).toBe(true);
    expect(event.client_context).toBeUndefined();
    expect(event.tenant_id).toBe(ctx.tenant_id);
    const env = toSubmittedEnvelope(event);
    expect(env.event_type).toBe('AuditEventSubmitted');
    expect(toOutboxRow(env).topic).toBe('sf.audit.ingest.v1');
    const hex = toHex(hashEvent(event));
    expect(hex).toHaveLength(64);
    const row = hashChainRow({
      tenant_id: event.tenant_id,
      chain_seq: 1,
      recorded_at: '2026-10-03T09:00:00.000Z',
      audit_id: event.audit_id,
      event,
      prev_hash_hex: GENESIS_HASH_HEX,
    });
    expect(toHex(row)).toHaveLength(64);
  });
});
