import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  assertHashIntegrity,
  canonicalJson,
  graphHash,
  parseCanonicalModel,
  parseGraph,
  toCanonicalModel,
  type WorkflowGraph,
} from '../../src/index.js';
import { ASSIGN, V1, frozenExample, linearGraph, model, richGraph } from '../fixtures/models.js';

function detail(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code;
    throw err;
  }
  return undefined;
}

function mutate(fn: (g: WorkflowGraph) => void): WorkflowGraph {
  const g = structuredClone(richGraph());
  fn(g);
  return g;
}

describe('canonical workflow model validation (SF-CON-WORKFLOW-MODEL)', () => {
  it('accepts the FROZEN valid example', () => {
    const m = parseCanonicalModel(frozenExample('valid', 'workflow-model'));
    expect(m.runtime).toBe('TEMPORAL');
    expect(m.bpmn_role).toBe('IMPORT_EXPORT_PROFILE_ONLY');
    expect(m.nodes.map((n) => n.kind)).toContain('WITHDRAWAL_REVIEW');
  });

  it('rejects the FROZEN bpmn-as-runtime example (BPMN is not a second runtime)', () => {
    expect(
      detail(() => parseCanonicalModel(frozenExample('invalid', 'workflow-model.bpmn-as-runtime'))),
    ).toBe('BPMN_RUNTIME_FORBIDDEN');
  });

  it('rejects the FROZEN named-officer example (Constitution #19)', () => {
    expect(
      detail(() => parseCanonicalModel(frozenExample('invalid', 'workflow-model.named-officer'))),
    ).toBe('NAMED_OFFICER_FORBIDDEN');
  });

  it.each([
    ['officer_id', '99999999-9999-4999-8999-999999999999'],
    ['assignee', 'someone'],
    ['user_id', '99999999-9999-4999-8999-999999999999'],
    ['email', 'someone@example.invalid'],
    ['principal_id', '99999999-9999-4999-8999-999999999999'],
  ])('rejects named assignee field %s', (field, value) => {
    const g = mutate((x) => {
      (x.nodes[3]?.assignment as unknown as Record<string, string>)[field] = value;
    });
    expect(detail(() => parseGraph(g))).toBe('NAMED_OFFICER_FORBIDDEN');
  });

  it('requires role + organisation + jurisdiction on HUMAN_TASK', () => {
    expect(detail(() => parseGraph(mutate((g) => delete g.nodes[3]?.assignment)))).toBe(
      'HUMAN_TASK_ASSIGNMENT_REQUIRED',
    );
    const noJurisdiction = mutate((g) => {
      const a = { ...ASSIGN } as Partial<typeof ASSIGN>;
      delete a.jurisdiction_id;
      (g.nodes[3] as { assignment: unknown }).assignment = a;
    });
    expect(detail(() => parseGraph(noJurisdiction))).toBe('ASSIGNMENT_JURISDICTION_REQUIRED');
    const noRole = mutate((g) => {
      (g.nodes[3] as { assignment: unknown }).assignment = { ...ASSIGN, role_code: 'x' };
    });
    expect(detail(() => parseGraph(noRole))).toBe('ASSIGNMENT_ROLE_REQUIRED');
    const noOrg = mutate((g) => {
      (g.nodes[3] as { assignment: unknown }).assignment = { ...ASSIGN, organisation_id: 'x' };
    });
    expect(detail(() => parseGraph(noOrg))).toBe('ASSIGNMENT_ORGANISATION_REQUIRED');
  });

  it.each<[string, (g: WorkflowGraph) => void]>([
    ['NODE_ID_DUPLICATE', (g) => g.nodes.push({ node_id: 'END', kind: 'END' })],
    ['EXACTLY_ONE_START_REQUIRED', (g) => g.nodes.push({ node_id: 'START2', kind: 'START' })],
    [
      'EDGE_UNKNOWN_NODE',
      (g) => g.edges.push({ from_node: 'ROUTE', to_node: 'NOPE', outcome: 'X1' }),
    ],
    [
      'EDGE_SELF_LOOP',
      (g) => g.edges.push({ from_node: 'ROUTE', to_node: 'ROUTE', outcome: 'X1' }),
    ],
    ['END_HAS_OUTGOING', (g) => g.edges.push({ from_node: 'END', to_node: 'ROUTE' })],
    ['PORT_NODE_MUST_BE_PORT_ONLY', (g) => delete g.nodes[5]?.port_only],
    [
      'PORT_ONLY_ON_NON_PORT_NODE',
      (g) => ((g.nodes[7] as { port_only?: boolean }).port_only = true),
    ],
    ['PARALLEL_EDGES_UNCONDITIONAL', (g) => ((g.edges[3] as { outcome?: string }).outcome = 'GO')],
    [
      'CHOICE_MULTIPLE_DEFAULTS',
      (g) => g.edges.push({ from_node: 'ROUTE', to_node: 'ISSUE_PORT' }),
    ],
    [
      'CHOICE_OUTCOME_DUPLICATE',
      (g) => g.edges.push({ from_node: 'SCRUTINY', to_node: 'END', outcome: 'ADMIN_CANCEL' }),
    ],
    ['REQUEST_REQUIRES_REVIEW', (g) => ((g.edges[10] as { to_node: string }).to_node = 'SCRUTINY')],
    [
      'RULE_GATE_RULE_REF_REQUIRED',
      (g) => g.edges.slice(1, 3).forEach((e) => delete e.condition_rule_ref),
    ],
    [
      'ROUTING_RULE_REF_AMBIGUOUS',
      (g) => ((g.edges[2] as { condition_rule_ref: string }).condition_rule_ref = 'other'),
    ],
    [
      'NODE_UNREACHABLE',
      (g) => {
        g.nodes.push({ node_id: 'ORPHAN', kind: 'WAIT' });
        g.edges.push({ from_node: 'ORPHAN', to_node: 'END' });
      },
    ],
    [
      'DEAD_END_NODE',
      (g) => {
        g.nodes.push({ node_id: 'STUCK', kind: 'WAIT' });
        g.edges.push({ from_node: 'ROUTE', to_node: 'STUCK', outcome: 'STUCK' });
      },
    ],
    ['START_SINGLE_OUTGOING', (g) => g.edges.push({ from_node: 'START', to_node: 'END' })],
    ['UNKNOWN_FIELD', (g) => ((g.nodes[0] as unknown as Record<string, unknown>)['script'] = 'x')],
    ['NODE_KIND_INVALID', (g) => ((g.nodes[1] as { kind: string }).kind = 'SCRIPT_TASK')],
    ['EDGE_OUTCOME_INVALID', (g) => ((g.edges[0] as { outcome?: string }).outcome = 'lower')],
  ])('rejects %s', (code, fn) => {
    expect(detail(() => parseGraph(mutate(fn)))).toBe(code);
  });

  it('rejects a cycle with no path to END', () => {
    const g: WorkflowGraph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'A', kind: 'WAIT' },
        { node_id: 'B', kind: 'WAIT' },
        { node_id: 'C', kind: 'WAIT' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'A' },
        { from_node: 'A', to_node: 'END', outcome: 'DONE' },
        { from_node: 'A', to_node: 'B', outcome: 'NEXT' },
        { from_node: 'B', to_node: 'C', outcome: 'NEXT' },
        { from_node: 'C', to_node: 'B', outcome: 'BACK' },
      ],
    };
    expect(detail(() => parseGraph(g))).toBe('NODE_CANNOT_REACH_END');
  });

  it('bounds graph size and shape', () => {
    expect(detail(() => parseGraph(null))).toBe('GRAPH_INVALID');
    expect(detail(() => parseGraph({ nodes: [], edges: [] }))).toBe('NODES_INVALID');
    expect(detail(() => parseGraph({ nodes: linearGraph().nodes, edges: [] }))).toBe(
      'EDGES_INVALID',
    );
  });

  it('computes a stable graph_hash independent of key order and verifies integrity', () => {
    const g = linearGraph();
    const reordered = JSON.parse(canonicalJson(g)) as WorkflowGraph;
    expect(graphHash(reordered)).toBe(graphHash(g));
    const m = toCanonicalModel(V1, g);
    expect(m.graph_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => assertHashIntegrity(m)).not.toThrow();
    const tampered = {
      ...m,
      edges: [{ ...m.edges[1], outcome: 'REJECT' }, m.edges[0]],
    } as typeof m;
    expect(detail(() => assertHashIntegrity(tampered as never))).toBe('GRAPH_HASH_MISMATCH');
  });

  it('rejects model envelope tampering', () => {
    const m = model() as unknown as Record<string, unknown>;
    expect(detail(() => parseCanonicalModel({ ...m, immutable: false }))).toBe(
      'MODEL_CONSTANT_INVALID',
    );
    expect(detail(() => parseCanonicalModel({ ...m, owner_component: 'CMP-015' }))).toBe(
      'MODEL_CONSTANT_INVALID',
    );
    expect(detail(() => parseCanonicalModel({ ...m, bpmn_role: 'RUNTIME' }))).toBe(
      'BPMN_RUNTIME_FORBIDDEN',
    );
    expect(detail(() => parseCanonicalModel({ ...m, workflow_version_id: 'x' }))).toBe(
      'WORKFLOW_VERSION_ID_INVALID',
    );
    expect(detail(() => parseCanonicalModel({ ...m, graph_hash: 'md5:x' }))).toBe(
      'GRAPH_HASH_INVALID',
    );
    expect(detail(() => parseCanonicalModel({ ...m, extra: 1 }))).toBe('UNKNOWN_FIELD');
    expect(detail(() => parseCanonicalModel('x'))).toBe('MODEL_INVALID');
  });
});
