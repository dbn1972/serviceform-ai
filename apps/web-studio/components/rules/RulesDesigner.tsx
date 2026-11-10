'use client';

import { Alert, Button, Icon } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  blankRules,
  buildRulesDocument,
  lintRules,
  rulesDocumentOf,
  rulesHaveErrors,
  RULE_TEMPLATES,
  type CompiledRules,
  type RuleDesign,
} from '@serviceform/studio-designers/rules';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '../../lib/designer-history';
import { tally, testCases, type TestRunState } from '../../lib/rule-runs';
import { nextMinor, type WorkflowSourceRef } from '../../lib/designer-source';
import {
  explain,
  metadataApi,
  readSession,
  rulesApi,
  type SessionState,
} from '../../lib/studio-api';
import type { DocState } from '../forms/DesignerPublish';
import { DecisionTable } from './DecisionTable';
import { RuleChecks, RuleInspector, type RuleSelection } from './RuleInspector';
import { RuleTests } from './RuleTests';
import { RulesJdm } from './RulesJdm';
import { RulesPublish } from './RulesPublish';

export type RulesSource = WorkflowSourceRef;

type Tab = 'table' | 'tests' | 'jdm' | 'publish';

const TABS: { id: Tab; label: string; icon: 'sliders' | 'check-circle' | 'code' | 'shield' }[] = [
  { id: 'table', label: 'Decision table', icon: 'sliders' },
  { id: 'tests', label: 'Tests', icon: 'check-circle' },
  { id: 'jdm', label: 'JDM', icon: 'code' },
  { id: 'publish', label: 'Publish', icon: 'shield' },
];

function initial(source: RulesSource): RuleDesign {
  if (source.kind === 'template') {
    const t = RULE_TEMPLATES.find((x) => x.id === source.id);
    if (t) return t.create();
  }
  return blankRules();
}

/**
 * ServiceForm Studio rules designer: a GoRules (JDM) decision table authored in plain language,
 * tested on CMP-008's ZEN engine and frozen in CMP-033. Rule results are advisory inputs for
 * officers and the workflow; no rule approves or rejects an application (Constitution §20).
 */
export function RulesDesigner({ source }: { source: RulesSource }) {
  const history = useHistory<RuleDesign>(() => initial(source));
  const design = history.value;
  const [tab, setTab] = useState<Tab>('table');
  const [selection, setSelection] = useState<RuleSelection>({ kind: 'pack' });
  const [compiled, setCompiled] = useState<CompiledRules | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [run, setRun] = useState<TestRunState | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(false);

  const issues = useMemo(() => lintRules(design), [design]);
  const blocked = rulesHaveErrors(issues);
  const readOnly = doc?.status === 'PUBLISHED' && compiled?.contentHash === doc.savedHash;
  const cases = useMemo(() => testCases(design), [design]);
  const runKey = compiled
    ? `${compiled.contentHash}|${JSON.stringify(cases.map((c) => [c.id, c.inputs]))}`
    : '';
  const fresh = run !== null && run.key === runKey;
  const counts = fresh && run ? tally(design, run.body) : null;
  const allPass =
    counts !== null &&
    counts.total > 0 &&
    counts.passed === counts.total &&
    run?.body.content_hash === compiled?.contentHash;

  useEffect(() => {
    let live = true;
    void buildRulesDocument(design).then((c) => {
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
      const found = rulesDocumentOf(res.body.payload);
      if (!found)
        return setLoadError('This metadata document was not authored with the rules designer.');
      history.reset(found.design);
      setDoc({
        id: res.body.document_id,
        key: res.body.document_key,
        status: res.body.status,
        savedHash: found.contentHash,
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
    (next: RuleDesign, coalesce?: string) => {
      if (!readOnly) history.apply(next, coalesce);
    },
    [history, readOnly],
  );

  const runTests = useCallback(async () => {
    if (!compiled || cases.length === 0) return;
    const key = runKey;
    setRunning(true);
    setRunError('');
    const res = await rulesApi.test(compiled.pack, cases);
    setRunning(false);
    if (!res.ok) return setRunError(explain(res.error));
    setRun({ key, body: res.body });
  }, [compiled, cases, runKey]);

  const startNextVersion = () => {
    history.reset({ ...design, version: nextMinor(design.version) });
    setDoc(null);
    setNotice(`Started version ${nextMinor(design.version)}. The frozen version stays unchanged.`);
  };

  const select = (s: RuleSelection) => {
    setSelection(s);
    setTab(s.kind === 'test' ? 'tests' : 'table');
  };

  const errors = issues.filter((i) => i.severity === 'error').length;
  const status = doc
    ? doc.savedHash === compiled?.contentHash
      ? doc.status === 'PUBLISHED'
        ? 'FROZEN'
        : doc.status
      : 'UNSAVED CHANGES'
    : 'NOT SAVED';

  return (
    <div className="sf-designer">
      <header className="sf-designer-bar">
        <div className="sf-designer-bar-title">
          <p className="ux4g-label-s-default sf-designer-muted">
            Rules designer · CMP-008 · GoRules JDM on the ZEN engine
          </p>
          <h1 className="ux4g-heading-m-strong">{design.title || 'Untitled rule pack'}</h1>
          <div className="sf-tag-row">
            <code className="sf-hash">
              {design.packKey} · v{design.version}
            </code>
            <span
              className={
                status === 'FROZEN'
                  ? 'ux4g-tag-tonal-success'
                  : status === 'DRAFT' || status === 'VALIDATED'
                    ? 'ux4g-tag-tonal-info'
                    : 'ux4g-tag-tonal-warning'
              }
              data-testid="rules-status"
            >
              {status}
            </span>
            {compiled ? (
              <span className="ux4g-tag-outline-neutral" title={compiled.contentHash}>
                {shortHash(compiled.contentHash)}
              </span>
            ) : null}
            <span className="ux4g-tag-outline-neutral">
              {design.rows.length} rows · {design.tests.length} tests
            </span>
            <span className="ux4g-tag-tonal-info">Advisory · never a decision</span>
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
            variant={errors > 0 ? 'outline-danger' : 'outline-neutral'}
            size="s"
            onClick={() => select({ kind: 'pack' })}
          >
            {errors > 0 ? `${errors} to fix` : 'No errors'}
          </Button>
          <Button
            variant="outline-primary"
            size="s"
            disabled={running || cases.length === 0 || !compiled}
            onClick={() => {
              setTab('tests');
              void runTests();
            }}
          >
            <Icon name="check-circle" size={16} /> {running ? 'Running…' : 'Run tests'}
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
              id={`rules-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`rules-panel-${t.id}`}
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
                  document.getElementById(`rules-tab-${next.id}`)?.focus();
                }
              }}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
              {t.id === 'tests' && counts ? (
                <span
                  className={
                    counts.failed > 0
                      ? 'ux4g-tag-tonal-error'
                      : allPass
                        ? 'ux4g-tag-tonal-success'
                        : 'ux4g-tag-tonal-warning'
                  }
                >
                  {counts.passed}/{counts.total}
                </span>
              ) : null}
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
          Frozen versions are immutable and pinned by content_hash.{' '}
          <Button variant="text-primary" size="s" onClick={startNextVersion}>
            Start version {nextMinor(design.version)}
          </Button>
        </Alert>
      ) : null}

      <div
        id={`rules-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`rules-tab-${tab}`}
        className="sf-designer-panel"
      >
        {tab === 'table' ? (
          <div className="sf-rules-grid">
            <DecisionTable
              design={design}
              issues={issues}
              selection={selection}
              readOnly={readOnly}
              run={fresh ? run : null}
              apply={apply}
              select={setSelection}
            />
            <RuleInspector
              design={design}
              issues={issues}
              selection={selection}
              readOnly={readOnly}
              apply={apply}
              select={select}
            />
          </div>
        ) : null}
        {tab === 'tests' ? (
          <RuleTests
            design={design}
            issues={issues}
            selection={selection}
            readOnly={readOnly}
            run={run}
            fresh={fresh}
            running={running}
            runError={runError}
            contentHash={compiled?.contentHash ?? null}
            onRun={() => void runTests()}
            apply={apply}
            select={setSelection}
          />
        ) : null}
        {tab === 'jdm' ? <RulesJdm compiled={compiled} /> : null}
        {tab === 'publish' ? (
          <div className="sf-designer-publish-grid">
            <RulesPublish
              title={design.title}
              compiled={compiled}
              blocked={blocked}
              doc={doc}
              onDoc={setDoc}
              session={session}
              testsPassed={allPass}
              testCount={cases.length}
              running={running}
              onRun={() => void runTests()}
            />
            <aside className="sf-designer-pane" aria-label="Checks">
              <RuleChecks issues={issues} select={select} />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
