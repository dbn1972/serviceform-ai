'use client';

import { Alert, Button, Icon, Select, TextInput } from '@serviceform/ui-ux4g';
import {
  CLAIM_MODES,
  KIND_INFO,
  NODE_KINDS,
  outgoing,
  type Assignment,
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type WorkflowDesign,
  type WorkflowIssue,
} from '@serviceform/studio-designers/workflow';
import { useState } from 'react';
import type { WorkflowSelection } from './WorkflowCanvas';

export interface WorkflowInspectorActions {
  patchWorkflow: (
    patch: Partial<Pick<WorkflowDesign, 'key' | 'title' | 'version'>>,
    key: string,
  ) => void;
  patchNode: (
    id: string,
    patch: { id?: string; label?: string; kind?: NodeKind; assignment?: Assignment | null },
    key: string,
  ) => void;
  removeNode: (id: string) => void;
  connect: (from: string, to: string) => void;
  patchEdge: (
    id: string,
    patch: { from?: string; to?: string; outcome?: string | null; ruleRef?: string | null },
    key: string,
  ) => void;
  removeEdge: (id: string) => void;
  select: (s: WorkflowSelection) => void;
}

const EMPTY_ASSIGNMENT: Assignment = { role_code: '', organisation_id: '', jurisdiction_id: '' };

function AssignmentEditor({
  node,
  readOnly,
  onChange,
}: {
  node: FlowNode;
  readOnly: boolean;
  onChange: (a: Assignment | null) => void;
}) {
  const a = node.assignment;
  const set = (patch: Partial<Assignment>) => {
    const merged: Record<string, unknown> = { ...(a ?? EMPTY_ASSIGNMENT), ...patch };
    const optional = new Set(['office_id', 'service_scope_id', 'claim_mode']);
    onChange(
      Object.fromEntries(
        Object.entries(merged).filter(([k, v]) => !(optional.has(k) && v === '')),
      ) as unknown as Assignment,
    );
  };
  return (
    <fieldset className="sf-designer-fieldset" disabled={readOnly}>
      <legend className="ux4g-label-m-strong">Assignment</legend>
      <p className="ux4g-body-s-default sf-designer-muted">
        Work goes to a role in an organisation and jurisdiction, never a named officer (Constitution
        §19). Ids come from tenant master data.
      </p>
      {a || node.kind === 'HUMAN_TASK' ? (
        <>
          <TextInput
            id="wf-role"
            label="Role code"
            hint="e.g. CASE_OFFICER"
            value={a?.role_code ?? ''}
            onChange={(e) => set({ role_code: e.target.value.toUpperCase() })}
          />
          <TextInput
            id="wf-org"
            label="Organisation id"
            value={a?.organisation_id ?? ''}
            onChange={(e) => set({ organisation_id: e.target.value.trim() })}
          />
          <TextInput
            id="wf-jur"
            label="Jurisdiction id"
            value={a?.jurisdiction_id ?? ''}
            onChange={(e) => set({ jurisdiction_id: e.target.value.trim() })}
          />
          <TextInput
            id="wf-office"
            label="Office id"
            optional
            value={a?.office_id ?? ''}
            onChange={(e) => set({ office_id: e.target.value.trim() })}
          />
          <TextInput
            id="wf-scope"
            label="Service scope id"
            optional
            value={a?.service_scope_id ?? ''}
            onChange={(e) => set({ service_scope_id: e.target.value.trim() })}
          />
          <Select
            id="wf-claim"
            label="How officers pick up the work"
            value={a?.claim_mode ?? ''}
            placeholder="Default"
            options={CLAIM_MODES.map((m) => ({
              value: m,
              label:
                m === 'CLAIM'
                  ? 'Claim from queue'
                  : m === 'PUSH'
                    ? 'Pushed to an officer'
                    : 'Shared pool',
            }))}
            onChange={(e) =>
              set({ claim_mode: e.target.value as Assignment['claim_mode'] & string })
            }
          />
          {node.kind !== 'HUMAN_TASK' && a ? (
            <Button variant="text-danger" size="s" onClick={() => onChange(null)}>
              Remove assignment
            </Button>
          ) : null}
        </>
      ) : (
        <Button
          variant="outline-primary"
          size="s"
          onClick={() => onChange({ ...EMPTY_ASSIGNMENT })}
        >
          Add assignment
        </Button>
      )}
    </fieldset>
  );
}

function PathEditor({
  design,
  edge,
  readOnly,
  actions,
  prefix,
}: {
  design: WorkflowDesign;
  edge: FlowEdge;
  readOnly: boolean;
  actions: WorkflowInspectorActions;
  prefix: string;
}) {
  return (
    <div className="sf-designer-option">
      <Select
        id={`${prefix}-to`}
        label="Goes to"
        value={edge.to}
        disabled={readOnly}
        options={design.nodes
          .filter((n) => n.id !== edge.from)
          .map((n) => ({ value: n.id, label: `${n.label || n.id} (${n.id})` }))}
        onChange={(e) => actions.patchEdge(edge.id, { to: e.target.value }, `${edge.id}:to`)}
      />
      <TextInput
        id={`${prefix}-outcome`}
        label="When outcome is"
        optional
        size="s"
        disabled={readOnly}
        value={edge.outcome ?? ''}
        onChange={(e) =>
          actions.patchEdge(
            edge.id,
            { outcome: e.target.value.toUpperCase() || null },
            `${edge.id}:outcome`,
          )
        }
      />
      <TextInput
        id={`${prefix}-rule`}
        label="Rule decision ref"
        optional
        size="s"
        disabled={readOnly}
        value={edge.ruleRef ?? ''}
        onChange={(e) =>
          actions.patchEdge(edge.id, { ruleRef: e.target.value || null }, `${edge.id}:rule`)
        }
      />
      {readOnly ? null : (
        <span className="sf-designer-field-actions">
          <Button
            variant="text-danger"
            size="xs"
            aria-label={`Delete path to ${edge.to}`}
            onClick={() => actions.removeEdge(edge.id)}
          >
            <Icon name="trash" size={16} />
          </Button>
        </span>
      )}
    </div>
  );
}

function NodeInspector({
  design,
  node,
  readOnly,
  actions,
}: {
  design: WorkflowDesign;
  node: FlowNode;
  readOnly: boolean;
  actions: WorkflowInspectorActions;
}) {
  const [target, setTarget] = useState('');
  const [draftId, setDraftId] = useState(node.id);
  const outs = outgoing(design, node.id);
  const candidates = design.nodes.filter((n) => n.id !== node.id && n.kind !== 'START');
  return (
    <div className="sf-designer-stack">
      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">{KIND_INFO[node.kind].label}</legend>
        <TextInput
          id="wf-label"
          label="Label"
          value={node.label}
          onChange={(e) =>
            actions.patchNode(node.id, { label: e.target.value }, `${node.id}:label`)
          }
        />
        <TextInput
          id="wf-node-id"
          label="Step id"
          hint="CAPITALS, digits and _. Part of the published graph; paths follow a rename."
          value={draftId}
          onChange={(e) => setDraftId(e.target.value.toUpperCase())}
          onBlur={() => {
            if (draftId && draftId !== node.id && !design.nodes.some((n) => n.id === draftId)) {
              actions.patchNode(node.id, { id: draftId }, `${node.id}:id`);
            } else {
              setDraftId(node.id);
            }
          }}
        />
        <Select
          id="wf-kind"
          label="Step type"
          value={node.kind}
          options={NODE_KINDS.map((k) => ({ value: k, label: KIND_INFO[k].label }))}
          onChange={(e) =>
            actions.patchNode(node.id, { kind: e.target.value as NodeKind }, `${node.id}:kind`)
          }
        />
        <p className="ux4g-body-s-default sf-designer-muted">{KIND_INFO[node.kind].description}</p>
      </fieldset>

      {node.kind === 'HUMAN_TASK' ||
      node.kind === 'WITHDRAWAL_REVIEW' ||
      node.kind === 'CANCELLATION_REVIEW' ||
      node.assignment ? (
        <AssignmentEditor
          node={node}
          readOnly={readOnly}
          onChange={(a) => actions.patchNode(node.id, { assignment: a }, `${node.id}:assignment`)}
        />
      ) : null}

      {node.kind === 'END' ? null : (
        <fieldset className="sf-designer-fieldset">
          <legend className="ux4g-label-m-strong">Paths out ({outs.length})</legend>
          {outs.map((e, i) => (
            <PathEditor
              key={e.id}
              design={design}
              edge={e}
              readOnly={readOnly}
              actions={actions}
              prefix={`out-${i}`}
            />
          ))}
          {readOnly ? null : (
            <div className="sf-designer-row sf-designer-row-end">
              <Select
                id="wf-connect"
                label="Add a path to"
                value={target}
                placeholder="Select a step"
                options={candidates.map((n) => ({
                  value: n.id,
                  label: `${n.label || n.id} (${n.id})`,
                }))}
                onChange={(e) => setTarget(e.target.value)}
              />
              <Button
                variant="outline-primary"
                size="s"
                disabled={!target}
                onClick={() => {
                  actions.connect(node.id, target);
                  setTarget('');
                }}
              >
                Add path
              </Button>
            </div>
          )}
        </fieldset>
      )}

      {readOnly ? null : (
        <Button variant="outline-danger" size="s" onClick={() => actions.removeNode(node.id)}>
          <Icon name="trash" size={16} /> Delete step
        </Button>
      )}
    </div>
  );
}

export function WorkflowChecks({
  issues,
  select,
}: {
  issues: readonly WorkflowIssue[];
  select: (s: WorkflowSelection) => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <section className="sf-designer-checks" aria-labelledby="wf-checks-title">
      <h3 id="wf-checks-title" className="ux4g-label-l-strong">
        Checks{' '}
        <span className={errors > 0 ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-success'}>
          {errors > 0 ? `${errors} to fix` : 'Ready to save'}
        </span>
      </h3>
      {issues.length === 0 ? (
        <p className="ux4g-body-s-default">
          No problems found. CMP-016 checks the graph again before it accepts a draft.
        </p>
      ) : (
        <ul className="sf-designer-check-list">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              <span
                className={
                  issue.severity === 'error' ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-warning'
                }
              >
                {issue.severity === 'error' ? 'Fix' : 'Advice'}
              </span>
              <span className="ux4g-body-s-default">{issue.message}</span>
              {issue.target.kind !== 'workflow' ? (
                <Button
                  variant="text-primary"
                  size="xs"
                  onClick={() => select(issue.target as WorkflowSelection)}
                >
                  Show
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Properties of the selected step or path; with nothing selected, workflow settings + checks. */
export function WorkflowInspector({
  design,
  selection,
  issues,
  readOnly,
  actions,
}: {
  design: WorkflowDesign;
  selection: WorkflowSelection;
  issues: readonly WorkflowIssue[];
  readOnly: boolean;
  actions: WorkflowInspectorActions;
}) {
  let title = 'Workflow settings';
  let body = null;
  if (selection.kind === 'node') {
    const node = design.nodes.find((n) => n.id === selection.id);
    if (node) {
      title = 'Step properties';
      body = (
        <NodeInspector
          key={node.id}
          design={design}
          node={node}
          readOnly={readOnly}
          actions={actions}
        />
      );
    }
  } else if (selection.kind === 'edge') {
    const edge = design.edges.find((e) => e.id === selection.id);
    if (edge) {
      title = 'Path properties';
      body = (
        <div className="sf-designer-stack">
          <p className="ux4g-body-m-default">
            From <code className="sf-hash">{edge.from}</code>
          </p>
          <PathEditor
            design={design}
            edge={edge}
            readOnly={readOnly}
            actions={actions}
            prefix="edge"
          />
          <p className="ux4g-body-s-default sf-designer-muted">
            Outcomes are committed case commands (CMP-015). A rule reference routes on a
            deterministic GoRules decision; Temporal never decides.
          </p>
        </div>
      );
    }
  }
  if (!body) {
    body = (
      <div className="sf-designer-stack">
        <fieldset className="sf-designer-fieldset" disabled={readOnly}>
          <legend className="ux4g-label-m-strong">Workflow</legend>
          <TextInput
            id="wf-title"
            label="Title"
            value={design.title}
            onChange={(e) => actions.patchWorkflow({ title: e.target.value }, 'title')}
          />
          <TextInput
            id="wf-key"
            label="Workflow key"
            hint="CMP-016 definition key, e.g. lab.trade-licence.case-flow"
            value={design.key}
            onChange={(e) => actions.patchWorkflow({ key: e.target.value.trim() }, 'key')}
          />
          <TextInput
            id="wf-version"
            label="Version"
            hint="major.minor.patch — each frozen version is immutable"
            value={design.version}
            onChange={(e) => actions.patchWorkflow({ version: e.target.value.trim() }, 'version')}
          />
        </fieldset>
        <WorkflowChecks issues={issues} select={actions.select} />
      </div>
    );
  }
  return (
    <aside className="sf-designer-pane sf-designer-inspector" aria-label="Properties">
      <div className="sf-designer-inspector-head">
        <h2 className="ux4g-heading-xs-strong">{title}</h2>
        {selection.kind !== 'workflow' ? (
          <Button
            variant="text-primary"
            size="xs"
            onClick={() => actions.select({ kind: 'workflow' })}
          >
            Workflow settings
          </Button>
        ) : null}
      </div>
      {readOnly ? (
        <Alert variant="info" title="Frozen version">
          This version is immutable. Start the next version to make changes.
        </Alert>
      ) : null}
      {body}
    </aside>
  );
}
