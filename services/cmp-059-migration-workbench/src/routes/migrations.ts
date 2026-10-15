import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { Cmp059Error } from '../errors.js';
import { withContextTx } from '../db/tx.js';
import { isUuid } from '../domain/migration.js';
import {
  createProject,
  addSourceProfile,
  addMappingSpec,
  runDryRun,
  executeProject,
  getReconciliation,
} from '../service/migrations.js';
import type { RouteDeps } from './helpers.js';
import { migrationRateLimitOptions } from '../http/rate-limit.js';

export async function registerMigrationRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const rateLimitOpts = migrationRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  // POST /migrations/projects
  app.post<{
    Body: { display_name?: string; source_system_ref?: string; target_service_code?: string };
  }>('/migrations/projects', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp059Error('SF-AUTH-001');
    const body = request.body ?? {};
    if (typeof body.display_name !== 'string' || typeof body.source_system_ref !== 'string') {
      throw new Cmp059Error('SF-SYS-003');
    }
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'MIGRATION_PROJECT_CREATE', 'MigrationProject'),
    );
    const row = await withContextTx(deps.pool, ctx, (client) =>
      createProject(client, ctx, deps.clock(), {
        display_name: body.display_name as string,
        source_system_ref: body.source_system_ref as string,
        target_service_code: body.target_service_code ?? null,
      }),
    );
    return reply.code(201).send(row);
  });

  // POST /migrations/:id/profile
  app.post<{
    Params: { id: string };
    Body: { schema_descriptor?: unknown; field_count?: number; record_count_estimate?: number };
  }>('/migrations/:id/profile', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp059Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp059Error('SF-SYS-003');
    const body = request.body ?? {};
    if (typeof body.field_count !== 'number') throw new Cmp059Error('SF-SYS-003');
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'MIGRATION_PROFILE_CREATE', 'MigrationProject'),
    );
    const result = await withContextTx(deps.pool, ctx, (client) =>
      addSourceProfile(client, ctx, deps.clock(), request.params.id, {
        schema_descriptor: body.schema_descriptor ?? {},
        field_count: body.field_count as number,
        record_count_estimate: body.record_count_estimate ?? null,
      }),
    );
    return reply.code(201).send(result);
  });

  // POST /migrations/:id/map
  app.post<{
    Params: { id: string };
    Body: {
      mapping_version_ref?: string;
      field_mappings?: unknown[];
      exception_policy_ref?: string;
    };
  }>('/migrations/:id/map', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp059Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp059Error('SF-SYS-003');
    const body = request.body ?? {};
    if (typeof body.mapping_version_ref !== 'string' || !Array.isArray(body.field_mappings)) {
      throw new Cmp059Error('SF-SYS-003');
    }
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'MIGRATION_MAPPING_CREATE', 'MigrationProject'),
    );
    const result = await withContextTx(deps.pool, ctx, (client) =>
      addMappingSpec(client, ctx, deps.clock(), request.params.id, {
        mapping_version_ref: body.mapping_version_ref as string,
        field_mappings: body.field_mappings as unknown[],
        exception_policy_ref: body.exception_policy_ref ?? null,
      }),
    );
    return reply.code(201).send(result);
  });

  // POST /migrations/:id/dry-run
  app.post<{
    Params: { id: string };
    Body: {
      total_records?: number;
      simulated_processed?: number;
      simulated_failed?: number;
      simulated_exceptions?: unknown[];
    };
  }>('/migrations/:id/dry-run', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp059Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp059Error('SF-SYS-003');
    const body = request.body ?? {};
    if (typeof body.total_records !== 'number') throw new Cmp059Error('SF-SYS-003');
    await authorize(deps.authorizer, authzInput(ctx, 'MIGRATION_DRY_RUN', 'MigrationProject'));
    const result = await withContextTx(deps.pool, ctx, (client) =>
      runDryRun(client, ctx, deps.clock(), request.params.id, {
        total_records: body.total_records as number,
        simulated_processed: body.simulated_processed,
        simulated_failed: body.simulated_failed,
        simulated_exceptions: body.simulated_exceptions,
      }),
    );
    return reply.code(200).send(result);
  });

  // POST /migrations/:id/execute
  // Architecture Constitution §39: dry_run_required_before_execute = true.
  // Service will reject with DRY_RUN_REQUIRED_BEFORE_EXECUTE if not in DRY_RUN_DONE state.
  app.post<{
    Params: { id: string };
    Body: {
      total_records?: number;
      processed_records?: number;
      failed_records?: number;
      exceptions?: unknown[];
    };
  }>('/migrations/:id/execute', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp059Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp059Error('SF-SYS-003');
    const body = request.body ?? {};
    if (typeof body.total_records !== 'number') throw new Cmp059Error('SF-SYS-003');
    await authorize(deps.authorizer, authzInput(ctx, 'MIGRATION_EXECUTE', 'MigrationProject'));
    const result = await withContextTx(deps.pool, ctx, (client) =>
      executeProject(client, ctx, deps.clock(), request.params.id, {
        total_records: body.total_records as number,
        processed_records: body.processed_records,
        failed_records: body.failed_records,
        exceptions: body.exceptions,
      }),
    );
    return reply.code(200).send(result);
  });

  // GET /migrations/:id/reconciliation
  app.get<{ Params: { id: string } }>('/migrations/:id/reconciliation', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp059Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp059Error('SF-SYS-003');
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'MIGRATION_RECONCILIATION_READ', 'MigrationProject'),
    );
    const result = await withContextTx(deps.pool, ctx, (client) =>
      getReconciliation(client, ctx, request.params.id),
    );
    return reply.code(200).send(result);
  });
}
