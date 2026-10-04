import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lintAsyncApiDocument,
  lintComponentContracts,
  lintOpenApiDocument,
  parseContractDocument,
} from '../src/openapi-pipeline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('openapi-pipeline', () => {
  it('accepts a minimal OpenAPI 3 document', () => {
    expect(
      lintOpenApiDocument(
        { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: { '/x': {} } },
        'x.json',
      ),
    ).toEqual([]);
  });

  it('rejects OpenAPI without paths', () => {
    const findings = lintOpenApiDocument(
      { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} },
      'x.json',
    );
    expect(findings.some((f) => f.message.includes('paths'))).toBe(true);
  });

  it('accepts AsyncAPI channels', () => {
    expect(
      lintAsyncApiDocument(
        { asyncapi: '3.0.0', info: { title: 't', version: '1' }, channels: { c: {} } },
        'a.json',
      ),
    ).toEqual([]);
  });

  it('parses JSON-shaped yaml text', () => {
    const doc = parseContractDocument(
      '{"openapi":"3.1.0","info":{"title":"t","version":"1"},"paths":{"/a":{}}}',
      'o.yaml',
    );
    expect(lintOpenApiDocument(doc, 'o.yaml')).toEqual([]);
  });

  it('lints existing component-local contracts without touching shared', () => {
    const result = lintComponentContracts(ROOT);
    expect(result.filesChecked).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.findings.every((f) => !f.path.startsWith('contracts/shared/'))).toBe(true);
  });
});
