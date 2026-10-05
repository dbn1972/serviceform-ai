import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  exportBpmn,
  graphHash,
  importBpmn,
  parseCanonicalModel,
} from '../../src/index.js';
import { frozenExample, model } from '../fixtures/models.js';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code;
    throw err;
  }
  return undefined;
}

const HEAD =
  '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:sf="https://contracts.serviceform.ai/bpmn/profile/v1">';
const TAIL = '</bpmn:definitions>';

function doc(process: string): string {
  return `${HEAD}<bpmn:process id="p" isExecutable="false">${process}</bpmn:process>${TAIL}`;
}

const MINIMAL =
  '<bpmn:startEvent id="START"/><bpmn:intermediateCatchEvent id="WAIT_A"><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent>' +
  '<bpmn:endEvent id="END"/>' +
  '<bpmn:sequenceFlow id="f1" sourceRef="START" targetRef="WAIT_A"/>' +
  '<bpmn:sequenceFlow id="f2" sourceRef="WAIT_A" targetRef="END" sf:outcome="DONE"/>';

describe('BPMN 2.0 import/export interoperability profile (Constitution #33)', () => {
  it('exports a non-executable BPMN view and round-trips to the same canonical graph', () => {
    const m = model();
    const xml = exportBpmn(m);
    expect(xml).toContain('isExecutable="false"');
    expect(xml).toContain('sf:profile="IMPORT_EXPORT_PROFILE_ONLY"');
    expect(xml).toContain('sf:runtime="TEMPORAL"');
    expect(xml).not.toMatch(
      /humanPerformer|potentialOwner|assignee|conditionExpression|scriptTask/,
    );
    const back = importBpmn(xml);
    expect(back.graph).toEqual({ nodes: m.nodes, edges: m.edges });
    expect(back.graph_hash).toBe(m.graph_hash);
    expect(back.source_graph_hash).toBe(m.graph_hash);
  });

  it('round-trips the FROZEN valid canonical example', () => {
    const m = parseCanonicalModel(frozenExample('valid', 'workflow-model'));
    expect(importBpmn(exportBpmn(m)).graph_hash).toBe(graphHash(m));
  });

  it('infers kinds from standard BPMN elements when sf:kind is absent', () => {
    const r = importBpmn(doc(MINIMAL));
    expect(r.graph.nodes.map((n) => n.kind)).toEqual(['START', 'WAIT', 'END']);
    expect(r.source_graph_hash).toBeUndefined();
    const timer = importBpmn(
      doc(
        '<bpmn:startEvent id="START"/><bpmn:intermediateCatchEvent id="T"><bpmn:timerEventDefinition/></bpmn:intermediateCatchEvent>' +
          '<bpmn:parallelGateway id="G"/><bpmn:endEvent id="END"/>' +
          '<bpmn:sequenceFlow id="a" sourceRef="START" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="G"/>' +
          '<bpmn:sequenceFlow id="c" sourceRef="G" targetRef="END"/>',
      ),
    );
    expect(timer.graph.nodes.map((n) => n.kind)).toEqual(['START', 'TIMER', 'PARALLEL', 'END']);
  });

  it.each([
    [
      'humanPerformer',
      '<bpmn:userTask id="T" sf:roleCode="ROLE_A"><bpmn:humanPerformer/></bpmn:userTask>',
    ],
    ['potentialOwner', '<bpmn:userTask id="T"><bpmn:potentialOwner/></bpmn:userTask>'],
    ['camunda:assignee', '<bpmn:userTask id="T" camunda:assignee="someone"/>'],
    ['zeebe:candidateUsers', '<bpmn:userTask id="T" zeebe:candidateUsers="a,b"/>'],
  ])('NEGATIVE: rejects named-officer assignment via %s', (_label, el) => {
    expect(code(() => importBpmn(doc(el)))).toBe('NAMED_OFFICER_FORBIDDEN');
  });

  it.each([
    ['scriptTask', '<bpmn:scriptTask id="S"><bpmn:script>run()</bpmn:script></bpmn:scriptTask>'],
    [
      'conditionExpression',
      '<bpmn:sequenceFlow id="f" sourceRef="A" targetRef="B"><bpmn:conditionExpression>x</bpmn:conditionExpression></bpmn:sequenceFlow>',
    ],
    ['extensionElements', '<bpmn:serviceTask id="S"><bpmn:extensionElements/></bpmn:serviceTask>'],
    ['engine attribute', '<bpmn:serviceTask id="S" camunda:class="x.Y"/>'],
    [
      'timer expression',
      '<bpmn:intermediateCatchEvent id="T"><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>',
    ],
    ['callActivity', '<bpmn:callActivity id="C"/>'],
  ])('NEGATIVE: rejects engine-executable construct %s (no second runtime)', (_label, el) => {
    expect(code(() => importBpmn(doc(el)))).toBe('BPMN_RUNTIME_CONSTRUCT_FORBIDDEN');
  });

  it('NEGATIVE: refuses DTDs, entities and processing instructions (XXE)', () => {
    expect(
      code(() =>
        importBpmn(
          `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${doc(MINIMAL).slice(21)}`,
        ),
      ),
    ).toBe('BPMN_XML_DTD_FORBIDDEN');
    expect(code(() => importBpmn(doc('<bpmn:startEvent id="&e;"/>')))).toBe(
      'BPMN_XML_ENTITY_FORBIDDEN',
    );
    expect(code(() => importBpmn(`${HEAD}<?evil x?>${TAIL}`))).toBe('BPMN_XML_PI_FORBIDDEN');
    expect(code(() => importBpmn(`${HEAD}<![CDATA[x]]>${TAIL}`))).toBe('BPMN_XML_DTD_FORBIDDEN');
  });

  it.each([
    ['unclosed', `${HEAD}<bpmn:process id="p">`],
    ['mismatched', `${HEAD}<bpmn:process id="p"></bpmn:other>${TAIL}`],
    ['bad attribute', `${HEAD}<bpmn:process id=p/>${TAIL}`],
    ['duplicate attribute', `${HEAD}<bpmn:process id="a" id="b"/>${TAIL}`],
    ['stray lt', `${HEAD}<bpmn:process id="p">a < b</bpmn:process>${TAIL}`],
  ])('NEGATIVE: rejects malformed XML (%s)', (_label, xml) => {
    expect(code(() => importBpmn(xml))).toBe('BPMN_XML_MALFORMED');
  });

  it('NEGATIVE: rejects more than one root element', () => {
    expect(code(() => importBpmn(`${HEAD}${TAIL}<bpmn:definitions/>`))).toBe(
      'BPMN_XML_MULTIPLE_ROOTS',
    );
  });

  it('rejects oversized or overly deep documents', () => {
    expect(code(() => importBpmn(`${HEAD}${' '.repeat(1_048_577)}${TAIL}`))).toBe(
      'BPMN_XML_TOO_LARGE',
    );
    expect(code(() => importBpmn(`${HEAD}${'<a>'.repeat(40)}${'</a>'.repeat(40)}${TAIL}`))).toBe(
      'BPMN_XML_TOO_DEEP',
    );
  });

  it('rejects documents outside the profile', () => {
    expect(code(() => importBpmn('<root/>'))).toBe('BPMN_ROOT_INVALID');
    expect(code(() => importBpmn(`${HEAD}${TAIL}`))).toBe('BPMN_SINGLE_PROCESS_REQUIRED');
    expect(
      code(() => importBpmn(`${HEAD}<bpmn:process id="p"/><bpmn:message id="m"/>${TAIL}`)),
    ).toBe('BPMN_UNSUPPORTED_ELEMENT');
    expect(code(() => importBpmn(doc('<bpmn:inclusiveGateway id="G"/>')))).toBe(
      'BPMN_UNSUPPORTED_ELEMENT',
    );
    expect(code(() => importBpmn(doc('<bpmn:task id="X"/>')))).toBe('BPMN_UNSUPPORTED_ELEMENT');
    expect(code(() => importBpmn(doc('<bpmn:userTask id="X" sf:kind="START"/>')))).toBe(
      'BPMN_KIND_ELEMENT_MISMATCH',
    );
    expect(code(() => importBpmn(doc('<bpmn:userTask id="X" sf:kind="SCRIPT"/>')))).toBe(
      'NODE_KIND_INVALID',
    );
    expect(
      code(() => importBpmn(doc('<bpmn:userTask id="X"><bpmn:ioSpecification/></bpmn:userTask>'))),
    ).toBe('BPMN_UNSUPPORTED_ELEMENT');
  });

  it('imported graphs are still validated as canonical graphs (assignment required)', () => {
    const xml = doc(
      '<bpmn:startEvent id="START"/><bpmn:userTask id="REVIEW"/><bpmn:endEvent id="END"/>' +
        '<bpmn:sequenceFlow id="a" sourceRef="START" targetRef="REVIEW"/><bpmn:sequenceFlow id="b" sourceRef="REVIEW" targetRef="END" sf:outcome="DONE"/>',
    );
    expect(code(() => importBpmn(xml))).toBe('HUMAN_TASK_ASSIGNMENT_REQUIRED');
  });

  it('ignores comments, documentation and diagram interchange', () => {
    const xml = `${HEAD}<!-- note --><bpmn:documentation/><bpmn:process id="p"><bpmn:documentation/>${MINIMAL}</bpmn:process><bpmndi:BPMNDiagram id="d"/>${TAIL}`;
    expect(importBpmn(xml).graph.nodes).toHaveLength(3);
  });
});
