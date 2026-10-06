import { Cmp016Error, invalid, reject } from '../errors.js';
import { RULE_REF_RE, type CanonicalWorkflowModel, type WorkflowGraph } from './model.js';
import {
  assertHashIntegrity,
  parseCanonicalModel,
  parseGraph,
  toCanonicalModel,
} from './validate.js';

export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type VersionOrigin = 'STUDIO' | 'BPMN_IMPORT';

export interface WorkflowVersionRecord {
  tenant_id: string;
  definition_id: string;
  version_id: string;
  version_no: number;
  status: VersionStatus;
  origin: VersionOrigin;
  model: CanonicalWorkflowModel;
  authored_by: string;
  published_by?: string;
  publication_approval_ref?: string;
  published_at?: string;
  retired_at?: string;
}

/** A published, hash-verified canonical version: the only thing the Temporal adapter runs. */
export interface ExecutableVersion {
  readonly tenant_id: string;
  readonly version_id: string;
  readonly model: CanonicalWorkflowModel;
  readonly executable: true;
}

/** Capability registry: only assertExecutable() mints executable versions (not forgeable by shape). */
const EXECUTABLE = new WeakSet<object>();

export function isExecutable(value: unknown): value is ExecutableVersion {
  return typeof value === 'object' && value !== null && EXECUTABLE.has(value);
}

export function newDraft(params: {
  tenant_id: string;
  definition_id: string;
  version_id: string;
  version_no: number;
  origin: VersionOrigin;
  authored_by: string;
  graph: unknown;
}): WorkflowVersionRecord {
  const graph: WorkflowGraph = parseGraph(params.graph);
  return {
    tenant_id: params.tenant_id,
    definition_id: params.definition_id,
    version_id: params.version_id,
    version_no: params.version_no,
    status: 'DRAFT',
    origin: params.origin,
    model: toCanonicalModel(params.version_id, graph),
    authored_by: params.authored_by,
  };
}

/** Edits are legal only on drafts. A published graph is never mutated in place (Constitution #8). */
export function reviseDraft(
  record: WorkflowVersionRecord,
  graphInput: unknown,
): WorkflowVersionRecord {
  if (record.status !== 'DRAFT') throw reject('PUBLISHED_VERSION_IMMUTABLE', '/status');
  const graph = parseGraph(graphInput);
  return { ...record, model: toCanonicalModel(record.version_id, graph) };
}

export function publish(
  record: WorkflowVersionRecord,
  approval: { approver_id: string; approval_ref: string; at: string },
): WorkflowVersionRecord {
  if (record.status !== 'DRAFT') throw reject('PUBLISHED_VERSION_IMMUTABLE', '/status');
  if (approval.approver_id === record.authored_by) {
    throw new Cmp016Error('SF-AUTH-002', [{ code: 'MAKER_CHECKER_SAME_PRINCIPAL' }]);
  }
  if (!RULE_REF_RE.test(approval.approval_ref))
    throw invalid('APPROVAL_REF_INVALID', '/approval_ref');
  const model = parseCanonicalModel(record.model);
  assertHashIntegrity(model);
  return {
    ...record,
    model,
    status: 'PUBLISHED',
    published_by: approval.approver_id,
    publication_approval_ref: approval.approval_ref,
    published_at: approval.at,
  };
}

export function retire(record: WorkflowVersionRecord, at: string): WorkflowVersionRecord {
  if (record.status !== 'PUBLISHED') throw reject('ILLEGAL_VERSION_TRANSITION', '/status');
  return { ...record, status: 'RETIRED', retired_at: at };
}

/**
 * Only PUBLISHED canonical versions whose graph_hash matches their graph are executable. Drafts,
 * BPMN-imported drafts and retired versions cannot start new Temporal executions.
 */
export function assertExecutable(record: WorkflowVersionRecord): ExecutableVersion {
  if (record.status !== 'PUBLISHED') throw reject('VERSION_NOT_PUBLISHED', '/status');
  const model = parseCanonicalModel(record.model);
  assertHashIntegrity(model);
  if (model.workflow_version_id !== record.version_id) {
    throw reject('PINNED_VERSION_MISMATCH', '/workflow_version_id');
  }
  const exe: ExecutableVersion = Object.freeze({
    tenant_id: record.tenant_id,
    version_id: record.version_id,
    model,
    executable: true as const,
  });
  EXECUTABLE.add(exe);
  return exe;
}
