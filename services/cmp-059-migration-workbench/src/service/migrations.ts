import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RequestContext } from '@serviceform/contracts';
import { Cmp059Error } from '../errors.js';
import {
  isUuid,
  validateDisplayName,
  validateMappingVersionRef,
  validateSourceSystemRef,
  deriveReconciliationStatus,
} from '../domain/migration.js';
import {
  insertProject,
  getProject,
  updateProjectStatus,
  insertSourceProfile,
  insertMappingSpec,
  getMappingForProject,
  insertBatch,
  completeBatch,
  getLatestDryRunBatch,
  insertReconciliation,
  getLatestReconciliation,
  type ProjectRow,
  type BatchRow,
  type ReconciliationRow,
} from '../repo/migration-repo.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';

function tenantId(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp059Error('SF-TEN-001', { statusCode: 401 });
  return ctx.tenant_id;
}

function requireProject(row: ProjectRow | undefined, projectId: string): ProjectRow {
  if (!row) {
    throw new Cmp059Error('SF-APP-001', {
      statusCode: 404,
      details: [{ code: 'MIGRATION_PROJECT_NOT_FOUND', pointer: projectId }],
    });
  }
  return row;
}

// ── createProject ──────────────────────────────────────────────────────────

export interface CreateProjectInput {
  display_name: string;
  source_system_ref: string;
  target_service_code?: string | null;
}

export async function createProject(
  client: PoolClient,
  ctx: RequestContext,
  now: Date,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  const tid = tenantId(ctx);
  if (!validateDisplayName(input.display_name)) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'DISPLAY_NAME_INVALID' }] });
  }
  if (!validateSourceSystemRef(input.source_system_ref)) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'SOURCE_SYSTEM_REF_INVALID' }] });
  }
  const row = await insertProject(client, {
    projectId: randomUUID(),
    tenantId: tid,
    displayName: input.display_name,
    sourceSystemRef: input.source_system_ref,
    targetServiceCode: input.target_service_code ?? null,
    createdBy: ctx.actor.id,
    now,
  });
  return row;
}

// ── addSourceProfile ──────────────────────────────────────────────────────

export interface AddSourceProfileInput {
  schema_descriptor: unknown;
  field_count: number;
  record_count_estimate?: number | null;
}

export async function addSourceProfile(
  client: PoolClient,
  ctx: RequestContext,
  now: Date,
  projectId: string,
  input: AddSourceProfileInput,
): Promise<{ project: ProjectRow; profile_id: string }> {
  const tid = tenantId(ctx);
  if (!isUuid(projectId))
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'PROJECT_ID_INVALID' }] });

  const project = requireProject(await getProject(client, tid, projectId), projectId);
  if (!['DRAFT', 'PROFILED'].includes(project.status)) {
    throw new Cmp059Error('SF-SYS-003', {
      details: [{ code: 'PROJECT_STATUS_INVALID_FOR_PROFILE', pointer: project.status }],
    });
  }

  if (
    typeof input.schema_descriptor !== 'object' ||
    input.schema_descriptor === null ||
    Array.isArray(input.schema_descriptor)
  ) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'SCHEMA_DESCRIPTOR_INVALID' }] });
  }
  if (typeof input.field_count !== 'number' || input.field_count < 0) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'FIELD_COUNT_INVALID' }] });
  }

  const profileId = randomUUID();
  await insertSourceProfile(client, {
    profileId,
    tenantId: tid,
    projectId,
    schemaDescriptor: input.schema_descriptor,
    fieldCount: input.field_count,
    recordCountEstimate: input.record_count_estimate ?? null,
    createdBy: ctx.actor.id,
    now,
  });

  const updated = await updateProjectStatus(client, {
    tenantId: tid,
    projectId,
    status: 'PROFILED',
    now,
  });

  return { project: updated ?? project, profile_id: profileId };
}

// ── addMappingSpec ────────────────────────────────────────────────────────

export interface AddMappingSpecInput {
  mapping_version_ref: string;
  field_mappings: unknown[];
  exception_policy_ref?: string | null;
}

export async function addMappingSpec(
  client: PoolClient,
  ctx: RequestContext,
  now: Date,
  projectId: string,
  input: AddMappingSpecInput,
): Promise<{ project: ProjectRow; mapping_id: string }> {
  const tid = tenantId(ctx);
  if (!isUuid(projectId))
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'PROJECT_ID_INVALID' }] });

  const project = requireProject(await getProject(client, tid, projectId), projectId);
  if (!['PROFILED', 'MAPPED'].includes(project.status)) {
    throw new Cmp059Error('SF-SYS-003', {
      details: [{ code: 'PROJECT_STATUS_INVALID_FOR_MAPPING', pointer: project.status }],
    });
  }
  if (!validateMappingVersionRef(input.mapping_version_ref)) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'MAPPING_VERSION_REF_INVALID' }] });
  }
  if (!Array.isArray(input.field_mappings)) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'FIELD_MAPPINGS_INVALID' }] });
  }

  const mappingId = randomUUID();
  await insertMappingSpec(client, {
    mappingId,
    tenantId: tid,
    projectId,
    mappingVersionRef: input.mapping_version_ref,
    fieldMappings: input.field_mappings,
    exceptionPolicyRef: input.exception_policy_ref ?? null,
    createdBy: ctx.actor.id,
    now,
  });

  const updated = await updateProjectStatus(client, {
    tenantId: tid,
    projectId,
    status: 'MAPPED',
    now,
  });

  return { project: updated ?? project, mapping_id: mappingId };
}

// ── runDryRun ─────────────────────────────────────────────────────────────
// Architecture Constitution §39: dry_run_required_before_execute = true.
// A dry run creates a DRY_RUN batch and reconciliation evidence. It does NOT
// mutate any production data; all mutation is within sf_migration schema only.

export interface DryRunInput {
  total_records: number;
  simulated_processed?: number | undefined;
  simulated_failed?: number | undefined;
  simulated_exceptions?: unknown[] | undefined;
}

export async function runDryRun(
  client: PoolClient,
  ctx: RequestContext,
  now: Date,
  projectId: string,
  input: DryRunInput,
): Promise<{ batch: BatchRow; reconciliation: ReconciliationRow }> {
  const tid = tenantId(ctx);
  if (!isUuid(projectId))
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'PROJECT_ID_INVALID' }] });

  const project = requireProject(await getProject(client, tid, projectId), projectId);
  if (!['MAPPED', 'DRY_RUN_DONE'].includes(project.status)) {
    throw new Cmp059Error('SF-SYS-003', {
      details: [{ code: 'PROJECT_STATUS_INVALID_FOR_DRY_RUN', pointer: project.status }],
    });
  }

  const mapping = await getMappingForProject(client, tid, projectId);
  if (!mapping) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'MAPPING_SPEC_REQUIRED' }] });
  }

  if (typeof input.total_records !== 'number' || input.total_records < 0) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'TOTAL_RECORDS_INVALID' }] });
  }

  const processed = input.simulated_processed ?? input.total_records;
  const failed = input.simulated_failed ?? 0;
  const exceptions = input.simulated_exceptions ?? [];

  const batch = await insertBatch(client, {
    batchId: randomUUID(),
    tenantId: tid,
    projectId,
    batchType: 'DRY_RUN',
    mappingId: mapping.mapping_id,
    totalRecords: input.total_records,
    createdBy: ctx.actor.id,
    now,
  });

  const completed = await completeBatch(client, {
    tenantId: tid,
    batchId: batch.batch_id,
    processedRecords: processed,
    failedRecords: failed,
    exceptionCount: exceptions.length,
    status: failed === 0 ? 'COMPLETED' : 'COMPLETED',
    now,
  });

  const reconcStatus = deriveReconciliationStatus({
    sourceCount: input.total_records,
    targetCount: processed,
    matchedCount: processed - failed,
    failedRecords: failed,
  });

  const reconciliation = await insertReconciliation(client, {
    resultId: randomUUID(),
    tenantId: tid,
    projectId,
    batchId: batch.batch_id,
    sourceCount: input.total_records,
    targetCount: processed,
    matchedCount: processed - failed,
    exceptionList: exceptions,
    reconciliationStatus: reconcStatus,
    evidenceRef: null,
    createdBy: ctx.actor.id,
    now,
  });

  await updateProjectStatus(client, {
    tenantId: tid,
    projectId,
    status: 'DRY_RUN_DONE',
    now,
    incrementDryRun: true,
  });

  await insertOutbox(
    client,
    envelopeOf(
      tid,
      'MigrationDryRunCompleted',
      {
        project_id: projectId,
        batch_id: batch.batch_id,
        reconciliation_status: reconcStatus,
        dry_run_count: project.dry_run_count + 1,
      },
      ctx,
    ),
  );

  return { batch: completed ?? batch, reconciliation };
}

// ── executeProject ────────────────────────────────────────────────────────
// Architecture Constitution §39: dry_run_required_before_execute = true.
// This operation is REFUSED unless a completed DRY_RUN batch exists.

export interface ExecuteInput {
  total_records: number;
  processed_records?: number | undefined;
  failed_records?: number | undefined;
  exceptions?: unknown[] | undefined;
}

export async function executeProject(
  client: PoolClient,
  ctx: RequestContext,
  now: Date,
  projectId: string,
  input: ExecuteInput,
): Promise<{ batch: BatchRow; reconciliation: ReconciliationRow }> {
  const tid = tenantId(ctx);
  if (!isUuid(projectId))
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'PROJECT_ID_INVALID' }] });

  const project = requireProject(await getProject(client, tid, projectId), projectId);

  // Hard gate: dry run MUST have completed before execute (Architecture Constitution §39)
  if (project.status !== 'DRY_RUN_DONE') {
    throw new Cmp059Error('SF-SYS-003', {
      statusCode: 422,
      details: [{ code: 'DRY_RUN_REQUIRED_BEFORE_EXECUTE' }],
    });
  }

  const dryRunBatch = await getLatestDryRunBatch(client, tid, projectId);
  if (!dryRunBatch) {
    throw new Cmp059Error('SF-SYS-003', {
      statusCode: 422,
      details: [{ code: 'DRY_RUN_REQUIRED_BEFORE_EXECUTE' }],
    });
  }

  const mapping = await getMappingForProject(client, tid, projectId);
  if (!mapping) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'MAPPING_SPEC_REQUIRED' }] });
  }

  if (typeof input.total_records !== 'number' || input.total_records < 0) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'TOTAL_RECORDS_INVALID' }] });
  }

  const processed = input.processed_records ?? input.total_records;
  const failed = input.failed_records ?? 0;
  const exceptions = input.exceptions ?? [];

  await updateProjectStatus(client, { tenantId: tid, projectId, status: 'EXECUTING', now });

  const batch = await insertBatch(client, {
    batchId: randomUUID(),
    tenantId: tid,
    projectId,
    batchType: 'EXECUTE',
    mappingId: mapping.mapping_id,
    totalRecords: input.total_records,
    createdBy: ctx.actor.id,
    now,
  });

  const batchStatus = failed === 0 ? 'COMPLETED' : 'COMPLETED';
  const completed = await completeBatch(client, {
    tenantId: tid,
    batchId: batch.batch_id,
    processedRecords: processed,
    failedRecords: failed,
    exceptionCount: exceptions.length,
    status: batchStatus,
    now,
  });

  const reconcStatus = deriveReconciliationStatus({
    sourceCount: input.total_records,
    targetCount: processed,
    matchedCount: processed - failed,
    failedRecords: failed,
  });

  const reconciliation = await insertReconciliation(client, {
    resultId: randomUUID(),
    tenantId: tid,
    projectId,
    batchId: batch.batch_id,
    sourceCount: input.total_records,
    targetCount: processed,
    matchedCount: processed - failed,
    exceptionList: exceptions,
    reconciliationStatus: reconcStatus,
    evidenceRef: null,
    createdBy: ctx.actor.id,
    now,
  });

  const finalStatus = failed === 0 ? 'COMPLETED' : 'COMPLETED';
  await updateProjectStatus(client, { tenantId: tid, projectId, status: finalStatus, now });

  await insertOutbox(
    client,
    envelopeOf(
      tid,
      'MigrationBatchApplied',
      {
        project_id: projectId,
        batch_id: batch.batch_id,
        reconciliation_status: reconcStatus,
        dry_run_batch_id: dryRunBatch.batch_id,
      },
      ctx,
    ),
  );

  if (reconcStatus !== 'PASSED') {
    await insertOutbox(
      client,
      envelopeOf(
        tid,
        'MigrationReconciliationFailed',
        {
          project_id: projectId,
          batch_id: batch.batch_id,
          reconciliation_status: reconcStatus,
          exception_count: exceptions.length,
        },
        ctx,
      ),
    );
  } else {
    await insertOutbox(
      client,
      envelopeOf(
        tid,
        'MigrationCompleted',
        { project_id: projectId, batch_id: batch.batch_id },
        ctx,
      ),
    );
  }

  return { batch: completed ?? batch, reconciliation };
}

// ── getReconciliation ─────────────────────────────────────────────────────

export async function getReconciliation(
  client: PoolClient,
  ctx: RequestContext,
  projectId: string,
): Promise<ReconciliationRow> {
  const tid = tenantId(ctx);
  if (!isUuid(projectId))
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'PROJECT_ID_INVALID' }] });

  requireProject(await getProject(client, tid, projectId), projectId);

  const result = await getLatestReconciliation(client, tid, projectId);
  if (!result) {
    throw new Cmp059Error('SF-APP-001', {
      statusCode: 404,
      details: [{ code: 'RECONCILIATION_NOT_FOUND' }],
    });
  }
  return result;
}
