import { Cmp008Error } from '../errors.js';
import { canonicalJson } from './canonical.js';

/**
 * Only structural, side-effect-free JDM node kinds are executable. functionNode (arbitrary
 * JavaScript), customNode, httpRequestNode and decisionNode (external decision loader) are
 * refused so a published rule pack can only be deterministic metadata (Constitution #7).
 */
export const ALLOWED_NODE_TYPES = [
  'inputNode',
  'outputNode',
  'decisionTableNode',
  'expressionNode',
  'switchNode',
] as const;

export const MAX_JDM_BYTES = 262_144;
export const MAX_NODES = 200;
export const MAX_EDGES = 400;

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Zero-argument clock/entropy calls make a decision depend on evaluation time. */
const NON_DETERMINISTIC_CALL =
  /(?:^|[^A-Za-z0-9_$])(?:d|date|time|now|today|rand|random|uuid)\s*\(\s*\)/i;

export interface JdmNode {
  id: string;
  type: (typeof ALLOWED_NODE_TYPES)[number];
  name?: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface JdmEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  [key: string]: unknown;
}

export interface Jdm {
  contentType?: string;
  nodes: JdmNode[];
  edges: JdmEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(code: string): never {
  throw new Cmp008Error('SF-RULE-001', { statusCode: 422, details: [{ code }] });
}

function scanStrings(value: unknown, visit: (s: string) => void, depth = 0): void {
  if (depth > 32) invalid('JDM_TOO_DEEP');
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const v of value) scanStrings(v, visit, depth + 1);
  else if (isRecord(value)) for (const v of Object.values(value)) scanStrings(v, visit, depth + 1);
}

function assertAcyclic(nodes: JdmNode[], edges: JdmEdge[]): void {
  const next = new Map<string, string[]>();
  for (const n of nodes) next.set(n.id, []);
  for (const e of edges) next.get(e.sourceId)?.push(e.targetId);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) invalid('JDM_CYCLE');
    state.set(id, 1);
    for (const t of next.get(id) ?? []) visit(t);
    state.set(id, 2);
  };
  for (const n of nodes) visit(n.id);
}

export function validateJdm(raw: unknown): Jdm {
  if (!isRecord(raw)) invalid('JDM_NOT_OBJECT');
  const nodes = raw['nodes'];
  const edges = raw['edges'];
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > MAX_NODES) {
    invalid('JDM_NODES_INVALID');
  }
  if (!Array.isArray(edges) || edges.length > MAX_EDGES) invalid('JDM_EDGES_INVALID');
  if (Buffer.byteLength(canonicalJson(raw), 'utf8') > MAX_JDM_BYTES) invalid('JDM_TOO_LARGE');

  const ids = new Set<string>();
  let inputs = 0;
  let outputs = 0;
  for (const node of nodes) {
    if (!isRecord(node)) invalid('JDM_NODE_INVALID');
    const id = node['id'];
    const type = node['type'];
    if (typeof id !== 'string' || !NODE_ID_RE.test(id)) invalid('JDM_NODE_ID_INVALID');
    if (ids.has(id)) invalid('JDM_NODE_ID_DUPLICATE');
    ids.add(id);
    if (typeof type !== 'string' || !(ALLOWED_NODE_TYPES as readonly string[]).includes(type)) {
      invalid('JDM_NODE_TYPE_FORBIDDEN');
    }
    if (type === 'inputNode') inputs += 1;
    if (type === 'outputNode') outputs += 1;
  }
  if (inputs !== 1) invalid('JDM_INPUT_NODE_REQUIRED');
  if (outputs < 1) invalid('JDM_OUTPUT_NODE_REQUIRED');

  for (const edge of edges) {
    if (!isRecord(edge)) invalid('JDM_EDGE_INVALID');
    const source = edge['sourceId'];
    const target = edge['targetId'];
    if (typeof source !== 'string' || typeof target !== 'string') invalid('JDM_EDGE_INVALID');
    if (!ids.has(source) || !ids.has(target)) invalid('JDM_EDGE_DANGLING');
  }

  scanStrings(nodes, (s) => {
    if (NON_DETERMINISTIC_CALL.test(s)) invalid('JDM_NON_DETERMINISTIC_FUNCTION');
  });
  assertAcyclic(nodes as JdmNode[], edges as JdmEdge[]);
  return raw as unknown as Jdm;
}
