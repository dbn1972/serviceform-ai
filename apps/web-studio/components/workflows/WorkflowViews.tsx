'use client';

import { Alert, Button, Icon } from '@serviceform/ui-ux4g';
import {
  KIND_INFO,
  outgoing,
  type CanonicalGraph,
  type CompiledWorkflow,
  type WorkflowDesign,
} from '@serviceform/studio-designers/workflow';
import { useState } from 'react';
import { explain, workflowApi, type GraphCheck } from '../../lib/studio-api';
import type { WorkflowSelection } from './WorkflowCanvas';

/** Table view of the graph: the screen-reader and keyboard alternative to the canvas. */
export function WorkflowOutline({
  design,
  select,
}: {
  design: WorkflowDesign;
  select: (s: WorkflowSelection) => void;
}) {
  return (
    <div className="sf-table-wrap">
      <table className="sf-table">
        <caption>
          {design.nodes.length} steps and {design.edges.length} paths, in published order
        </caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Type</th>
            <th scope="col">Assignment</th>
            <th scope="col">Paths out</th>
          </tr>
        </thead>
        <tbody>
          {design.nodes.map((n) => (
            <tr key={n.id}>
              <th scope="row">
                <Button
                  variant="text-primary"
                  size="xs"
                  onClick={() => select({ kind: 'node', id: n.id })}
                >
                  {n.label || n.id}
                </Button>
                <br />
                <code className="sf-hash">{n.id}</code>
              </th>
              <td>{KIND_INFO[n.kind].label}</td>
              <td>
                {n.assignment ? (
                  <code className="sf-hash">{n.assignment.role_code}</code>
                ) : (
                  <span className="sf-designer-muted">—</span>
                )}
              </td>
              <td>
                <ul className="sf-diff-list">
                  {outgoing(design, n.id).map((e) => (
                    <li key={e.id}>
                      <Button
                        variant="text-neutral"
                        size="xs"
                        onClick={() => select({ kind: 'edge', id: e.id })}
                      >
                        → {e.to}
                      </Button>
                      {e.outcome ? <span className="ux4g-tag-tonal-info">{e.outcome}</span> : null}
                      {e.ruleRef ? (
                        <span className="ux4g-tag-tonal-warning">rule {e.ruleRef}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkflowSchema({ compiled }: { compiled: CompiledWorkflow | null }) {
  if (!compiled) return <p className="ux4g-body-m-default">Compiling…</p>;
  return (
    <div className="sf-designer-schema">
      <dl className="sf-dl">
        <dt>CMP-033 document key</dt>
        <dd>
          <code className="sf-hash">{compiled.documentKey}</code>
        </dd>
        <dt>graph_hash (pin)</dt>
        <dd>
          <code className="sf-hash" data-testid="workflow-graph-hash">
            {compiled.graphHash}
          </code>
        </dd>
        <dt>Runtime</dt>
        <dd>TEMPORAL (BPMN is import/export only)</dd>
      </dl>
      <section className="sf-designer-code" aria-labelledby="wf-graph-title">
        <h3 id="wf-graph-title" className="ux4g-label-l-strong">
          Canonical graph (SF-CON-WORKFLOW-MODEL nodes and edges)
        </h3>
        <pre tabIndex={0}>{JSON.stringify(compiled.graph, null, 2)}</pre>
      </section>
    </div>
  );
}

/**
 * BPMN 2.0 interoperability through CMP-016's profile: export is a non-executable view of the
 * canonical graph; import is screened (no scripts, engine extensions or named performers) and
 * replaces the canvas only after CMP-016 accepts it.
 */
export function WorkflowBpmn({
  compiled,
  blocked,
  readOnly,
  onImport,
}: {
  compiled: CompiledWorkflow | null;
  blocked: boolean;
  readOnly: boolean;
  onImport: (graph: CanonicalGraph) => void;
}) {
  const [check, setCheck] = useState<GraphCheck | null>(null);
  const [xml, setXml] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function exportXml() {
    if (!compiled) return;
    setBusy(true);
    setError('');
    const res = await workflowApi.check(compiled.graph);
    setBusy(false);
    if (!res.ok) return setError(explain(res.error));
    setCheck(res.body);
  }

  async function importXml() {
    setBusy(true);
    setError('');
    setNotice('');
    const res = await workflowApi.importBpmn(xml);
    setBusy(false);
    if (!res.ok) return setError(explain(res.error));
    onImport(res.body.graph as CanonicalGraph);
    setNotice(
      `Imported ${res.body.graph.nodes.length} steps (graph_hash ${res.body.graph_hash.slice(0, 15)}…). Layout was recomputed.`,
    );
  }

  return (
    <div className="sf-designer-publish-grid">
      <section className="sf-designer-pane" aria-labelledby="bpmn-export-title">
        <h2 id="bpmn-export-title" className="ux4g-heading-xs-strong">
          Export BPMN 2.0 (view only)
        </h2>
        <p className="ux4g-body-s-default">
          CMP-016 validates the graph and renders it with the ServiceForm BPMN profile (
          <code className="sf-hash">isExecutable=&quot;false&quot;</code>). Temporal stays the
          runtime.
        </p>
        <div className="sf-actions">
          <Button disabled={blocked || !compiled || busy} onClick={() => void exportXml()}>
            Check with CMP-016 and export
          </Button>
          {check ? (
            <a
              className="ux4g-btn-outline-primary ux4g-btn-m"
              download={`${compiled?.documentKey ?? 'workflow'}.bpmn`}
              href={`data:application/xml;charset=utf-8,${encodeURIComponent(check.bpmn_xml)}`}
            >
              <Icon name="arrow-down" size={16} /> Download .bpmn
            </a>
          ) : null}
        </div>
        {check ? (
          <>
            <Alert variant="success" title="CMP-016 accepted the graph">
              <span data-testid="workflow-cmp016-check">
                {check.node_count} steps · {check.edge_count} paths · graph_hash{' '}
                {check.graph_hash === compiled?.graphHash ? 'matches the designer' : 'differs'} ·
                runtime {check.runtime}
              </span>
            </Alert>
            <pre className="sf-wf-xml" tabIndex={0} aria-label="BPMN XML">
              {check.bpmn_xml}
            </pre>
          </>
        ) : null}
      </section>
      <section className="sf-designer-pane" aria-labelledby="bpmn-import-title">
        <h2 id="bpmn-import-title" className="ux4g-heading-xs-strong">
          Import BPMN 2.0
        </h2>
        <p className="ux4g-body-s-default">
          Paste a BPMN document. Scripts, condition expressions, engine extensions (Camunda, Zeebe…)
          and named performers are refused; the result is a canonical draft.
        </p>
        <div className="ux4g-input-container ux4g-input-m ux4g-input-default">
          <label className="ux4g-label-m-default" htmlFor="bpmn-xml">
            BPMN XML
          </label>
          <textarea
            id="bpmn-xml"
            className="ux4g-textarea"
            rows={8}
            value={xml}
            disabled={readOnly}
            onChange={(e) => setXml(e.target.value)}
          />
        </div>
        <div className="sf-actions">
          <Button
            variant="outline-primary"
            disabled={readOnly || xml.trim().length === 0 || busy}
            onClick={() => void importXml()}
          >
            Import through CMP-016
          </Button>
          {check ? (
            <Button
              variant="text-primary"
              size="s"
              disabled={readOnly}
              onClick={() => setXml(check.bpmn_xml)}
            >
              Use the exported XML
            </Button>
          ) : null}
        </div>
        {notice ? (
          <Alert variant="success" title="Imported">
            {notice}
          </Alert>
        ) : null}
      </section>
      {error ? (
        <Alert variant="error" title="CMP-016 response">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
