import { Cmp016Error, invalid, reject } from '../errors.js';
import { NODE_ID_RE, nodeIndex, type CanonicalWorkflowModel } from './model.js';
import { atSafeBoundary, type Effect, type InstanceState } from './interpreter.js';
import type { ExecutableVersion } from './versioning.js';

/**
 * Explicit in-flight migration (Constitution #35): simulated, maker-checker approved and
 * evidence-backed. A running instance is never silently repointed to a new version.
 */
export interface MigrationPlan {
  migration_id: string;
  tenant_id: string;
  from_version_id: string;
  to_version_id: string;
  node_mapping: Record<string, string>;
  approval_ref: string;
  simulation_evidence_ref: string;
  requested_by: string;
  approved_by: string;
}

export interface MigrationTarget {
  version_id: string;
  model: CanonicalWorkflowModel;
}

export function validatePlan(
  plan: MigrationPlan,
  from: { model: CanonicalWorkflowModel },
  to: ExecutableVersion | MigrationTarget,
): MigrationPlan {
  if (plan.from_version_id === plan.to_version_id) throw invalid('MIGRATION_SAME_VERSION');
  if (plan.requested_by === plan.approved_by) {
    throw new Cmp016Error('SF-AUTH-002', [{ code: 'MAKER_CHECKER_SAME_PRINCIPAL' }]);
  }
  if (!plan.approval_ref || !plan.simulation_evidence_ref) {
    throw reject('SILENT_REPOINT_FORBIDDEN', '/approval_ref');
  }
  if (
    from.model.workflow_version_id !== plan.from_version_id ||
    to.version_id !== plan.to_version_id
  ) {
    throw reject('MIGRATION_VERSION_MISMATCH');
  }
  const fromNodes = nodeIndex(from.model);
  const toNodes = nodeIndex(to.model);
  for (const [src, dst] of Object.entries(plan.node_mapping)) {
    if (!NODE_ID_RE.test(src) || !NODE_ID_RE.test(dst)) throw invalid('MIGRATION_MAPPING_INVALID');
    const a = fromNodes.get(src);
    const b = toNodes.get(dst);
    if (!a || !b) throw invalid('MIGRATION_MAPPING_UNKNOWN_NODE', `/node_mapping/${src}`);
    if (a.kind !== b.kind) throw invalid('MIGRATION_MAPPING_KIND_CHANGE', `/node_mapping/${src}`);
  }
  return plan;
}

/** Re-pins the instance state; only at a safe boundary and only for mapped waiting nodes. */
export function migrateState(
  state: InstanceState,
  plan: MigrationPlan,
  from: { model: CanonicalWorkflowModel },
  to: ExecutableVersion | MigrationTarget,
): { state: InstanceState; effects: Effect[] } {
  if (state.workflow_version_id !== plan.from_version_id)
    throw reject('MIGRATION_VERSION_MISMATCH');
  if (!atSafeBoundary(state)) throw reject('MIGRATION_NOT_AT_SAFE_BOUNDARY');
  const fromNodes = nodeIndex(from.model);
  const toNodes = nodeIndex(to.model);
  const effects: Effect[] = [];
  const tokens = state.tokens.map((t) => {
    const target = plan.node_mapping[t.node_id];
    if (!target) throw reject('MIGRATION_UNMAPPED_ACTIVE_NODE', `/node_mapping/${t.node_id}`);
    const before = fromNodes.get(t.node_id);
    const after = toNodes.get(target);
    if (!before || !after) throw reject('MIGRATION_MAPPING_UNKNOWN_NODE');
    const sameAssignment = JSON.stringify(before.assignment) === JSON.stringify(after.assignment);
    const changed = target !== t.node_id || !sameAssignment;
    if (before.assignment && changed) {
      effects.push({ type: 'CLOSE_HUMAN_TASK', node_id: t.node_id, token_id: t.token_id });
    }
    if (after.assignment && changed) {
      effects.push({
        type: 'CREATE_HUMAN_TASK',
        node_id: target,
        token_id: t.token_id,
        assignment: after.assignment,
      });
    }
    if (t.wait === 'TIMER' && target !== t.node_id) {
      effects.push({ type: 'CANCEL_TIMER', node_id: t.node_id, token_id: t.token_id });
      effects.push({ type: 'START_TIMER', node_id: target, token_id: t.token_id });
    }
    return { ...t, node_id: target };
  });
  return {
    state: {
      ...structuredClone(state),
      workflow_version_id: to.version_id,
      graph_hash: to.model.graph_hash,
      tokens,
    },
    effects,
  };
}
