import { contentHash } from '../hash';
import {
  isPort,
  sizeOf,
  type CanonicalEdge,
  type CanonicalGraph,
  type CanonicalNode,
  type FlowEdge,
  type FlowNode,
  type WorkflowDesign,
} from './model';

/**
 * Canonical graph in authoring order. Node and edge order is part of CMP-016's graph_hash, so the
 * same design always yields the same hash; layout and labels are not part of it.
 */
export function compileWorkflow(design: WorkflowDesign): CanonicalGraph {
  const nodes = design.nodes.map((n): CanonicalNode => {
    const node: CanonicalNode = { node_id: n.id, kind: n.kind };
    if (n.assignment) node.assignment = { ...n.assignment };
    if (isPort(n.kind)) node.port_only = true;
    return node;
  });
  const edges = design.edges.map((e): CanonicalEdge => {
    const edge: CanonicalEdge = { from_node: e.from, to_node: e.to };
    if (e.ruleRef) edge.condition_rule_ref = e.ruleRef;
    if (e.outcome) edge.outcome = e.outcome;
    return edge;
  });
  return { nodes, edges };
}

/** CMP-016 `graphHash`: SHA-256 of the canonical JSON of `{nodes, edges}`. */
export function workflowGraphHash(graph: CanonicalGraph): Promise<string> {
  return contentHash({ nodes: graph.nodes, edges: graph.edges });
}

const GAP_X = 152;
const ROW = 120;
const ROW_BOX = 80;
const MARGIN = 40;

/** Edges that close a cycle in a depth-first walk from START (deficiency loops, returns). */
function backEdges(
  ids: readonly string[],
  edges: readonly { from: string; to: string }[],
  start: string | undefined,
): Set<number> {
  const back = new Set<number>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    edges.forEach((e, i) => {
      if (e.from !== id) return;
      const s = state.get(e.to);
      if (s === 'open') back.add(i);
      else if (s === undefined) visit(e.to);
    });
    state.set(id, 'done');
  };
  if (start) visit(start);
  for (const id of ids) if (!state.has(id)) visit(id);
  return back;
}

/**
 * Layered (Sugiyama-style) layout: back edges are ignored, columns are the longest forward path
 * from START, rows follow the average row of each step's predecessors. Deterministic, so imports
 * and BPMN round trips always look the same; the result is layout only, never hashed.
 */
export function autoLayout<T extends { id: string; kind: FlowNode['kind'] }>(
  nodes: readonly T[],
  edges: readonly { from: string; to: string }[],
): Map<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const start = nodes.find((n) => n.kind === 'START')?.id ?? ids[0];
  const back = backEdges(ids, edges, start);
  const forward = edges.filter((e, i) => !back.has(i) && e.from !== e.to);
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of forward) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const e of forward) {
      if (e.from !== id) continue;
      layer.set(e.to, Math.max(layer.get(e.to) ?? 0, (layer.get(id) ?? 0) + 1));
      const left = (indegree.get(e.to) ?? 0) - 1;
      indegree.set(e.to, left);
      if (left === 0) queue.push(e.to);
    }
  }
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const columns = new Map<number, string[]>();
  for (const id of order.length === ids.length ? order : ids) {
    const col = layer.get(id) ?? 0;
    columns.set(col, [...(columns.get(col) ?? []), id]);
  }
  const rowOf = new Map<string, number>();
  const cols = [...columns.keys()].sort((a, b) => a - b);
  for (const col of cols) {
    const members = columns.get(col) ?? [];
    const score = (id: string) => {
      const preds = forward.filter((e) => e.to === id).map((e) => rowOf.get(e.from) ?? 0);
      return preds.length > 0 ? preds.reduce((a, b) => a + b, 0) / preds.length : 0;
    };
    const sorted = [...members].sort((a, b) => score(a) - score(b));
    const taken = new Set<number>();
    for (const id of sorted) {
      let row = Math.max(0, Math.round(score(id)));
      while (taken.has(row)) row += 1;
      taken.add(row);
      rowOf.set(id, row);
    }
  }
  const out = new Map<string, { x: number; y: number }>();
  let x = MARGIN;
  for (const col of cols) {
    const members = columns.get(col) ?? [];
    const width = Math.max(...members.map((id) => sizeOf(kindOf.get(id) ?? 'WAIT').w));
    for (const id of members) {
      const size = sizeOf(kindOf.get(id) ?? 'WAIT');
      out.set(id, {
        x: x + (width - size.w) / 2,
        y: MARGIN + (rowOf.get(id) ?? 0) * ROW + (ROW_BOX - size.h) / 2,
      });
    }
    x += width + GAP_X;
  }
  return out;
}

function humanize(id: string): string {
  const words = id.toLowerCase().split('_').filter(Boolean);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

let edgeCounter = 0;

export function newEdgeId(): string {
  edgeCounter += 1;
  return `edge-${globalThis.crypto?.randomUUID?.() ?? edgeCounter.toString(36)}`;
}

/** Opens a canonical graph (CMP-016 draft, BPMN import result) in the designer, laid out. */
export function importWorkflow(
  graph: CanonicalGraph,
  meta: { key: string; title: string; version: string; labels?: Record<string, string> },
): WorkflowDesign {
  const edges: FlowEdge[] = graph.edges.map((e) => {
    const edge: FlowEdge = { id: newEdgeId(), from: e.from_node, to: e.to_node };
    if (e.outcome) edge.outcome = e.outcome;
    if (e.condition_rule_ref) edge.ruleRef = e.condition_rule_ref;
    return edge;
  });
  const positions = autoLayout(
    graph.nodes.map((n) => ({ id: n.node_id, kind: n.kind })),
    edges,
  );
  const nodes = graph.nodes.map((n): FlowNode => {
    const p = positions.get(n.node_id) ?? { x: 0, y: 0 };
    const node: FlowNode = {
      id: n.node_id,
      kind: n.kind,
      label: meta.labels?.[n.node_id] ?? humanize(n.node_id),
      x: p.x,
      y: p.y,
    };
    if (n.assignment) node.assignment = { ...n.assignment };
    return node;
  });
  return { key: meta.key, title: meta.title, version: meta.version, nodes, edges };
}

/** CMP-033 WORKFLOW structural summary (`steps[]`), ids in the metadata key alphabet. */
export function workflowSteps(design: WorkflowDesign): { id: string; type: string }[] {
  return design.nodes.map((n) => ({
    id: n.id
      .toLowerCase()
      .replace(/^([^a-z])/, 'n_$1')
      .padEnd(2, '_'),
    type: n.kind,
  }));
}

/** Layout kept beside the canonical graph in CMP-033; never hashed or executed. */
export function workflowLayout(design: WorkflowDesign) {
  return {
    nodes: Object.fromEntries(design.nodes.map((n) => [n.id, { x: n.x, y: n.y, label: n.label }])),
  };
}
