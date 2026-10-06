import type { CanonicalWorkflowModel } from '../domain/model.js';
import type { MigrationPlan } from '../domain/migration.js';
import type { WorkflowVersionRecord } from '../domain/versioning.js';
import type { SqlClient } from '../db/tx.js';

/**
 * CMP-016 repository. Every statement targets sf_workflow only; there is no SQL against another
 * component's schema (Constitution #23, ADR-0006 condition 7). RLS scopes every row to the
 * transaction-local tenant.
 */

export type InstanceStatus = 'RUNNING' | 'COMPLETED' | 'TERMINATED' | 'FAULTED';

export interface InstanceRow {
  instance_id: string;
  tenant_id: string;
  application_id: string;
  workflow_version_id: string;
  graph_hash: string;
  temporal_workflow_id: string;
  status: InstanceStatus;
  active_nodes: string[];
  last_signal_id: string | null;
  migration_id: string | null;
}

export interface RequestRow {
  request_id: string;
  tenant_id: string;
  instance_id: string;
  application_id: string;
  request_kind: 'WITHDRAWAL' | 'CANCELLATION';
  request_node_id: string;
  outcome: string;
  status: 'PENDING_REVIEW' | 'REJECTED' | 'EXPIRED' | 'RESOLVED';
  requested_by: string;
  idempotency_key: string;
}

interface VersionDbRow {
  tenant_id: string;
  definition_id: string;
  version_id: string;
  version_no: number;
  status: WorkflowVersionRecord['status'];
  origin: WorkflowVersionRecord['origin'];
  model: CanonicalWorkflowModel;
  authored_by: string;
  published_by: string | null;
  publication_approval_ref: string | null;
  published_at: Date | string | null;
  retired_at: Date | string | null;
}

function iso(v: Date | string | null): string | undefined {
  if (v === null) return undefined;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toVersion(r: VersionDbRow): WorkflowVersionRecord {
  const rec: WorkflowVersionRecord = {
    tenant_id: r.tenant_id,
    definition_id: r.definition_id,
    version_id: r.version_id,
    version_no: r.version_no,
    status: r.status,
    origin: r.origin,
    model: r.model,
    authored_by: r.authored_by,
  };
  if (r.published_by) rec.published_by = r.published_by;
  if (r.publication_approval_ref) rec.publication_approval_ref = r.publication_approval_ref;
  const pub = iso(r.published_at);
  if (pub) rec.published_at = pub;
  const ret = iso(r.retired_at);
  if (ret) rec.retired_at = ret;
  return rec;
}

const SELECT_VERSION = `SELECT tenant_id, definition_id, version_id, version_no, status, origin, model,
  authored_by, published_by, publication_approval_ref, published_at, retired_at
  FROM sf_workflow.workflow_version WHERE version_id = $1`;
const SELECT_VERSION_FOR_UPDATE = `${SELECT_VERSION} FOR UPDATE`;

export async function insertDefinition(
  c: SqlClient,
  d: {
    definition_id: string;
    tenant_id: string;
    cell_id: string;
    definition_key: string;
    created_by: string;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO sf_workflow.workflow_definition (definition_id, tenant_id, cell_id, definition_key, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [d.definition_id, d.tenant_id, d.cell_id, d.definition_key, d.created_by],
  );
}

export async function definitionExists(c: SqlClient, definitionId: string): Promise<boolean> {
  const r = await c.query(
    'SELECT 1 FROM sf_workflow.workflow_definition WHERE definition_id = $1',
    [definitionId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function nextVersionNo(c: SqlClient, definitionId: string): Promise<number> {
  const r = await c.query<{ n: number }>(
    'SELECT COALESCE(MAX(version_no), 0)::int + 1 AS n FROM sf_workflow.workflow_version WHERE definition_id = $1',
    [definitionId],
  );
  return r.rows[0]?.n ?? 1;
}

export async function insertVersion(c: SqlClient, v: WorkflowVersionRecord): Promise<void> {
  await c.query(
    `INSERT INTO sf_workflow.workflow_version (
       version_id, tenant_id, definition_id, version_no, status, origin, model, graph_hash, authored_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      v.version_id,
      v.tenant_id,
      v.definition_id,
      v.version_no,
      v.status,
      v.origin,
      JSON.stringify(v.model),
      v.model.graph_hash,
      v.authored_by,
    ],
  );
}

export async function getVersion(
  c: SqlClient,
  versionId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<WorkflowVersionRecord | null> {
  const r = await c.query<VersionDbRow>(
    opts.forUpdate ? SELECT_VERSION_FOR_UPDATE : SELECT_VERSION,
    [versionId],
  );
  const row = r.rows[0];
  return row ? toVersion(row) : null;
}

export async function updateDraftModel(c: SqlClient, v: WorkflowVersionRecord): Promise<void> {
  await c.query(
    `UPDATE sf_workflow.workflow_version SET model = $2::jsonb, graph_hash = $3
      WHERE version_id = $1 AND status = 'DRAFT'`,
    [v.version_id, JSON.stringify(v.model), v.model.graph_hash],
  );
}

export async function markPublished(c: SqlClient, v: WorkflowVersionRecord): Promise<void> {
  await c.query(
    `UPDATE sf_workflow.workflow_version
        SET status = 'PUBLISHED', model = $2::jsonb, graph_hash = $3, published_by = $4,
            publication_approval_ref = $5, published_at = $6
      WHERE version_id = $1 AND status = 'DRAFT'`,
    [
      v.version_id,
      JSON.stringify(v.model),
      v.model.graph_hash,
      v.published_by,
      v.publication_approval_ref,
      v.published_at,
    ],
  );
}

export async function markRetired(c: SqlClient, v: WorkflowVersionRecord): Promise<void> {
  await c.query(
    `UPDATE sf_workflow.workflow_version SET status = 'RETIRED', retired_at = $2
      WHERE version_id = $1 AND status = 'PUBLISHED'`,
    [v.version_id, v.retired_at],
  );
}

export async function insertMigrationPlan(c: SqlClient, p: MigrationPlan): Promise<void> {
  await c.query(
    `INSERT INTO sf_workflow.migration_plan (
       migration_id, tenant_id, from_version_id, to_version_id, node_mapping, approval_ref,
       simulation_evidence_ref, requested_by, approved_by
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
    [
      p.migration_id,
      p.tenant_id,
      p.from_version_id,
      p.to_version_id,
      JSON.stringify(p.node_mapping),
      p.approval_ref,
      p.simulation_evidence_ref,
      p.requested_by,
      p.approved_by,
    ],
  );
}

export async function getMigrationPlan(
  c: SqlClient,
  migrationId: string,
): Promise<MigrationPlan | null> {
  const r = await c.query<MigrationPlan>(
    `SELECT migration_id, tenant_id, from_version_id, to_version_id, node_mapping, approval_ref,
            simulation_evidence_ref, requested_by, approved_by
       FROM sf_workflow.migration_plan WHERE migration_id = $1`,
    [migrationId],
  );
  return r.rows[0] ?? null;
}

const SELECT_INSTANCE = `SELECT instance_id, tenant_id, application_id, workflow_version_id, graph_hash,
  temporal_workflow_id, status, active_nodes, last_signal_id, migration_id
  FROM sf_workflow.workflow_instance WHERE application_id = $1`;
const SELECT_INSTANCE_FOR_UPDATE = `${SELECT_INSTANCE} FOR UPDATE`;

export async function insertInstance(
  c: SqlClient,
  i: Omit<InstanceRow, 'last_signal_id' | 'migration_id'> & { cell_id: string },
): Promise<void> {
  await c.query(
    `INSERT INTO sf_workflow.workflow_instance (
       instance_id, tenant_id, cell_id, application_id, workflow_version_id, graph_hash,
       temporal_workflow_id, status, active_nodes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      i.instance_id,
      i.tenant_id,
      i.cell_id,
      i.application_id,
      i.workflow_version_id,
      i.graph_hash,
      i.temporal_workflow_id,
      i.status,
      JSON.stringify(i.active_nodes),
    ],
  );
}

export async function getInstanceByApplication(
  c: SqlClient,
  applicationId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<InstanceRow | null> {
  const r = await c.query<InstanceRow>(
    opts.forUpdate ? SELECT_INSTANCE_FOR_UPDATE : SELECT_INSTANCE,
    [applicationId],
  );
  return r.rows[0] ?? null;
}

export async function updateInstanceProgress(
  c: SqlClient,
  p: {
    instance_id: string;
    status: InstanceStatus;
    active_nodes: string[];
    last_signal_id: string | null;
  },
): Promise<void> {
  await c.query(
    `UPDATE sf_workflow.workflow_instance
        SET status = $2, active_nodes = $3::jsonb, last_signal_id = $4, updated_at = now()
      WHERE instance_id = $1`,
    [p.instance_id, p.status, JSON.stringify(p.active_nodes), p.last_signal_id],
  );
}

export async function repointInstance(
  c: SqlClient,
  p: { instance_id: string; workflow_version_id: string; graph_hash: string; migration_id: string },
): Promise<void> {
  await c.query(
    `UPDATE sf_workflow.workflow_instance
        SET workflow_version_id = $2, graph_hash = $3, migration_id = $4, updated_at = now()
      WHERE instance_id = $1`,
    [p.instance_id, p.workflow_version_id, p.graph_hash, p.migration_id],
  );
}

export async function insertRequest(c: SqlClient, r: RequestRow): Promise<void> {
  await c.query(
    `INSERT INTO sf_workflow.workflow_request (
       request_id, tenant_id, instance_id, application_id, request_kind, request_node_id, outcome,
       status, requested_by, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      r.request_id,
      r.tenant_id,
      r.instance_id,
      r.application_id,
      r.request_kind,
      r.request_node_id,
      r.outcome,
      r.status,
      r.requested_by,
      r.idempotency_key,
    ],
  );
}

export async function findRequestByKey(
  c: SqlClient,
  applicationId: string,
  idempotencyKey: string,
): Promise<RequestRow | null> {
  const r = await c.query<RequestRow>(
    `SELECT request_id, tenant_id, instance_id, application_id, request_kind, request_node_id, outcome,
            status, requested_by, idempotency_key
       FROM sf_workflow.workflow_request WHERE application_id = $1 AND idempotency_key = $2`,
    [applicationId, idempotencyKey],
  );
  return r.rows[0] ?? null;
}

/** SF-CON-OUTBOX rule 5: false when this consumer group already applied the event. */
export async function recordInbox(
  c: SqlClient,
  p: { consumer_group: string; event_id: string; tenant_id: string },
): Promise<boolean> {
  const r = await c.query(
    `INSERT INTO sf_workflow.inbox_event (consumer_group, event_id, tenant_id)
     VALUES ($1, $2, $3) ON CONFLICT (consumer_group, event_id) DO NOTHING`,
    [p.consumer_group, p.event_id, p.tenant_id],
  );
  return (r.rowCount ?? 0) === 1;
}
