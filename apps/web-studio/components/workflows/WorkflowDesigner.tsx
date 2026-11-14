'use client';

import { Alert, Button, Icon } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  addEdge,
  addNode,
  blankWorkflow,
  buildWorkflowDocument,
  importWorkflow,
  lintWorkflow,
  moveNode,
  relayout,
  removeEdge,
  removeNode,
  sizeOf,
  updateEdge,
  updateNode,
  workflowDocumentOf,
  workflowHasErrors,
  WORKFLOW_TEMPLATES,
  type CanonicalGraph,
  type CompiledWorkflow,
  type NodeKind,
  type WorkflowDesign,
} from '@serviceform/studio-designers/workflow';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '../../lib/designer-history';
import { nextMinor, type WorkflowSourceRef } from '../../lib/designer-source';
import { explain, metadataApi, readSession, type SessionState } from '../../lib/studio-api';
import type { DocState } from '../forms/DesignerPublish';
import { WorkflowCanvas, type WorkflowSelection } from './WorkflowCanvas';
import { WorkflowChecks, WorkflowInspector } from './WorkflowInspector';
import { WorkflowPalette } from './WorkflowPalette';
import { WorkflowPublish } from './WorkflowPublish';
import { WorkflowBpmn, WorkflowOutline, WorkflowSchema } from './WorkflowViews';

export type WorkflowSource = WorkflowSourceRef;

type Tab = 'design' | 'outline' | 'schema' | 'bpmn' | 'publish';

const TABS: {
  id: Tab;
  label: string;
  icon: 'sliders' | 'layers' | 'code' | 'document' | 'shield';
}[] = [
  { id: 'design', label: 'Design', icon: 'sliders' },
  { id: 'outline', label: 'Outline', icon: 'layers' },
  { id: 'schema', label: 'Schema', icon: 'code' },
  { id: 'bpmn', label: 'BPMN', icon: 'document' },
  { id: 'publish', label: 'Publish', icon: 'shield' },
];

function initial(source: WorkflowSource): WorkflowDesign {
  if (source.kind === 'template') {
    const t = WORKFLOW_TEMPLATES.find((x) => x.id === source.id);
    if (t) return importWorkflow(t.graph(), { key: t.key, title: t.title, version: '1.0.0' });
  }
  return blankWorkflow();
}

/**
 * ServiceForm Studio workflow designer: a canvas over the canonical ServiceForm Workflow Model
 * (CMP-016). Temporal is the runtime; BPMN is import/export through CMP-016's profile; nothing
 * here executes or decides a case.
 */
export function WorkflowDesigner({ source }: { source: WorkflowSource }) {
  const history = useHistory<WorkflowDesign>(() => initial(source));
  const design = history.value;
  const [tab, setTab] = useState<Tab>('design');
  const [selection, setSelection] = useState<WorkflowSelection>({ kind: 'workflow' });
  const [compiled, setCompiled] = useState<CompiledWorkflow | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(false);

  const issues = useMemo(() => lintWorkflow(design), [design]);
  const blocked = workflowHasErrors(issues);
  const readOnly = doc?.status === 'PUBLISHED' && compiled?.graphHash === doc.savedHash;

  useEffect(() => {
    let live = true;
    void buildWorkflowDocument(design).then((c) => {
      if (live) setCompiled(c);
    });
    return () => {
      live = false;
    };
  }, [design]);

  useEffect(() => {
    void readSession().then(setSession);
  }, []);

  useEffect(() => {
    if (source.kind !== 'document' || loaded.current) return;
    loaded.current = true;
    void metadataApi.read(source.id).then((res) => {
      if (!res.ok) return setLoadError(explain(res.error));
      const found = workflowDocumentOf(res.body.payload);
      if (!found)
        return setLoadError('This metadata document was not authored with the workflow designer.');
      const labels = Object.fromEntries(Object.entries(found.layout).map(([k, v]) => [k, v.label]));
      const imported = importWorkflow(found.graph, {
        key: found.key,
        title: found.title,
        version: found.version,
        labels,
      });
      const placed = {
        ...imported,
        nodes: imported.nodes.map((n) => {
          const p = found.layout[n.id];
          return p ? { ...n, x: p.x, y: p.y } : n;
        }),
      };
      history.reset(placed);
      setDoc({
        id: res.body.document_id,
        key: res.body.document_key,
        status: res.body.status,
        savedHash: found.graphHash,
      });
    });
  }, [source, history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);

  const apply = useCallback(
    (next: WorkflowDesign, coalesce?: string) => {
      if (!readOnly) history.apply(next, coalesce);
    },
    [history, readOnly],
  );

  /** Right of the selected step (or of the graph), moved down until it overlaps nothing. */
  const placeNear = (kind: NodeKind): { x: number; y: number } => {
    const sel =
      selection.kind === 'node' ? design.nodes.find((n) => n.id === selection.id) : undefined;
    const size = sizeOf(kind);
    const pos = sel
      ? { x: sel.x + sizeOf(sel.kind).w + 72, y: sel.y + (sizeOf(sel.kind).h - size.h) / 2 }
      : { x: Math.max(40, ...design.nodes.map((n) => n.x + sizeOf(n.kind).w + 72)), y: 40 };
    const overlaps = (p: { x: number; y: number }) =>
      design.nodes.some((n) => {
        const s = sizeOf(n.kind);
        return (
          p.x < n.x + s.w + 24 &&
          p.x + size.w + 24 > n.x &&
          p.y < n.y + s.h + 32 &&
          p.y + size.h + 32 > n.y
        );
      });
    for (let i = 0; i < 40 && overlaps(pos); i += 1) pos.y += 104;
    return pos;
  };

  const add = (kind: NodeKind, at?: { x: number; y: number }) => {
    const res = addNode(design, kind, at ?? placeNear(kind));
    let next = res.design;
    if (selection.kind === 'node' && !at) {
      const from = design.nodes.find((n) => n.id === selection.id);
      if (from && from.kind !== 'END') next = addEdge(next, from.id, res.id).design;
    }
    apply(next);
    setSelection({ kind: 'node', id: res.id });
  };

  const connect = (from: string, to: string) => {
    if (design.edges.some((e) => e.from === from && e.to === to && !e.outcome && !e.ruleRef))
      return;
    const res = addEdge(design, from, to);
    apply(res.design);
    setSelection({ kind: 'edge', id: res.id });
  };

  const startNextVersion = () => {
    history.reset({ ...design, version: nextMinor(design.version) });
    setDoc(null);
    setNotice(`Started version ${nextMinor(design.version)}. The frozen version stays unchanged.`);
  };

  const errors = issues.filter((i) => i.severity === 'error').length;
  const status = doc
    ? doc.savedHash === compiled?.graphHash
      ? doc.status === 'PUBLISHED'
        ? 'FROZEN'
        : doc.status
      : 'UNSAVED CHANGES'
    : 'NOT SAVED';

  const inspectorActions = {
    patchWorkflow: (
      patch: Partial<Pick<WorkflowDesign, 'key' | 'title' | 'version'>>,
      key: string,
    ) => apply({ ...design, ...patch }, `wf:${key}`),
    patchNode: (id: string, patch: Parameters<typeof updateNode>[2], key: string) => {
      apply(updateNode(design, id, patch), key);
      if (patch.id) setSelection({ kind: 'node', id: patch.id });
    },
    removeNode: (id: string) => {
      apply(removeNode(design, id));
      if (selection.kind !== 'workflow') setSelection({ kind: 'workflow' });
    },
    connect,
    patchEdge: (id: string, patch: Parameters<typeof updateEdge>[2], key: string) =>
      apply(updateEdge(design, id, patch), key),
    removeEdge: (id: string) => {
      apply(removeEdge(design, id));
      if (selection.kind === 'edge' && selection.id === id) setSelection({ kind: 'workflow' });
    },
    select: (s: WorkflowSelection) => {
      setSelection(s);
      setTab('design');
    },
  };

  return (
    <div className="sf-designer">
      <header className="sf-designer-bar">
        <div className="sf-designer-bar-title">
          <p className="ux4g-label-s-default sf-designer-muted">
            Workflow designer · CMP-016 · Temporal runtime
          </p>
          <h1 className="ux4g-heading-m-strong">{design.title || 'Untitled workflow'}</h1>
          <div className="sf-tag-row">
            <code className="sf-hash">
              {design.key} · v{design.version}
            </code>
            <span
              className={
                status === 'FROZEN'
                  ? 'ux4g-tag-tonal-success'
                  : status === 'DRAFT' || status === 'VALIDATED'
                    ? 'ux4g-tag-tonal-info'
                    : 'ux4g-tag-tonal-warning'
              }
              data-testid="workflow-status"
            >
              {status}
            </span>
            {compiled ? (
              <span className="ux4g-tag-outline-neutral" title={compiled.graphHash}>
                {shortHash(compiled.graphHash)}
              </span>
            ) : null}
            <span className="ux4g-tag-outline-neutral">
              {design.nodes.length} steps · {design.edges.length} paths
            </span>
            <span className="ux4g-tag-outline-warning">SAMPLE_LAB · not CERTIFIED</span>
          </div>
        </div>
        <div className="sf-designer-bar-actions">
          <Button
            variant="text-neutral"
            size="s"
            disabled={!history.canUndo || readOnly}
            aria-label="Undo"
            onClick={history.undo}
          >
            <Icon name="undo" size={18} />
          </Button>
          <Button
            variant="text-neutral"
            size="s"
            disabled={!history.canRedo || readOnly}
            aria-label="Redo"
            onClick={history.redo}
          >
            <Icon name="redo" size={18} />
          </Button>
          <Button
            variant="outline-neutral"
            size="s"
            disabled={readOnly}
            onClick={() => apply(relayout(design))}
          >
            <Icon name="layers" size={16} /> Tidy layout
          </Button>
          <Button
            variant={errors > 0 ? 'outline-danger' : 'outline-neutral'}
            size="s"
            onClick={() => {
              setTab('design');
              setSelection({ kind: 'workflow' });
            }}
          >
            {errors > 0 ? `${errors} to fix` : 'No errors'}
          </Button>
          <Button size="s" onClick={() => setTab('publish')}>
            Save &amp; publish
          </Button>
        </div>
        <div className="sf-designer-tabs" role="tablist" aria-label="Designer views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`wf-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`wf-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`sf-designer-tab${tab === t.id ? ' sf-designer-tab-current' : ''}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const i = TABS.findIndex((x) => x.id === tab);
                const next =
                  TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
                if (next) {
                  setTab(next.id);
                  document.getElementById(`wf-tab-${next.id}`)?.focus();
                }
              }}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {loadError ? (
        <Alert variant="error" title="Could not open the draft">
          {loadError}
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="info" title="Note">
          {notice}
        </Alert>
      ) : null}
      {readOnly ? (
        <Alert variant="info" title={`Version ${design.version} is frozen`}>
          Frozen versions are immutable and pinned by graph_hash.{' '}
          <Button variant="text-primary" size="s" onClick={startNextVersion}>
            Start version {nextMinor(design.version)}
          </Button>
        </Alert>
      ) : null}

      <div
        id={`wf-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`wf-tab-${tab}`}
        className="sf-designer-panel"
      >
        {tab === 'design' ? (
          <div className="sf-designer-grid sf-wf-grid-layout">
            <WorkflowPalette disabled={readOnly} onAdd={(k) => add(k)} />
            <WorkflowCanvas
              design={design}
              selection={selection}
              issues={issues}
              readOnly={readOnly}
              actions={{
                select: setSelection,
                move: (id, x, y, settle) =>
                  apply(moveNode(design, id, x, y), settle ? undefined : `move:${id}`),
                connect,
                dropKind: (kind, x, y) => add(kind, { x, y }),
                removeNode: inspectorActions.removeNode,
                removeEdge: inspectorActions.removeEdge,
              }}
            />
            <WorkflowInspector
              design={design}
              selection={selection}
              issues={issues}
              readOnly={readOnly}
              actions={inspectorActions}
            />
          </div>
        ) : null}
        {tab === 'outline' ? (
          <WorkflowOutline design={design} select={inspectorActions.select} />
        ) : null}
        {tab === 'schema' ? <WorkflowSchema compiled={compiled} /> : null}
        {tab === 'bpmn' ? (
          <WorkflowBpmn
            compiled={compiled}
            blocked={blocked}
            readOnly={readOnly}
            onImport={(graph: CanonicalGraph) =>
              apply(
                importWorkflow(graph, {
                  key: design.key,
                  title: design.title,
                  version: design.version,
                }),
              )
            }
          />
        ) : null}
        {tab === 'publish' ? (
          <div className="sf-designer-publish-grid">
            <WorkflowPublish
              title={design.title}
              compiled={compiled}
              blocked={blocked}
              doc={doc}
              onDoc={setDoc}
              session={session}
            />
            <aside className="sf-designer-pane" aria-label="Checks">
              <WorkflowChecks issues={issues} select={inspectorActions.select} />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
