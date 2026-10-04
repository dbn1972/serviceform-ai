import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../../../../packages/contracts/src/index.js';
import { buildPortalSimulationMarker } from '../../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

describe('CMP-050 component contracts', () => {
  it('parses OpenAPI BFF paths', () => {
    const openapi = JSON.parse(readFileSync(join(root, 'contracts/openapi.json'), 'utf8')) as {
      paths: Record<string, unknown>;
    };
    expect(openapi.paths['/api/session']).toBeTruthy();
    expect(openapi.paths['/api/platform/{path}']).toBeTruthy();
  });

  it('declares no tenant-owned SQL entities', () => {
    const decls = JSON.parse(
      readFileSync(join(root, 'contracts/isolation.json'), 'utf8'),
    ) as unknown[];
    expect(decls).toEqual([]);
    for (const d of decls) {
      expect(validate('isolation-declaration', d).valid).toBe(true);
    }
  });

  it('builds a valid simulation marker for local session', () => {
    const marker = buildPortalSimulationMarker({
      environment: 'LOCAL',
      scenario: 'studio_session',
      testRunId: 'run-1',
      bindingId: '05005005-0050-4050-8050-050050050050',
    });
    expect(validate('simulation-marker', marker).valid).toBe(true);
    expect(marker.simulation).toBe(true);
  });
});
