import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerMigration } from '../../src/plugin.js';
import { AllowAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { createMemoryPool, emptyStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: ['MIGRATION_OPERATOR'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    ...partial,
  };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('CMP-059 plugin HTTP unit (memory pool)', () => {
  let app: FastifyInstance;
  const config = loadConfig({ SF_ENVIRONMENT: 'LOCAL' });

  beforeAll(async () => {
    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerMigration(app, {
      prefix: '/v1',
      pool: createMemoryPool(emptyStore()),
      resolveContext: fixtureResolver,
      authorizer: new AllowAuthorizer(),
      config,
      clock: () => new Date('2026-10-15T12:00:00.000Z'),
    });
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR } }));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/migrations/projects', () => {
    it('creates a project (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/migrations/projects',
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: 'Legacy Civil Registry Migration',
          source_system_ref: 'LEGACY-CR-SYSTEM-001',
          target_service_code: 'IND-SOC-002',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ project_id: string; status: string }>();
      expect(body.status).toBe('DRAFT');
      expect(typeof body.project_id).toBe('string');
    });

    it('rejects missing display_name (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/migrations/projects',
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({ source_system_ref: 'SYS-001' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects without auth (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/migrations/projects',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: 'X', source_system_ref: 'Y' }),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('dry_run_required_before_execute gate', () => {
    it('rejects execute before dry run with DRY_RUN_REQUIRED_BEFORE_EXECUTE', async () => {
      // Create project
      const create = await app.inject({
        method: 'POST',
        url: '/v1/migrations/projects',
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: 'Gate Test Project',
          source_system_ref: 'GATE-TEST-001',
        }),
      });
      expect(create.statusCode).toBe(201);
      const { project_id } = create.json<{ project_id: string }>();

      // Add profile
      const profile = await app.inject({
        method: 'POST',
        url: `/v1/migrations/${project_id}/profile`,
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({
          schema_descriptor: { fields: ['name', 'dob'] },
          field_count: 2,
          record_count_estimate: 1000,
        }),
      });
      expect(profile.statusCode).toBe(201);

      // Add mapping
      const map = await app.inject({
        method: 'POST',
        url: `/v1/migrations/${project_id}/map`,
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({
          mapping_version_ref: 'MAP-V1.0.0',
          field_mappings: [{ source: 'name', target: 'applicant_name' }],
        }),
      });
      expect(map.statusCode).toBe(201);

      // Attempt execute without dry run → must fail
      const execute = await app.inject({
        method: 'POST',
        url: `/v1/migrations/${project_id}/execute`,
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({ total_records: 1000 }),
      });
      expect(execute.statusCode).toBe(422);
      const body = execute.json<{ details: { code: string }[] }>();
      expect(body.details?.[0]?.code).toBe('DRY_RUN_REQUIRED_BEFORE_EXECUTE');
    });
  });

  describe('full migration lifecycle', () => {
    it('completes dry run then execute with reconciliation', async () => {
      // Create project
      const create = await app.inject({
        method: 'POST',
        url: '/v1/migrations/projects',
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: 'Lifecycle Test Migration',
          source_system_ref: 'LIFECYCLE-001',
        }),
      });
      expect(create.statusCode).toBe(201);
      const { project_id } = create.json<{ project_id: string }>();

      // Profile
      await app.inject({
        method: 'POST',
        url: `/v1/migrations/${project_id}/profile`,
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({ schema_descriptor: { fields: ['id', 'name'] }, field_count: 2 }),
      });

      // Mapping
      await app.inject({
        method: 'POST',
        url: `/v1/migrations/${project_id}/map`,
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({
          mapping_version_ref: 'MAP-V2.0',
          field_mappings: [{ source: 'id', target: 'legacy_id' }],
        }),
      });

      // Dry run
      const dryRun = await app.inject({
        method: 'POST',
        url: `/v1/migrations/${project_id}/dry-run`,
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({ total_records: 500, simulated_failed: 0 }),
      });
      expect(dryRun.statusCode).toBe(200);
      const dr = dryRun.json<{ reconciliation: { reconciliation_status: string } }>();
      expect(dr.reconciliation.reconciliation_status).toBe('PASSED');

      // Execute
      const execute = await app.inject({
        method: 'POST',
        url: `/v1/migrations/${project_id}/execute`,
        headers: { ...bearer('t1'), 'content-type': 'application/json' },
        body: JSON.stringify({ total_records: 500 }),
      });
      expect(execute.statusCode).toBe(200);

      // Reconciliation read
      const recon = await app.inject({
        method: 'GET',
        url: `/v1/migrations/${project_id}/reconciliation`,
        headers: bearer('t1'),
      });
      expect(recon.statusCode).toBe(200);
      const reconcData = recon.json<{ reconciliation_status: string }>();
      expect(reconcData.reconciliation_status).toBe('PASSED');
    });
  });
});
