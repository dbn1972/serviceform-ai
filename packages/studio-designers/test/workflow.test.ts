import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  blankWorkflow,
  buildWorkflowDocument,
  caseSequencingGraph,
  compileWorkflow,
  importWorkflow,
  lintWorkflow,
  moveNode,
  relayout,
  removeNode,
  updateEdge,
  uniqueNodeId,
  updateNode,
  workflowDocumentOf,
  workflowGraphHash,
  workflowHasErrors,
  type WorkflowDesign,
} from '../src/workflow';

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/lab/platform/workflow.json', import.meta.url), 'utf8'),
) as { workflows: { graph: unknown; graph_hash: string; definition_key: string }[] };

function codes(d: WorkflowDesign): string[] {
  return lintWorkflow(d).map((i) => i.code);
}

function sequencing(): WorkflowDesign {
  return importWorkflow(caseSequencingGraph(), {
    key: 'sample-lab.ind-soc-002.case-sequencing',
    title: 'Case sequencing',
    version: '1.0.0',
  });
}

// REQ: Phase C-2 — the workflow designer emits the canonical CMP-016 graph with its graph_hash.
describe('workflow designer: canonical graph', () => {
  it('the case-sequencing template is the SAMPLE_LAB graph CMP-016 already runs', async () => {
    const lab = fixture.workflows[0];
    expect(caseSequencingGraph()).toEqual(lab?.graph);
    expect(await workflowGraphHash(caseSequencingGraph())).toBe(lab?.graph_hash);
  });

  it('import → compile is lossless and layout never changes the hash', async () => {
    const design = sequencing();
    expect(compileWorkflow(design)).toEqual(caseSequencingGraph());
    expect(lintWorkflow(design).filter((i) => i.severity === 'error')).toEqual([]);
    const moved = moveNode(design, 'WAIT_DRAFT', 999, 333);
    expect(await workflowGraphHash(compileWorkflow(moved))).toBe(fixture.workflows[0]?.graph_hash);
    expect(moved.nodes.find((n) => n.id === 'WAIT_DRAFT')).toMatchObject({ x: 1000, y: 336 });
    const laid = relayout(moved);
    expect(laid.nodes.find((n) => n.id === 'START')).toMatchObject({ x: 40, y: 52 });
    const xs = (id: string) => laid.nodes.find((n) => n.id === id)?.x ?? 0;
    expect(xs('WAIT_DRAFT')).toBeLessThan(xs('WAIT_SUBMITTED'));
    expect(xs('WAIT_UNDER_SCRUTINY')).toBeLessThan(xs('WAIT_DECISION_PENDING'));
    expect(xs('WAIT_ISSUED')).toBeLessThan(xs('END_CLOSED'));
  });

  it('builds the CMP-033 WORKFLOW payload and reads it back', async () => {
    const doc = await buildWorkflowDocument(sequencing());
    expect(doc.documentKey).toBe('sample-lab.ind-soc-002.case-sequencing.v1.0.0');
    expect(doc.payload.steps[0]).toEqual({ id: 'start', type: 'START' });
    expect(doc.payload.graph_hash).toBe(fixture.workflows[0]?.graph_hash);
    const back = workflowDocumentOf(doc.payload);
    expect(back?.graph).toEqual(doc.graph);
    expect(back?.layout['START']).toMatchObject({ label: 'Start' });
    expect(workflowDocumentOf({ steps: [] })).toBeNull();
  });
});

describe('workflow designer: editing and checks mirror CMP-016', () => {
  it('derives step ids in linear time', () => {
    const d = blankWorkflow();
    expect(uniqueNodeId(d, ' officer review! ')).toBe('OFFICER_REVIEW');
    expect(uniqueNodeId(d, 'start')).toBe('START_2');
    expect(uniqueNodeId(d, '42')).toBe('STEP');
    const started = Date.now();
    expect(uniqueNodeId(d, `a${'_'.repeat(100_000)}!`)).toBe('A');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('builds a valid officer-review flow and renames ids through paths', () => {
    let d = blankWorkflow();
    d = { ...d, edges: [] };
    const task = addNode(d, 'HUMAN_TASK');
    d = task.design;
    expect(codes(d)).toContain('HUMAN_TASK_ASSIGNMENT_REQUIRED');
    d = updateNode(d, task.id, {
      id: 'SCRUTINY',
      label: 'Scrutinise application',
      assignment: {
        role_code: 'CASE_OFFICER',
        organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
        jurisdiction_id: '0d15ba00-0a02-4000-8000-0d15ba000a02',
      },
    });
    const choice = addNode(d, 'DECISION');
    d = choice.design;
    const end2 = addNode(d, 'END');
    d = end2.design;
    d = addEdge(d, 'START', 'SCRUTINY').design;
    d = addEdge(d, 'SCRUTINY', choice.id).design;
    d = addEdge(d, choice.id, 'END', { outcome: 'RECORD_APPROVED' }).design;
    d = addEdge(d, choice.id, end2.id, { outcome: 'RECORD_REJECTED' }).design;
    expect(lintWorkflow(d).filter((i) => i.severity === 'error')).toEqual([]);
    d = updateNode(d, 'SCRUTINY', { id: 'REVIEW' });
    expect(d.edges.some((e) => e.from === 'REVIEW')).toBe(true);
    expect(workflowHasErrors(lintWorkflow(d))).toBe(false);
  });

  it('reports the CMP-016 structural refusals by code', () => {
    let d = blankWorkflow('Bad Key', '');
    d = addNode(d, 'START').design;
    const orphan = addNode(d, 'WAIT');
    d = orphan.design;
    d = addNode(d, 'PARALLEL').design;
    d = addEdge(d, 'PARALLEL', 'END', { outcome: 'X' }).design;
    d = addEdge(d, 'END', 'END').design;
    const gate = addNode(d, 'RULE_GATE');
    d = gate.design;
    d = addEdge(d, 'START', gate.id).design;
    const req = addNode(d, 'WITHDRAWAL_REQUEST');
    d = addEdge(req.design, req.id, 'END').design;
    d = addEdge(d, 'START', 'END').design;
    const dupId = d.edges[d.edges.length - 1]?.id ?? '';
    d = updateEdge(d, dupId, { outcome: 'bad' });
    expect(codes(d)).toEqual(
      expect.arrayContaining([
        'DEFINITION_KEY_INVALID',
        'TITLE_REQUIRED',
        'EXACTLY_ONE_START_REQUIRED',
        'DEAD_END_NODE',
        'PARALLEL_EDGES_UNCONDITIONAL',
        'EDGE_SELF_LOOP',
        'END_HAS_OUTGOING',
        'RULE_GATE_RULE_REF_REQUIRED',
        'REQUEST_REQUIRES_REVIEW',
        'EDGE_OUTCOME_INVALID',
      ]),
    );
    const single = removeNode(d, 'START_2');
    expect(codes(single)).toEqual(expect.arrayContaining(['NODE_CANNOT_REACH_END']));
  });

  it('flags unreachable steps, ambiguous choices and port nodes that SAMPLE_LAB does not wire', () => {
    let d = sequencing();
    const notify = addNode(d, 'NOTIFY');
    d = notify.design;
    d = addEdge(d, notify.id, 'END_CLOSED').design;
    d = addEdge(d, 'WAIT_DRAFT', 'WAIT_SUBMITTED').design;
    d = addEdge(d, 'WAIT_DRAFT', 'WAIT_RECEIVED').design;
    d = addEdge(d, 'WAIT_SUBMITTED', 'WAIT_REJECTED', { outcome: 'SUBMIT' }).design;
    d = addEdge(d, 'WAIT_SUBMITTED', 'WAIT_APPROVED', { outcome: 'SUBMIT' }).design;
    const found = codes(d);
    expect(found).toEqual(
      expect.arrayContaining([
        'NODE_UNREACHABLE',
        'CHOICE_MULTIPLE_DEFAULTS',
        'CHOICE_OUTCOME_DUPLICATE',
        'PORT_NOT_WIRED_IN_LAB',
      ]),
    );
    expect(lintWorkflow(d).find((i) => i.code === 'PORT_NOT_WIRED_IN_LAB')?.severity).toBe(
      'warning',
    );
  });
});
