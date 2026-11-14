import { compileWorkflow, workflowGraphHash, workflowLayout, workflowSteps } from './compile';
import { workflowDocumentKey } from './lint';
import type { CanonicalGraph, WorkflowDesign } from './model';

export const WORKFLOW_DESIGNER_TOOL = 'SF_STUDIO_WORKFLOW_DESIGNER';

/**
 * CMP-033 WORKFLOW metadata payload: `steps` (structural summary CMP-033 always required),
 * `workflow_graph` (the canonical CMP-016 graph), `graph_hash` (CMP-016 graph_hash, re-checked by
 * CMP-033 on validate) and `layout` (positions and labels, never hashed or executed).
 */
export interface WorkflowDocumentPayload {
  steps: { id: string; type: string }[];
  workflow_graph: CanonicalGraph;
  graph_hash: string;
  layout: ReturnType<typeof workflowLayout>;
  authoring: {
    tool: typeof WORKFLOW_DESIGNER_TOOL;
    model_version: 1;
    definition_key: string;
    version: string;
    title: string;
  };
}

export interface CompiledWorkflow {
  documentKey: string;
  graph: CanonicalGraph;
  graphHash: string;
  payload: WorkflowDocumentPayload;
}

export async function buildWorkflowDocument(design: WorkflowDesign): Promise<CompiledWorkflow> {
  const graph = compileWorkflow(design);
  const graphHash = await workflowGraphHash(graph);
  return {
    documentKey: workflowDocumentKey(design),
    graph,
    graphHash,
    payload: {
      steps: workflowSteps(design),
      workflow_graph: graph,
      graph_hash: graphHash,
      layout: workflowLayout(design),
      authoring: {
        tool: WORKFLOW_DESIGNER_TOOL,
        model_version: 1,
        definition_key: design.key,
        version: design.version,
        title: design.title,
      },
    },
  };
}

/** Reads a designer workflow back out of a CMP-033 payload; null when it is not one. */
export function workflowDocumentOf(payload: unknown): {
  graph: CanonicalGraph;
  graphHash: string;
  layout: Record<string, { x: number; y: number; label: string }>;
  key: string;
  version: string;
  title: string;
} | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<WorkflowDocumentPayload>;
  const g = p.workflow_graph;
  if (
    !g ||
    !Array.isArray(g.nodes) ||
    !Array.isArray(g.edges) ||
    typeof p.graph_hash !== 'string'
  ) {
    return null;
  }
  return {
    graph: g,
    graphHash: p.graph_hash,
    layout: p.layout?.nodes ?? {},
    key: p.authoring?.definition_key ?? 'lab.workflow',
    version: p.authoring?.version ?? '1.0.0',
    title: p.authoring?.title ?? 'Workflow',
  };
}
