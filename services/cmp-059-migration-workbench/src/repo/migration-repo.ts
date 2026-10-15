import type { PoolClient } from 'pg';

export type ProjectStatus =
  | 'DRAFT'
  | 'PROFILED'
  | 'MAPPED'
  | 'DRY_RUN_DONE'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'ROLLED_BACK'
  | 'CANCELLED';

export type BatchType = 'DRY_RUN' | 'EXECUTE';
export type BatchStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
export type ReconciliationStatus = 'PASSED' | 'FAILED' | 'PARTIAL';

export interface ProjectRow {
  tenant_id: string;
  project_id: string;
  project_version: number;
  display_name: string;
  source_system_ref: string;
  target_service_code: string | null;
  status: ProjectStatus;
  dry_run_count: number;
  last_dry_run_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface SourceProfileRow {
  tenant_id: string;
  profile_id: string;
  project_id: string;
  profile_version: number;
  schema_descriptor: unknown;
  field_count: number;
  record_count_estimate: number | null;
  created_by: string;
  created_at: Date;
}

export interface MappingSpecRow {
  tenant_id: string;
  mapping_id: string;
  project_id: string;
  mapping_version_ref: string;
  field_mappings: unknown;
  exception_policy_ref: string | null;
  created_by: string;
  created_at: Date;
}

export interface BatchRow {
  tenant_id: string;
  batch_id: string;
  project_id: string;
  batch_type: BatchType;
  status: BatchStatus;
  mapping_id: string;
  total_records: number;
  processed_records: number;
  failed_records: number;
  exception_count: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_by: string;
  created_at: Date;
}

export interface ReconciliationRow {
  tenant_id: string;
  result_id: string;
  project_id: string;
  batch_id: string;
  source_count: number;
  target_count: number;
  matched_count: number;
  exception_list: unknown;
  reconciliation_status: ReconciliationStatus;
  evidence_ref: string | null;
  created_by: string;
  created_at: Date;
}

// ── project ───────────────────────────────────────────────────────────────────

export async function insertProject(
  client: PoolClient,
  row: {
    projectId: string;
    tenantId: string;
    displayName: string;
    sourceSystemRef: string;
    targetServiceCode: string | null;
    createdBy: string;
    now: Date;
  },
): Promise<ProjectRow> {
  const res = await client.query<ProjectRow>(
    `INSERT INTO sf_migration.migration_project
       (tenant_id, project_id, display_name, source_system_ref, target_service_code,
        status, dry_run_count, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'DRAFT',0,$6,$7,$7)
     RETURNING *`,
    [
      row.tenantId,
      row.projectId,
      row.displayName,
      row.sourceSystemRef,
      row.targetServiceCode,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as ProjectRow;
}

export async function getProject(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<ProjectRow | undefined> {
  const res = await client.query<ProjectRow>(
    `SELECT * FROM sf_migration.migration_project WHERE tenant_id = $1 AND project_id = $2`,
    [tenantId, projectId],
  );
  return res.rows[0];
}

export async function updateProjectStatus(
  client: PoolClient,
  params: {
    tenantId: string;
    projectId: string;
    status: ProjectStatus;
    now: Date;
    incrementDryRun?: boolean;
  },
): Promise<ProjectRow | undefined> {
  const res = await client.query<ProjectRow>(
    `UPDATE sf_migration.migration_project
        SET status = $1,
            dry_run_count = CASE WHEN $4 THEN dry_run_count + 1 ELSE dry_run_count END,
            last_dry_run_at = CASE WHEN $4 THEN $3 ELSE last_dry_run_at END,
            updated_at = $3,
            project_version = project_version + 1
      WHERE tenant_id = $2 AND project_id = $5
      RETURNING *`,
    [
      params.status,
      params.tenantId,
      params.now,
      params.incrementDryRun ?? false,
      params.projectId,
    ],
  );
  return res.rows[0];
}

// ── source_profile ─────────────────────────────────────────────────────────

export async function insertSourceProfile(
  client: PoolClient,
  row: {
    profileId: string;
    tenantId: string;
    projectId: string;
    schemaDescriptor: unknown;
    fieldCount: number;
    recordCountEstimate: number | null;
    createdBy: string;
    now: Date;
  },
): Promise<SourceProfileRow> {
  const res = await client.query<SourceProfileRow>(
    `INSERT INTO sf_migration.source_profile
       (tenant_id, profile_id, project_id, schema_descriptor, field_count,
        record_count_estimate, created_by, created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
     RETURNING *`,
    [
      row.tenantId,
      row.profileId,
      row.projectId,
      JSON.stringify(row.schemaDescriptor),
      row.fieldCount,
      row.recordCountEstimate,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as SourceProfileRow;
}

// ── mapping_spec ──────────────────────────────────────────────────────────

export async function insertMappingSpec(
  client: PoolClient,
  row: {
    mappingId: string;
    tenantId: string;
    projectId: string;
    mappingVersionRef: string;
    fieldMappings: unknown;
    exceptionPolicyRef: string | null;
    createdBy: string;
    now: Date;
  },
): Promise<MappingSpecRow> {
  const res = await client.query<MappingSpecRow>(
    `INSERT INTO sf_migration.mapping_spec
       (tenant_id, mapping_id, project_id, mapping_version_ref, field_mappings,
        exception_policy_ref, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     RETURNING *`,
    [
      row.tenantId,
      row.mappingId,
      row.projectId,
      row.mappingVersionRef,
      JSON.stringify(row.fieldMappings),
      row.exceptionPolicyRef,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as MappingSpecRow;
}

export async function getMappingForProject(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<MappingSpecRow | undefined> {
  const res = await client.query<MappingSpecRow>(
    `SELECT * FROM sf_migration.mapping_spec
      WHERE tenant_id = $1 AND project_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, projectId],
  );
  return res.rows[0];
}

// ── migration_batch ──────────────────────────────────────────────────────

export async function insertBatch(
  client: PoolClient,
  row: {
    batchId: string;
    tenantId: string;
    projectId: string;
    batchType: BatchType;
    mappingId: string;
    totalRecords: number;
    createdBy: string;
    now: Date;
  },
): Promise<BatchRow> {
  const res = await client.query<BatchRow>(
    `INSERT INTO sf_migration.migration_batch
       (tenant_id, batch_id, project_id, batch_type, status, mapping_id,
        total_records, processed_records, failed_records, exception_count,
        started_at, created_by, created_at)
     VALUES ($1,$2,$3,$4,'PENDING',$5,$6,0,0,0,$7,$8,$7)
     RETURNING *`,
    [
      row.tenantId,
      row.batchId,
      row.projectId,
      row.batchType,
      row.mappingId,
      row.totalRecords,
      row.now,
      row.createdBy,
    ],
  );
  return res.rows[0] as BatchRow;
}

export async function completeBatch(
  client: PoolClient,
  params: {
    tenantId: string;
    batchId: string;
    processedRecords: number;
    failedRecords: number;
    exceptionCount: number;
    status: BatchStatus;
    now: Date;
  },
): Promise<BatchRow | undefined> {
  const res = await client.query<BatchRow>(
    `UPDATE sf_migration.migration_batch
        SET status = $1,
            processed_records = $2,
            failed_records = $3,
            exception_count = $4,
            completed_at = $5
      WHERE tenant_id = $6 AND batch_id = $7
      RETURNING *`,
    [
      params.status,
      params.processedRecords,
      params.failedRecords,
      params.exceptionCount,
      params.now,
      params.tenantId,
      params.batchId,
    ],
  );
  return res.rows[0];
}

export async function getLatestDryRunBatch(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<BatchRow | undefined> {
  const res = await client.query<BatchRow>(
    `SELECT * FROM sf_migration.migration_batch
      WHERE tenant_id = $1 AND project_id = $2 AND batch_type = 'DRY_RUN'
        AND status = 'COMPLETED'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, projectId],
  );
  return res.rows[0];
}

// ── reconciliation_result ─────────────────────────────────────────────────

export async function insertReconciliation(
  client: PoolClient,
  row: {
    resultId: string;
    tenantId: string;
    projectId: string;
    batchId: string;
    sourceCount: number;
    targetCount: number;
    matchedCount: number;
    exceptionList: unknown[];
    reconciliationStatus: ReconciliationStatus;
    evidenceRef: string | null;
    createdBy: string;
    now: Date;
  },
): Promise<ReconciliationRow> {
  const res = await client.query<ReconciliationRow>(
    `INSERT INTO sf_migration.reconciliation_result
       (tenant_id, result_id, project_id, batch_id, source_count, target_count,
        matched_count, exception_list, reconciliation_status, evidence_ref, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
     RETURNING *`,
    [
      row.tenantId,
      row.resultId,
      row.projectId,
      row.batchId,
      row.sourceCount,
      row.targetCount,
      row.matchedCount,
      JSON.stringify(row.exceptionList),
      row.reconciliationStatus,
      row.evidenceRef,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as ReconciliationRow;
}

export async function getLatestReconciliation(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<ReconciliationRow | undefined> {
  const res = await client.query<ReconciliationRow>(
    `SELECT r.* FROM sf_migration.reconciliation_result r
      JOIN sf_migration.migration_batch b ON b.tenant_id = r.tenant_id AND b.batch_id = r.batch_id
      WHERE r.tenant_id = $1 AND r.project_id = $2
      ORDER BY r.created_at DESC LIMIT 1`,
    [tenantId, projectId],
  );
  return res.rows[0];
}
