import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { registerM03Plugins } from '../../../apps/api/src/composition/m03.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-test',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm03-int', version: 'test', level: 'info', destination });
}

const T1 = '11111111-1111-4111-8111-111111111111';
const DOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANARY = '00000000-0000-4000-8000-000000000099';

const CTX: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-local',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: ['5fad7b4e-a06c-4d9e-b15f-8c4d2e6a0b75'],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

const DENY = {
  allow: false as const,
  reason_code: 'ROLE_DENIED',
  policy_revision: 'test-1',
  decision_id: '00000000-0000-4000-8000-0000000000bb',
};

function mounts() {
  const authorizer = { decide: async () => DENY };
  const resolveContext = async () => CTX;
  return {
    catalogue: { pool: {} as never, resolveContext, authorizer },
    metadata: { pool: {} as never, resolveContext, authorizer },
    masterData: { pool: {} as never, resolveContext, authorizer },
    makerChecker: { pool: {} as never, resolveContext, authorizer },
    versioning: { pool: {} as never, resolveContext, authorizer },
    localization: {
      pool: {} as never,
      resolveContext,
      authorizer,
      deploymentEnvironment: 'CI' as const,
    },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('INT-011 host M03 mounts (independent stitcher)', () => {
  it('forged x-tenant-id is SF-TEN-002 and never echoes the canary', async () => {
    app = await buildApp(config, { logger: silentLogger(), m03: mounts() });
    expect(app.m03Mounted).toEqual(
      expect.arrayContaining(['CMP-001', 'CMP-033', 'CMP-034', 'CMP-051', 'CMP-052', 'CMP-053']),
    );
    const paths: Array<['GET' | 'POST', string]> = [
      ['GET', '/v1/categories'],
      ['GET', `/v1/metadata/documents/${DOC}`],
      ['GET', '/v1/code-sets'],
      ['GET', `/v1/publication-requests/${DOC}`],
      ['GET', `/v1/tenant-service-bindings/${DOC}`],
      ['GET', '/v1/locales'],
    ];
    for (const [method, url] of paths) {
      const forged = await app.inject({ method, url, headers: { 'x-tenant-id': CANARY } });
      expect(forged.statusCode).toBe(403);
      expect(validate('error-response', forged.json()).valid).toBe(true);
      expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
      expect(forged.body).not.toContain(CANARY);
    }
  });

  it('M03 composition has no SQL and does not mount CMP-050/054', async () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../apps/api/src/composition/m03.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(src).not.toMatch(/services\/cmp-050|cmp-050-studio/);
    expect(src).not.toMatch(/from ['"]@serviceform\/ui-ux4g['"]/);
    expect(typeof registerM03Plugins).toBe('function');
  });
});
