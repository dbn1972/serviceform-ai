import type { DesignIssue, IssueSeverity } from '../forms/lint';
import {
  CODE_RE,
  DEFINITION_KEY_RE,
  incoming,
  isPort,
  KIND_INFO,
  NODE_ID_RE,
  outgoing,
  RULE_REF_RE,
  UUID_RE,
  type FlowNode,
  type WorkflowDesign,
} from './model';
import { SEMVER_RE } from '../forms/model';

export const MAX_NODES = 500;
export const MAX_EDGES = 2000;

export type WorkflowIssueTarget =
  { kind: 'workflow' } | { kind: 'node'; id: string } | { kind: 'edge'; id: string };

export interface WorkflowIssue extends Omit<DesignIssue, 'target'> {
  target: WorkflowIssueTarget;
}

function reach(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const n of next(id)) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

function name(n: FlowNode): string {
  return n.label || n.id;
}

/**
 * Plain-language mirror of CMP-016 `parseGraph` (same rule codes). CMP-016 stays authoritative:
 * the Studio checks a graph with CMP-016 and emits drafts through it.
 */
export function lintWorkflow(design: WorkflowDesign): WorkflowIssue[] {
  const out: WorkflowIssue[] = [];
  const add = (
    severity: IssueSeverity,
    code: string,
    message: string,
    target: WorkflowIssueTarget = { kind: 'workflow' },
  ) => out.push({ code, severity, message, target });
  const err = (code: string, message: string, target?: WorkflowIssueTarget) =>
    add('error', code, message, target);

  if (!DEFINITION_KEY_RE.test(design.key)) {
    err(
      'DEFINITION_KEY_INVALID',
      'Workflow key must start with a lowercase letter and use a–z, 0–9, ".", "_" or "-".',
    );
  }
  if (design.title.trim().length === 0) err('TITLE_REQUIRED', 'Give the workflow a title.');
  if (!SEMVER_RE.test(design.version)) {
    err('VERSION_INVALID', 'Version must look like 1.0.0 (major.minor.patch).');
  }
  if (design.nodes.length < 2 || design.nodes.length > MAX_NODES) {
    err('NODES_INVALID', `A workflow needs between 2 and ${MAX_NODES} steps.`);
  }
  if (design.edges.length < 1 || design.edges.length > MAX_EDGES) {
    err('EDGES_INVALID', 'Connect the steps with at least one path.');
  }

  const byId = new Map<string, FlowNode>();
  for (const n of design.nodes) {
    const target: WorkflowIssueTarget = { kind: 'node', id: n.id };
    if (!NODE_ID_RE.test(n.id)) {
      err('NODE_ID_INVALID', `Step id "${n.id}" must be CAPITALS, digits and "_".`, target);
    }
    if (byId.has(n.id)) err('NODE_ID_DUPLICATE', `Step id "${n.id}" is used twice.`, target);
    byId.set(n.id, n);
    const a = n.assignment;
    if (n.kind === 'HUMAN_TASK' && !a) {
      err(
        'HUMAN_TASK_ASSIGNMENT_REQUIRED',
        `"${name(n)}" needs an assignment: role, organisation and jurisdiction (never a named officer).`,
        target,
      );
    }
    if (a) {
      if (!CODE_RE.test(a.role_code)) {
        err(
          'ASSIGNMENT_ROLE_REQUIRED',
          `"${name(n)}" needs a role code such as CASE_OFFICER.`,
          target,
        );
      }
      if (!UUID_RE.test(a.organisation_id)) {
        err(
          'ASSIGNMENT_ORGANISATION_REQUIRED',
          `"${name(n)}" needs an organisation id from tenant master data.`,
          target,
        );
      }
      if (!UUID_RE.test(a.jurisdiction_id)) {
        err(
          'ASSIGNMENT_JURISDICTION_REQUIRED',
          `"${name(n)}" needs a jurisdiction id from master data.`,
          target,
        );
      }
      if (a.office_id !== undefined && !UUID_RE.test(a.office_id)) {
        err('ASSIGNMENT_OFFICE_INVALID', `"${name(n)}" office id must be a UUID.`, target);
      }
      if (a.service_scope_id !== undefined && !UUID_RE.test(a.service_scope_id)) {
        err('ASSIGNMENT_SCOPE_INVALID', `"${name(n)}" service scope id must be a UUID.`, target);
      }
    }
  }

  const starts = design.nodes.filter((n) => n.kind === 'START');
  if (starts.length !== 1) err('EXACTLY_ONE_START_REQUIRED', 'Use exactly one Start.');
  if (!design.nodes.some((n) => n.kind === 'END')) err('END_REQUIRED', 'Add at least one End.');

  const seen = new Set<string>();
  for (const e of design.edges) {
    const target: WorkflowIssueTarget = { kind: 'edge', id: e.id };
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to)
      err('EDGE_UNKNOWN_NODE', 'A path points to a step that no longer exists.', target);
    if (e.from === e.to) err('EDGE_SELF_LOOP', `A path loops "${e.from}" onto itself.`, target);
    if (e.outcome !== undefined && !CODE_RE.test(e.outcome)) {
      err(
        'EDGE_OUTCOME_INVALID',
        `Outcome "${e.outcome}" must be CAPITALS, digits and "_".`,
        target,
      );
    }
    if (e.ruleRef !== undefined && !RULE_REF_RE.test(e.ruleRef)) {
      err('EDGE_RULE_REF_INVALID', `Rule reference "${e.ruleRef}" has invalid characters.`, target);
    }
    const key = `${e.from}>${e.to}>${e.outcome ?? ''}>${e.ruleRef ?? ''}`;
    if (seen.has(key)) err('EDGE_DUPLICATE', 'Two identical paths connect the same steps.', target);
    seen.add(key);
  }

  for (const n of design.nodes) {
    const target: WorkflowIssueTarget = { kind: 'node', id: n.id };
    const outs = outgoing(design, n.id);
    if (n.kind === 'START') {
      if (incoming(design, n.id).length > 0) {
        err('START_HAS_INCOMING', 'Nothing may lead back into Start.', target);
      }
      if (outs.length !== 1)
        err('START_SINGLE_OUTGOING', 'Start needs exactly one path out.', target);
    }
    if (n.kind === 'END') {
      if (outs.length > 0)
        err('END_HAS_OUTGOING', `"${name(n)}" is an End; remove its path out.`, target);
      continue;
    }
    if (outs.length === 0) err('DEAD_END_NODE', `"${name(n)}" has no path out.`, target);
    if (n.kind === 'PARALLEL') {
      if (outs.some((e) => e.outcome || e.ruleRef)) {
        err(
          'PARALLEL_EDGES_UNCONDITIONAL',
          'Paths out of a parallel split take no outcome or rule.',
          target,
        );
      }
      continue;
    }
    if (n.kind === 'WITHDRAWAL_REQUEST' || n.kind === 'CANCELLATION_REQUEST') {
      const review = n.kind === 'WITHDRAWAL_REQUEST' ? 'WITHDRAWAL_REVIEW' : 'CANCELLATION_REVIEW';
      const only = outs[0];
      if (outs.length !== 1 || !only || byId.get(only.to)?.kind !== review) {
        err(
          'REQUEST_REQUIRES_REVIEW',
          `"${name(n)}" must lead to exactly one ${KIND_INFO[review].label.toLowerCase()}.`,
          target,
        );
      }
    }
    const refs = new Set(outs.map((e) => e.ruleRef).filter(Boolean));
    if (refs.size > 1) {
      err('ROUTING_RULE_REF_AMBIGUOUS', `"${name(n)}" routes on more than one rule.`, target);
    }
    if (n.kind === 'RULE_GATE' && refs.size !== 1) {
      err(
        'RULE_GATE_RULE_REF_REQUIRED',
        `"${name(n)}" needs one GoRules decision reference.`,
        target,
      );
    }
    if (outs.length > 1) {
      if (outs.filter((e) => !e.outcome).length > 1) {
        err(
          'CHOICE_MULTIPLE_DEFAULTS',
          `"${name(n)}" has more than one path without an outcome.`,
          target,
        );
      }
      const outcomes = outs.map((e) => e.outcome).filter(Boolean);
      if (new Set(outcomes).size !== outcomes.length) {
        err('CHOICE_OUTCOME_DUPLICATE', `"${name(n)}" repeats an outcome on two paths.`, target);
      }
    }
    if (isPort(n.kind)) {
      add(
        'warning',
        'PORT_NOT_WIRED_IN_LAB',
        `"${name(n)}" is a ${KIND_INFO[n.kind].label} port; SAMPLE_LAB does not wire it yet.`,
        target,
      );
    }
  }

  const start = starts[0];
  if (start && starts.length === 1) {
    const forward = reach(start.id, (id) => outgoing(design, id).map((e) => e.to));
    for (const n of design.nodes) {
      if (!forward.has(n.id)) {
        err('NODE_UNREACHABLE', `"${name(n)}" cannot be reached from Start.`, {
          kind: 'node',
          id: n.id,
        });
      }
    }
  }
  const canFinish = new Set<string>();
  for (const end of design.nodes.filter((n) => n.kind === 'END')) {
    for (const id of reach(end.id, (x) => incoming(design, x).map((e) => e.from)))
      canFinish.add(id);
  }
  if (design.nodes.some((n) => n.kind === 'END')) {
    for (const n of design.nodes) {
      if (!canFinish.has(n.id)) {
        err('NODE_CANNOT_REACH_END', `"${name(n)}" can never reach an End.`, {
          kind: 'node',
          id: n.id,
        });
      }
    }
  }
  return out;
}

export function workflowHasErrors(issues: readonly WorkflowIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export function workflowDocumentKey(design: WorkflowDesign): string {
  return `${design.key}.v${design.version}`;
}
