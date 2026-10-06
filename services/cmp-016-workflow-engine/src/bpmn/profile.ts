import { invalid } from '../errors.js';
import { graphHash } from '../domain/hash.js';
import {
  NODE_KINDS,
  isPortKind,
  type Assignment,
  type CanonicalWorkflowModel,
  type NodeKind,
  type WorkflowGraph,
} from '../domain/model.js';
import { parseGraph } from '../domain/validate.js';
import { escapeXml, parseXml, type XmlElement } from './xml.js';

/**
 * BPMN 2.0 interoperability profile over the canonical ServiceForm Workflow Model
 * (Constitution #33). Export is a non-executable view; import yields an unpublished canonical
 * DRAFT graph that must go through validation, maker-checker publication and Temporal like any
 * other draft. There is no BPMN execution path in this component.
 */
export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const SF_PROFILE_NS = 'https://contracts.serviceform.ai/bpmn/profile/v1';

const ELEMENT_FOR_KIND: Record<NodeKind, string> = {
  START: 'startEvent',
  END: 'endEvent',
  HUMAN_TASK: 'userTask',
  WITHDRAWAL_REVIEW: 'userTask',
  CANCELLATION_REVIEW: 'userTask',
  RULE_GATE: 'businessRuleTask',
  SERVICE_ACTIVITY: 'serviceTask',
  DEFICIENCY: 'serviceTask',
  PAYMENT: 'serviceTask',
  SIGN: 'serviceTask',
  ISSUE: 'serviceTask',
  NOTIFY: 'sendTask',
  WAIT: 'intermediateCatchEvent',
  TIMER: 'intermediateCatchEvent',
  DECISION: 'exclusiveGateway',
  PARALLEL: 'parallelGateway',
  WITHDRAWAL_REQUEST: 'task',
  CANCELLATION_REQUEST: 'task',
};

const INFERRED_KIND: Record<string, NodeKind> = {
  startEvent: 'START',
  endEvent: 'END',
  userTask: 'HUMAN_TASK',
  businessRuleTask: 'RULE_GATE',
  serviceTask: 'SERVICE_ACTIVITY',
  exclusiveGateway: 'DECISION',
  parallelGateway: 'PARALLEL',
};

const FLOW_NODE_ELEMENTS = new Set([...Object.values(ELEMENT_FOR_KIND)]);
const IGNORED_PROCESS_CHILDREN = new Set(['documentation', 'laneSet']);
const ALLOWED_NODE_CHILDREN = new Set([
  'incoming',
  'outgoing',
  'documentation',
  'timerEventDefinition',
  'messageEventDefinition',
]);
/** Constructs that would make a BPMN engine (not Temporal) execute logic or bind a person. */
const RUNTIME_CONSTRUCTS = new Set([
  'scriptTask',
  'script',
  'conditionExpression',
  'extensionElements',
  'callActivity',
  'subProcess',
  'timeDuration',
  'timeDate',
  'timeCycle',
]);
const NAMED_PERFORMER = new Set(['humanPerformer', 'potentialOwner', 'performer', 'resourceRole']);
const ENGINE_ATTR = /^(camunda|zeebe|activiti|flowable|jbpm|drools):/i;
const PERSON_ATTR = /assignee|candidateusers|candidategroups|owner|performer|officer|user/i;

const ASSIGNMENT_ATTRS: [keyof Assignment, string][] = [
  ['role_code', 'sf:roleCode'],
  ['organisation_id', 'sf:organisationId'],
  ['office_id', 'sf:officeId'],
  ['jurisdiction_id', 'sf:jurisdictionId'],
  ['service_scope_id', 'sf:serviceScopeId'],
  ['claim_mode', 'sf:claimMode'],
];

function attr(name: string, value: string | undefined): string {
  return value === undefined ? '' : ` ${name}="${escapeXml(value)}"`;
}

export function exportBpmn(model: CanonicalWorkflowModel): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<bpmn:definitions xmlns:bpmn="${BPMN_NS}" xmlns:sf="${SF_PROFILE_NS}"` +
      ` targetNamespace="${SF_PROFILE_NS}"` +
      attr('sf:profile', model.bpmn_role) +
      attr('sf:runtime', model.runtime) +
      attr('sf:workflowVersionId', model.workflow_version_id) +
      attr('sf:graphHash', model.graph_hash) +
      '>',
  );
  lines.push(`  <bpmn:process id="sf_process" isExecutable="false">`);
  for (const n of model.nodes) {
    const el = ELEMENT_FOR_KIND[n.kind];
    let a = attr('id', n.node_id) + attr('sf:kind', n.kind);
    if (n.port_only) a += attr('sf:portOnly', 'true');
    for (const [key, name] of ASSIGNMENT_ATTRS) a += attr(name, n.assignment?.[key]);
    if (n.kind === 'TIMER') {
      lines.push(`    <bpmn:${el}${a}><bpmn:timerEventDefinition/></bpmn:${el}>`);
    } else if (n.kind === 'WAIT') {
      lines.push(`    <bpmn:${el}${a}><bpmn:messageEventDefinition/></bpmn:${el}>`);
    } else {
      lines.push(`    <bpmn:${el}${a}/>`);
    }
  }
  model.edges.forEach((e, i) => {
    lines.push(
      `    <bpmn:sequenceFlow${attr('id', `F${i + 1}`)}${attr('sourceRef', e.from_node)}` +
        `${attr('targetRef', e.to_node)}${attr('sf:outcome', e.outcome)}` +
        `${attr('sf:conditionRuleRef', e.condition_rule_ref)}/>`,
    );
  });
  lines.push('  </bpmn:process>');
  lines.push('</bpmn:definitions>');
  return `${lines.join('\n')}\n`;
}

function screen(el: XmlElement, pointer: string): void {
  if (NAMED_PERFORMER.has(el.local)) throw invalid('NAMED_OFFICER_FORBIDDEN', pointer);
  if (RUNTIME_CONSTRUCTS.has(el.local)) throw invalid('BPMN_RUNTIME_CONSTRUCT_FORBIDDEN', pointer);
  for (const key of Object.keys(el.attrs)) {
    if (ENGINE_ATTR.test(key)) {
      throw invalid(
        PERSON_ATTR.test(key) ? 'NAMED_OFFICER_FORBIDDEN' : 'BPMN_RUNTIME_CONSTRUCT_FORBIDDEN',
        `${pointer}/@${key}`,
      );
    }
  }
  el.children.forEach((c, i) => screen(c, `${pointer}/${c.local}[${i}]`));
}

function kindOf(el: XmlElement, pointer: string): NodeKind {
  const declared = el.attrs['sf:kind'];
  if (declared !== undefined) {
    if (!(NODE_KINDS as readonly string[]).includes(declared))
      throw invalid('NODE_KIND_INVALID', pointer);
    if (ELEMENT_FOR_KIND[declared as NodeKind] !== el.local) {
      throw invalid('BPMN_KIND_ELEMENT_MISMATCH', pointer);
    }
    return declared as NodeKind;
  }
  if (el.local === 'intermediateCatchEvent') {
    return el.children.some((c) => c.local === 'timerEventDefinition') ? 'TIMER' : 'WAIT';
  }
  const inferred = INFERRED_KIND[el.local];
  if (!inferred) throw invalid('BPMN_UNSUPPORTED_ELEMENT', pointer);
  return inferred;
}

function nodeOf(el: XmlElement, pointer: string): Record<string, unknown> {
  for (const c of el.children) {
    if (!ALLOWED_NODE_CHILDREN.has(c.local))
      throw invalid('BPMN_UNSUPPORTED_ELEMENT', `${pointer}/${c.local}`);
  }
  const kind = kindOf(el, pointer);
  const node: Record<string, unknown> = { node_id: el.attrs['id'], kind };
  const assignment: Record<string, string> = {};
  for (const [key, name] of ASSIGNMENT_ATTRS) {
    const v = el.attrs[name];
    if (v !== undefined) assignment[key] = v;
  }
  if (Object.keys(assignment).length > 0) node['assignment'] = assignment;
  if (isPortKind(kind)) node['port_only'] = el.attrs['sf:portOnly'] === 'true';
  return node;
}

export interface BpmnImportResult {
  graph: WorkflowGraph;
  graph_hash: string;
  source_graph_hash?: string;
}

/** Imports a BPMN document as an unpublished canonical draft graph. Never executes it. */
export function importBpmn(xml: string): BpmnImportResult {
  const root = parseXml(xml);
  if (root.local !== 'definitions') throw invalid('BPMN_ROOT_INVALID');
  screen(root, '/definitions');
  const processes = root.children.filter((c) => c.local === 'process');
  if (processes.length !== 1) throw invalid('BPMN_SINGLE_PROCESS_REQUIRED');
  for (const c of root.children) {
    if (!['process', 'BPMNDiagram', 'documentation'].includes(c.local)) {
      throw invalid('BPMN_UNSUPPORTED_ELEMENT', `/definitions/${c.local}`);
    }
  }
  const proc = processes[0] as XmlElement;
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  proc.children.forEach((el, i) => {
    const pointer = `/process/${el.local}[${i}]`;
    if (IGNORED_PROCESS_CHILDREN.has(el.local)) return;
    if (el.local === 'sequenceFlow') {
      if (el.children.length > 0) throw invalid('BPMN_RUNTIME_CONSTRUCT_FORBIDDEN', pointer);
      const edge: Record<string, unknown> = {
        from_node: el.attrs['sourceRef'],
        to_node: el.attrs['targetRef'],
      };
      if (el.attrs['sf:outcome'] !== undefined) edge['outcome'] = el.attrs['sf:outcome'];
      if (el.attrs['sf:conditionRuleRef'] !== undefined) {
        edge['condition_rule_ref'] = el.attrs['sf:conditionRuleRef'];
      }
      edges.push(edge);
      return;
    }
    if (!FLOW_NODE_ELEMENTS.has(el.local)) throw invalid('BPMN_UNSUPPORTED_ELEMENT', pointer);
    nodes.push(nodeOf(el, pointer));
  });
  const graph = parseGraph({ nodes, edges });
  const source = root.attrs['sf:graphHash'];
  return {
    graph,
    graph_hash: graphHash(graph),
    ...(source === undefined ? {} : { source_graph_hash: source }),
  };
}
