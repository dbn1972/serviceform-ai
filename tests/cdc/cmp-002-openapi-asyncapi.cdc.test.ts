import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readJson } from './helpers/io.js';
import { paths } from './helpers/paths.js';

interface OpenApiDoc {
  openapi: string;
  info: { version: string };
  paths: Record<string, Record<string, { operationId?: string }>>;
}

interface AsyncApiDoc {
  asyncapi: string;
  info: { version: string };
  channels: Record<string, { address?: string; messages?: Record<string, unknown> }>;
}

interface ConsumerExpectation {
  supported: { openapi: string; asyncapi: string; info_version: string };
  required_operations: string[];
  required_channels: Record<string, string[]>;
}

function operationIds(doc: OpenApiDoc): Set<string> {
  const ids = new Set<string>();
  for (const methods of Object.values(doc.paths ?? {})) {
    for (const op of Object.values(methods)) {
      if (op.operationId) ids.add(op.operationId);
    }
  }
  return ids;
}

describe('CDC: CMP-002 OpenAPI/AsyncAPI consumer (F-V1-CDC)', () => {
  const expectation = readJson<ConsumerExpectation>(
    join(paths.expectationsDir, 'cmp-002-openapi-asyncapi.consumer.json'),
  );
  const openapi = readJson<OpenApiDoc>(paths.cmp002OpenApi);
  const asyncapi = readJson<AsyncApiDoc>(paths.cmp002AsyncApi);

  it('provider advertises supported OpenAPI/AsyncAPI versions', () => {
    expect(openapi.openapi).toBe(expectation.supported.openapi);
    expect(openapi.info.version).toBe(expectation.supported.info_version);
    expect(asyncapi.asyncapi).toBe(expectation.supported.asyncapi);
    expect(asyncapi.info.version).toBe(expectation.supported.info_version);
  });

  it('provider OpenAPI satisfies consumer required operations', () => {
    const ids = operationIds(openapi);
    for (const op of expectation.required_operations) {
      expect(ids.has(op), `missing operationId ${op}`).toBe(true);
    }
  });

  it('provider AsyncAPI satisfies consumer required channels and messages', () => {
    for (const [channel, messages] of Object.entries(expectation.required_channels)) {
      const ch = asyncapi.channels[channel];
      expect(ch, `missing channel ${channel}`).toBeTruthy();
      expect(ch.address ?? channel).toBe(channel);
      for (const msg of messages) {
        expect(ch.messages?.[msg], `missing message ${msg} on ${channel}`).toBeTruthy();
      }
    }
  });

  it('rejects a breaking OpenAPI provider (removed required operation)', () => {
    const broken: OpenApiDoc = structuredClone(openapi);
    delete broken.paths['/v1/tenants/{id}'];
    const ids = operationIds(broken);
    expect(ids.has('getTenant')).toBe(false);
    expect(
      expectation.required_operations.every((op) => ids.has(op)),
      'consumer must reject provider missing getTenant',
    ).toBe(false);
  });

  it('rejects a breaking AsyncAPI provider (removed audit ingest message)', () => {
    const broken: AsyncApiDoc = structuredClone(asyncapi);
    delete broken.channels['sf.audit.ingest.v1']?.messages?.AuditEventSubmitted;
    const msgs = broken.channels['sf.audit.ingest.v1']?.messages ?? {};
    expect(msgs.AuditEventSubmitted).toBeUndefined();
    expect(
      expectation.required_channels['sf.audit.ingest.v1']?.every((m) => Boolean(msgs[m])),
    ).toBe(false);
  });
});
