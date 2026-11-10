import { trimChar } from '../forms/import';
import { autoLayout, newEdgeId } from './compile';
import {
  KIND_INFO,
  type Assignment,
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type WorkflowDesign,
} from './model';

/** Immutable canvas operations. Renaming a step id rewrites every path that uses it. */

const GRID = 8;

function snap(v: number): number {
  return Math.max(0, Math.round(v / GRID) * GRID);
}

export function uniqueNodeId(design: WorkflowDesign, base: string): string {
  let clean = trimChar(base.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), '_');
  let i = 0;
  while (i < clean.length && !((clean[i] ?? '') >= 'A' && (clean[i] ?? '') <= 'Z')) i += 1;
  clean = clean.slice(i, i + 56);
  const stem = clean.length > 0 ? clean : 'STEP';
  const taken = new Set(design.nodes.map((n) => n.id));
  if (!taken.has(stem)) return stem;
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${stem}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}_${Date.now().toString(36).toUpperCase()}`;
}

export function blankWorkflow(
  key = 'lab.new-service.case-flow',
  title = 'New case workflow',
): WorkflowDesign {
  return {
    key,
    title,
    version: '1.0.0',
    nodes: [
      { id: 'START', kind: 'START', label: 'Start', x: 40, y: 40 },
      { id: 'END', kind: 'END', label: 'End', x: 280, y: 40 },
    ],
    edges: [{ id: newEdgeId(), from: 'START', to: 'END' }],
  };
}

export function addNode(
  design: WorkflowDesign,
  kind: NodeKind,
  at?: { x: number; y: number },
): { design: WorkflowDesign; id: string } {
  const id = uniqueNodeId(design, kind === 'HUMAN_TASK' ? 'TASK' : kind);
  const maxX = Math.max(0, ...design.nodes.map((n) => n.x));
  const node: FlowNode = {
    id,
    kind,
    label: KIND_INFO[kind].label,
    x: snap(at?.x ?? maxX + 240),
    y: snap(at?.y ?? 40),
  };
  return { design: { ...design, nodes: [...design.nodes, node] }, id };
}

export function moveNode(design: WorkflowDesign, id: string, x: number, y: number): WorkflowDesign {
  return {
    ...design,
    nodes: design.nodes.map((n) => (n.id === id ? { ...n, x: snap(x), y: snap(y) } : n)),
  };
}

export function updateNode(
  design: WorkflowDesign,
  id: string,
  patch: { id?: string; label?: string; kind?: NodeKind; assignment?: Assignment | null },
): WorkflowDesign {
  const nextId = patch.id ?? id;
  return {
    ...design,
    nodes: design.nodes.map((n) => {
      if (n.id !== id) return n;
      const node: FlowNode = { ...n, id: nextId };
      if (patch.label !== undefined) node.label = patch.label;
      if (patch.kind !== undefined) node.kind = patch.kind;
      if (patch.assignment === null) delete node.assignment;
      else if (patch.assignment !== undefined) node.assignment = patch.assignment;
      return node;
    }),
    edges:
      nextId === id
        ? design.edges
        : design.edges.map((e) => ({
            ...e,
            from: e.from === id ? nextId : e.from,
            to: e.to === id ? nextId : e.to,
          })),
  };
}

export function removeNode(design: WorkflowDesign, id: string): WorkflowDesign {
  return {
    ...design,
    nodes: design.nodes.filter((n) => n.id !== id),
    edges: design.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function addEdge(
  design: WorkflowDesign,
  from: string,
  to: string,
  extra: { outcome?: string; ruleRef?: string } = {},
): { design: WorkflowDesign; id: string } {
  const edge: FlowEdge = { id: newEdgeId(), from, to, ...extra };
  return { design: { ...design, edges: [...design.edges, edge] }, id: edge.id };
}

export function updateEdge(
  design: WorkflowDesign,
  id: string,
  patch: { from?: string; to?: string; outcome?: string | null; ruleRef?: string | null },
): WorkflowDesign {
  return {
    ...design,
    edges: design.edges.map((e) => {
      if (e.id !== id) return e;
      const edge: FlowEdge = { ...e };
      if (patch.from !== undefined) edge.from = patch.from;
      if (patch.to !== undefined) edge.to = patch.to;
      if (patch.outcome === null || patch.outcome === '') delete edge.outcome;
      else if (patch.outcome !== undefined) edge.outcome = patch.outcome;
      if (patch.ruleRef === null || patch.ruleRef === '') delete edge.ruleRef;
      else if (patch.ruleRef !== undefined) edge.ruleRef = patch.ruleRef;
      return edge;
    }),
  };
}

export function removeEdge(design: WorkflowDesign, id: string): WorkflowDesign {
  return { ...design, edges: design.edges.filter((e) => e.id !== id) };
}

/** Re-runs the deterministic layered layout over the current graph. */
export function relayout(design: WorkflowDesign): WorkflowDesign {
  const positions = autoLayout(design.nodes, design.edges);
  return {
    ...design,
    nodes: design.nodes.map((n) => ({ ...n, ...(positions.get(n.id) ?? { x: n.x, y: n.y }) })),
  };
}
