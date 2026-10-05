import { createHash } from 'node:crypto';
import type { WorkflowGraph } from './model.js';

/** RFC 8785-style canonical JSON: sorted keys, no whitespace, undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * graph_hash covers only the executable graph (nodes + edges). Node and edge order is part of the
 * hash so the published artifact is byte-stable; editors must not reorder a published graph.
 */
export function graphHash(graph: WorkflowGraph): string {
  return sha256(canonicalJson({ nodes: graph.nodes, edges: graph.edges }));
}
