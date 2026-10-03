import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEvent } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { toSubmittedEnvelope } from '@serviceform/audit-client';
import { checkCompatibility } from '../../services/cmp-038-event-bus/src/registry/compatibility.js';
import type { TopicSpec } from '../../packages/outbox/src/registry-port.js';
import { readJson } from './helpers/io.js';
import { paths } from './helpers/paths.js';

interface TopicsFile {
  topics: Array<{ name: string; event_types: string[]; direction?: string }>;
}

interface RegistryFile {
  topics: TopicSpec[];
}

interface CompatExpectation {
  required_registered_topics: string[];
  wave1_producer_topic_contracts: string[];
  audit_ingest: { topic: string; event_type: string; schema_version: number };
  supported_compatibility_modes: string[];
}

function schemaFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.schema.json') || f.endsWith('.json'));
}

/** Registry schemas in W1 are JSON Schema objects; accept object payloads when open. */
function registryAcceptsObjectPayload(schema: Record<string, unknown>, data: unknown): boolean {
  if (schema['type'] !== 'object') return false;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  if (schema['additionalProperties'] === false) {
    const props = (schema['properties'] as Record<string, unknown> | undefined) ?? {};
    return Object.keys(data as object).every((k) => k in props);
  }
  return true;
}

function requireTopic(byName: Map<string, TopicSpec>, topicName: string): TopicSpec {
  const topic = byName.get(topicName);
  if (!topic) throw new Error(`unregistered required topic ${topicName}`);
  return topic;
}

describe('CDC: CMP-038 topic compatibility vs Wave 1 producer payloads (F-V1-CDC)', () => {
  const expectation = readJson<CompatExpectation>(
    join(paths.expectationsDir, 'cmp-038-topic-compat.consumer.json'),
  );
  const registry = readJson<RegistryFile>(paths.cmp038Registry);
  const snapshot = readJson<RegistryFile>(paths.outboxSnapshot);
  const byName = new Map(registry.topics.map((t) => [t.topic_name, t]));

  it('outbox snapshot matches CMP-038 registry (publisher boundary)', () => {
    expect(snapshot).toEqual(registry);
  });

  it('required Wave 1 seam topics are registered with supported schema versions', () => {
    for (const topicName of expectation.required_registered_topics) {
      const topic = requireTopic(byName, topicName);
      expect(expectation.supported_compatibility_modes).toContain(topic.compatibility);
      if (topicName === expectation.audit_ingest.topic) {
        const schema = topic.schemas.find(
          (s) => s.event_type === expectation.audit_ingest.event_type,
        );
        expect(schema?.schema_version).toBe(expectation.audit_ingest.schema_version);
      }
    }
  });

  it('producer audit ingest payloads are accepted by registered AuditEventSubmitted schema', () => {
    const topic = requireTopic(byName, expectation.audit_ingest.topic);
    const registered = topic.schemas.find(
      (s) =>
        s.event_type === expectation.audit_ingest.event_type &&
        s.schema_version === expectation.audit_ingest.schema_version,
    );
    expect(registered, 'missing AuditEventSubmitted schema_version 1').toBeTruthy();
    if (!registered) return;

    const example = readJson<AuditEvent>(paths.auditEventExample);
    expect(validate('audit-event', example).valid).toBe(true);
    const envelope = toSubmittedEnvelope(example);
    expect(
      registryAcceptsObjectPayload(registered.data_schema, envelope.data),
      'registry data_schema must accept producer audit data',
    ).toBe(true);

    for (const rel of [paths.cmp002Topics, paths.cmp048Topics, paths.cmp037Topics]) {
      const topics = readJson<TopicsFile>(rel);
      expect(topics.topics.some((t) => t.name === expectation.audit_ingest.topic)).toBe(true);
    }
  });

  it('rejects incompatible / breaking schema evolution under topic compatibility mode', () => {
    const topic = requireTopic(byName, expectation.audit_ingest.topic);
    expect(topic.compatibility).toBe('BACKWARD');
    const previous = {
      type: 'object',
      properties: { audit_id: { type: 'string' } },
      required: ['audit_id'],
      additionalProperties: true,
    };
    const breaking = {
      type: 'object',
      properties: { audit_id: { type: 'string' }, must_have: { type: 'string' } },
      required: ['audit_id', 'must_have'],
      additionalProperties: true,
    };
    expect(checkCompatibility(previous, previous, 'BACKWARD').ok).toBe(true);
    const bad = checkCompatibility(previous, breaking, 'BACKWARD');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('new required properties');

    const registeredSchema = topic.schemas[0]?.data_schema;
    expect(registeredSchema).toBeTruthy();
    if (!registeredSchema) return;
    const againstRegistered = checkCompatibility(registeredSchema, breaking, 'BACKWARD');
    expect(againstRegistered.ok).toBe(false);
  });

  it('Wave 1 producer topic contracts are loadable and list event types', () => {
    const contracts = [
      paths.cmp002Topics,
      paths.cmp048Topics,
      paths.cmp037Topics,
      paths.cmp031Topics,
    ];
    expect(contracts.length).toBe(expectation.wave1_producer_topic_contracts.length);
    for (const path of contracts) {
      const topics = readJson<TopicsFile>(path);
      expect(topics.topics.length).toBeGreaterThan(0);
      for (const t of topics.topics) {
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.event_types.length).toBeGreaterThan(0);
      }
    }
  });

  it('producer data schemas (when present) are valid JSON Schema objects', () => {
    for (const dir of [paths.cmp002EventsDir, paths.cmp048EventsDir, paths.cmp037EventsDir]) {
      for (const file of schemaFiles(dir)) {
        const schema = readJson<Record<string, unknown>>(join(dir, file));
        expect(schema).toEqual(expect.objectContaining({ type: 'object' }));
        expect(checkCompatibility(schema, schema, 'BACKWARD').ok).toBe(true);
        const breaking = {
          ...schema,
          required: [...((schema.required as string[] | undefined) ?? []), '__cdc_break__'],
          properties: {
            ...((schema.properties as Record<string, unknown> | undefined) ?? {}),
            __cdc_break__: { type: 'string' },
          },
        };
        expect(checkCompatibility(schema, breaking, 'BACKWARD').ok).toBe(false);
      }
    }
  });

  it('rejects publishing intent for unknown topic names against the registry', () => {
    expect(byName.has('sf.not-a-registered.topic.v1')).toBe(false);
  });
});
