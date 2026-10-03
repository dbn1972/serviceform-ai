import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { AuditEvent, EventEnvelope, RequestContext } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import {
  buildAuditEvent,
  toOutboxRow,
  toSubmittedEnvelope,
  AUDIT_INGEST_TOPIC,
} from '@serviceform/audit-client';
import { readJson } from './helpers/io.js';
import { paths } from './helpers/paths.js';
import { AUDIT_INGEST, checkAuditIngestEnvelope } from './helpers/audit-ingest-consumer.js';

interface TopicsFile {
  component?: string;
  topics: Array<{ name: string; event_types: string[]; direction?: string }>;
}

interface AuditExpectation {
  topic: string;
  supported: {
    event_type: string;
    schema_version: number;
    aggregate_type: string;
  };
  producers: Array<{ component: string; topics_contract: string }>;
}

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

function producerEnvelope(action: string): EventEnvelope<AuditEvent> {
  const { event } = buildAuditEvent(ctx, {
    occurred_at: '2026-10-03T09:00:00Z',
    action,
    action_class: 'WRITE',
    resource_type: 'ExampleAggregate',
    resource_id: '9d3a1b8c-e4a0-4d2c-b59d-c08b6cae4f19',
    result: 'SUCCESS',
    classification: 'TENANT_SCOPED',
  });
  return toSubmittedEnvelope(event);
}

describe('CDC: CMP-002/048/037 → CMP-031 sf.audit.ingest.v1 (F-V1-CDC)', () => {
  const expectation = readJson<AuditExpectation>(
    join(paths.expectationsDir, 'audit-ingest.consumer.json'),
  );

  it('consumer supported versions match frozen audit ingest contract', () => {
    expect(expectation.topic).toBe(AUDIT_INGEST.topic);
    expect(expectation.supported.event_type).toBe(AUDIT_INGEST.event_type);
    expect(expectation.supported.schema_version).toBe(AUDIT_INGEST.schema_version);
    expect(expectation.supported.aggregate_type).toBe(AUDIT_INGEST.aggregate_type);
  });

  it.each([
    ['CMP-002', paths.cmp002Topics, 'TENANT_ORG_WRITE'],
    ['CMP-048', paths.cmp048Topics, 'SECURITY_POLICY_WRITE'],
    ['CMP-037', paths.cmp037Topics, 'CONNECTOR_INVOKE'],
  ] as const)(
    '%s producer envelope satisfies CMP-031 consumer expectation',
    (_component, topicsPath, action) => {
      const topics = readJson<TopicsFile>(topicsPath);
      const auditTopic = topics.topics.find((t) => t.name === AUDIT_INGEST_TOPIC);
      expect(auditTopic, `${topicsPath} must declare ${AUDIT_INGEST_TOPIC}`).toBeTruthy();
      expect(auditTopic?.event_types).toContain('AuditEventSubmitted');

      const envelope = producerEnvelope(action);
      const check = checkAuditIngestEnvelope(envelope);
      expect(check.ok, JSON.stringify(check)).toBe(true);
      if (!check.ok) return;

      const row = toOutboxRow(envelope);
      expect(row.topic).toBe(AUDIT_INGEST_TOPIC);
      expect(row.partition_key).toBe(`audit:${check.event.audit_id}`);
      expect(row.schema_version).toBe(1);
      expect(validate('event-envelope', envelope).valid).toBe(true);
      expect(validate('audit-event', envelope.data).valid).toBe(true);
    },
  );

  it('CMP-031 topics contract consumes AuditEventSubmitted on sf.audit.ingest.v1', () => {
    const topics = readJson<TopicsFile>(paths.cmp031Topics);
    const ingest = topics.topics.find((t) => t.name === AUDIT_INGEST_TOPIC);
    expect(ingest?.direction).toBe('consume');
    expect(ingest?.event_types).toContain('AuditEventSubmitted');
  });

  it('rejects incompatible / breaking producer envelopes', () => {
    const base = producerEnvelope('TENANT_ORG_WRITE');

    expect(checkAuditIngestEnvelope({ ...base, schema_version: 2 }).ok).toBe(false);
    expect(checkAuditIngestEnvelope({ ...base, event_type: 'WrongType' }).ok).toBe(false);
    expect(checkAuditIngestEnvelope({ ...base, aggregate_type: 'Other' }).ok).toBe(false);
    expect(
      checkAuditIngestEnvelope({
        ...base,
        aggregate_id: '00000000-0000-4000-8000-000000000099',
      }).ok,
    ).toBe(false);
    expect(
      checkAuditIngestEnvelope({
        ...base,
        tenant_id: '00000000-0000-4000-8000-000000000088',
      }).ok,
    ).toBe(false);
    expect(
      checkAuditIngestEnvelope({
        ...base,
        data: { ...(base.data as object), audit_id: undefined },
      }).ok,
    ).toBe(false);
    expect(checkAuditIngestEnvelope({ not: 'an envelope' }).ok).toBe(false);

    expect(checkAuditIngestEnvelope({ ...base, schema_version: 2 })).toEqual({
      ok: false,
      reason: 'SCHEMA_VERSION',
    });
    expect(checkAuditIngestEnvelope({ ...base, event_type: 'WrongType' })).toEqual({
      ok: false,
      reason: 'EVENT_TYPE',
    });
    expect(checkAuditIngestEnvelope({ ...base, aggregate_type: 'Other' })).toEqual({
      ok: false,
      reason: 'AGGREGATE_TYPE',
    });
  });

  it('shared valid audit-event example is accepted as ingest data', () => {
    const example = readJson<AuditEvent>(paths.auditEventExample);
    const envelope = toSubmittedEnvelope(example);
    expect(checkAuditIngestEnvelope(envelope)).toMatchObject({ ok: true });
  });
});
