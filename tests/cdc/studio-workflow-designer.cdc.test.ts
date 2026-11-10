import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  graphHash,
  NODE_KINDS,
  parseGraph,
  type WorkflowGraph,
} from '../../services/cmp-016-workflow-engine/src/index.js';
import {
  linearGraph,
  richGraph,
} from '../../services/cmp-016-workflow-engine/test/fixtures/models.js';
import * as designerModule from '../../packages/studio-designers/src/workflow/index.js';

interface DesignerWorkflowModule {
  NODE_KINDS: readonly string[];
  importWorkflow(graph: unknown, meta: { key: string; title: string; version: string }): unknown;
  compileWorkflow(design: unknown): WorkflowGraph;
  workflowGraphHash(graph: unknown): Promise<string>;
  lintWorkflow(design: unknown): { code: string; severity: string }[];
  caseSequencingGraph(): WorkflowGraph;
}

const designer = designerModule as unknown as DesignerWorkflowModule;

function cmp016Code(graph: WorkflowGraph): string | null {
  try {
    parseGraph(graph);
    return null;
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code ?? err.code;
    throw err;
  }
}

function designerErrors(graph: WorkflowGraph): string[] {
  const design = designer.importWorkflow(graph, {
    key: 'lab.compat.flow',
    title: 'Compat',
    version: '1.0.0',
  });
  return designer
    .lintWorkflow(design)
    .filter((i) => i.severity === 'error')
    .map((i) => i.code);
}

const BROKEN: [string, WorkflowGraph][] = [
  [
    'two starts',
    {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'S2', kind: 'START' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'END' },
        { from_node: 'S2', to_node: 'END' },
      ],
    },
  ],
  [
    'dead end',
    {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'W', kind: 'WAIT' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [{ from_node: 'START', to_node: 'W' }],
    },
  ],
  [
    'unconditional parallel',
    {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'P', kind: 'PARALLEL' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'P' },
        { from_node: 'P', to_node: 'END', outcome: 'GO' },
      ],
    },
  ],
  [
    'rule gate without rule',
    {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'G', kind: 'RULE_GATE' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'G' },
        { from_node: 'G', to_node: 'END' },
      ],
    },
  ],
  [
    'request without review',
    {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'R', kind: 'WITHDRAWAL_REQUEST' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'R' },
        { from_node: 'R', to_node: 'END' },
      ],
    },
  ],
  [
    'duplicate outcome',
    {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'D', kind: 'DECISION' },
        { node_id: 'E1', kind: 'END' },
        { node_id: 'E2', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'D' },
        { from_node: 'D', to_node: 'E1', outcome: 'GO' },
        { from_node: 'D', to_node: 'E2', outcome: 'GO' },
      ],
    },
  ],
];

// REQ: Phase C-2 consumer-driven contract — the Studio workflow designer (consumer) emits exactly
// what CMP-016 (provider) validates and hashes; both refuse the same broken graphs.
describe('Studio workflow designer against CMP-016', () => {
  it('uses the FROZEN node kinds', () => {
    expect([...designer.NODE_KINDS]).toEqual([...NODE_KINDS]);
  });

  it.each([
    ['linear', linearGraph()],
    ['rich', richGraph()],
    ['case sequencing', designer.caseSequencingGraph()],
  ])(
    'round-trips the %s graph with the same graph_hash and no designer errors',
    async (_n, graph) => {
      const design = designer.importWorkflow(graph, {
        key: 'lab.compat.flow',
        title: 'Compat',
        version: '1.0.0',
      });
      const compiled = designer.compileWorkflow(design);
      expect(parseGraph(compiled)).toEqual(parseGraph(graph));
      expect(await designer.workflowGraphHash(compiled)).toBe(graphHash(graph));
      expect(designerErrors(graph)).toEqual([]);
    },
  );

  it.each(BROKEN)('designer and CMP-016 both refuse: %s', (_n, graph) => {
    const code = cmp016Code(graph);
    expect(code).not.toBeNull();
    expect(designerErrors(graph)).toContain(code);
  });
});
