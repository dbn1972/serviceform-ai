import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  applyResult,
  assertExecutable,
  isExecutable,
  migrateState,
  newDraft,
  publish,
  retire,
  reviseDraft,
  startInstance,
  validatePlan,
  type MigrationPlan,
  type WorkflowGraph,
  type WorkflowVersionRecord,
} from '../../src/index.js';
import { ACTOR, CHECKER, T1, V1, V2, linearGraph, richGraph } from '../fixtures/models.js';

const DEF = '44444444-4444-4444-8444-444444444444';
const AT = '2026-10-05T12:00:00.000Z';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code ?? err.code;
    throw err;
  }
  return undefined;
}

function draft(
  graph: WorkflowGraph = linearGraph(),
  versionId = V1,
  no = 1,
): WorkflowVersionRecord {
  return newDraft({
    tenant_id: T1,
    definition_id: DEF,
    version_id: versionId,
    version_no: no,
    origin: 'STUDIO',
    authored_by: ACTOR,
    graph,
  });
}

function published(graph?: WorkflowGraph, versionId = V1, no = 1): WorkflowVersionRecord {
  return publish(draft(graph, versionId, no), {
    approver_id: CHECKER,
    approval_ref: 'mc:approval:1',
    at: AT,
  });
}

describe('workflow versions: immutable once published (Constitution #8)', () => {
  it('drafts can be revised; published versions cannot be mutated', () => {
    const d = draft();
    const revised = reviseDraft(d, richGraph());
    expect(revised.model.graph_hash).not.toBe(d.model.graph_hash);
    const p = published();
    expect(p.status).toBe('PUBLISHED');
    expect(code(() => reviseDraft(p, richGraph()))).toBe('PUBLISHED_VERSION_IMMUTABLE');
    expect(code(() => publish(p, { approver_id: CHECKER, approval_ref: 'mc:2', at: AT }))).toBe(
      'PUBLISHED_VERSION_IMMUTABLE',
    );
  });

  it('publication is maker-checker: author cannot approve own version', () => {
    expect(code(() => publish(draft(), { approver_id: ACTOR, approval_ref: 'mc:1', at: AT }))).toBe(
      'MAKER_CHECKER_SAME_PRINCIPAL',
    );
    expect(
      code(() => publish(draft(), { approver_id: CHECKER, approval_ref: 'bad ref', at: AT })),
    ).toBe('APPROVAL_REF_INVALID');
  });

  it('publication rejects a draft whose stored graph no longer matches its hash', () => {
    const d = draft();
    const tampered = { ...d, model: { ...d.model, edges: [...d.model.edges].reverse() } };
    expect(
      code(() => publish(tampered, { approver_id: CHECKER, approval_ref: 'mc:1', at: AT })),
    ).toBe('GRAPH_HASH_MISMATCH');
  });

  it('retire is PUBLISHED -> RETIRED only; retired versions are not executable', () => {
    expect(code(() => retire(draft(), AT))).toBe('ILLEGAL_VERSION_TRANSITION');
    const r = retire(published(), AT);
    expect(r.status).toBe('RETIRED');
    expect(code(() => retire(r, AT))).toBe('ILLEGAL_VERSION_TRANSITION');
    expect(code(() => assertExecutable(r))).toBe('VERSION_NOT_PUBLISHED');
  });

  it('only published, hash-verified versions mint the executable capability', () => {
    expect(code(() => assertExecutable(draft()))).toBe('VERSION_NOT_PUBLISHED');
    const exe = assertExecutable(published());
    expect(isExecutable(exe)).toBe(true);
    expect(Object.isFrozen(exe)).toBe(true);
    expect(isExecutable({ ...exe })).toBe(false);
    const p = published();
    expect(code(() => assertExecutable({ ...p, version_id: V2 }))).toBe('PINNED_VERSION_MISMATCH');
  });
});

describe('in-flight migration: explicit, approved, safe boundary (Constitution #35)', () => {
  const v1 = () => assertExecutable(published(richGraph(), V1, 1));
  const v2Graph = (): WorkflowGraph => {
    const g = richGraph();
    g.nodes = g.nodes.map((n) => (n.node_id === 'SCRUTINY' ? { ...n, node_id: 'SCRUTINY_V2' } : n));
    g.edges = g.edges.map((e) => ({
      ...e,
      from_node: e.from_node === 'SCRUTINY' ? 'SCRUTINY_V2' : e.from_node,
      to_node: e.to_node === 'SCRUTINY' ? 'SCRUTINY_V2' : e.to_node,
    }));
    return g;
  };
  const v2 = () => assertExecutable(published(v2Graph(), V2, 2));
  const plan = (over: Partial<MigrationPlan> = {}): MigrationPlan => ({
    migration_id: '55555555-5555-4555-8555-555555555555',
    tenant_id: T1,
    from_version_id: V1,
    to_version_id: V2,
    node_mapping: { SCRUTINY: 'SCRUTINY_V2', SLA_TIMER: 'SLA_TIMER' },
    approval_ref: 'mc:migration:1',
    simulation_evidence_ref: 'evidence/simulation/run-1',
    requested_by: ACTOR,
    approved_by: CHECKER,
    ...over,
  });

  it('validates mapping, approval and maker-checker', () => {
    expect(validatePlan(plan(), v1(), v2())).toBeTruthy();
    expect(code(() => validatePlan(plan({ approved_by: ACTOR }), v1(), v2()))).toBe(
      'MAKER_CHECKER_SAME_PRINCIPAL',
    );
    expect(code(() => validatePlan(plan({ approval_ref: '' }), v1(), v2()))).toBe(
      'SILENT_REPOINT_FORBIDDEN',
    );
    expect(code(() => validatePlan(plan({ simulation_evidence_ref: '' }), v1(), v2()))).toBe(
      'SILENT_REPOINT_FORBIDDEN',
    );
    expect(code(() => validatePlan(plan({ to_version_id: V1 }), v1(), v2()))).toBe(
      'MIGRATION_SAME_VERSION',
    );
    expect(code(() => validatePlan(plan({ node_mapping: { SCRUTINY: 'NOPE' } }), v1(), v2()))).toBe(
      'MIGRATION_MAPPING_UNKNOWN_NODE',
    );
    expect(
      code(() => validatePlan(plan({ node_mapping: { SCRUTINY: 'SLA_TIMER' } }), v1(), v2())),
    ).toBe('MIGRATION_MAPPING_KIND_CHANGE');
    expect(code(() => validatePlan(plan({ node_mapping: { bad: 'x' } }), v1(), v2()))).toBe(
      'MIGRATION_MAPPING_INVALID',
    );
    expect(
      code(() => validatePlan(plan({ from_version_id: V2, to_version_id: V1 }), v1(), v2())),
    ).toBe('MIGRATION_VERSION_MISMATCH');
  });

  it('refuses to migrate outside a safe boundary', () => {
    const from = v1();
    const s0 = startInstance(from.model);
    expect(code(() => migrateState(s0.state, plan(), from, v2()))).toBe(
      'MIGRATION_NOT_AT_SAFE_BOUNDARY',
    );
  });

  it('re-pins waiting tokens and re-issues tasks/timers for renamed nodes', () => {
    const from = v1();
    const s0 = startInstance(from.model);
    const s1 = applyResult(from.model, s0.state, {
      node_id: 'ELIGIBILITY',
      kind: 'RULE',
      outcome: 'ELIGIBLE',
    });
    const to = v2();
    const m = migrateState(s1.state, plan(), from, to);
    expect(m.state.workflow_version_id).toBe(V2);
    expect(m.state.graph_hash).toBe(to.model.graph_hash);
    expect(m.state.tokens.map((t) => t.node_id).sort()).toEqual(['SCRUTINY_V2', 'SLA_TIMER']);
    expect(m.effects.map((e) => `${e.type}:${'node_id' in e ? e.node_id : ''}`)).toEqual([
      'CLOSE_HUMAN_TASK:SCRUTINY',
      'CREATE_HUMAN_TASK:SCRUTINY_V2',
    ]);
    expect(
      code(() =>
        migrateState(s1.state, plan({ node_mapping: { SCRUTINY: 'SCRUTINY_V2' } }), from, to),
      ),
    ).toBe('MIGRATION_UNMAPPED_ACTIVE_NODE');
    expect(code(() => migrateState(m.state, plan(), from, to))).toBe('MIGRATION_VERSION_MISMATCH');
  });
});
