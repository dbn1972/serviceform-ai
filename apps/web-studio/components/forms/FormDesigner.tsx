'use client';

import { Alert, Button, Icon } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  addField,
  addSection,
  addStep,
  buildFormDocument,
  changeKind,
  compileForm,
  duplicateField,
  emptyForm,
  findField,
  findSection,
  formPackageOf,
  hasErrors,
  importForm,
  lintForm,
  moveField,
  moveFieldBy,
  moveSection,
  moveStep,
  removeField,
  removeSection,
  removeStep,
  SECTION_PALETTE,
  updateField,
  updateForm,
  updateSection,
  updateStep,
  FIELD_PALETTE,
  type CompiledForm,
  type DesignerForm,
  type FieldPaletteItem,
} from '@serviceform/studio-designers/forms';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '../../lib/designer-history';
import { nextMinor, type DesignerSource } from '../../lib/designer-source';
import { metadataApi, readSession, explain, type SessionState } from '../../lib/studio-api';
import { DesignerCanvas, type DropPayload, type Selection } from './DesignerCanvas';
import { ChecksList, DesignerInspector } from './DesignerInspector';
import { DesignerPalette } from './DesignerPalette';
import { DesignerPreview } from './DesignerPreview';
import { DesignerPublish, type DocState } from './DesignerPublish';
import { DesignerSchema } from './DesignerSchema';

type Tab = 'design' | 'preview' | 'schema' | 'publish';

const TABS: { id: Tab; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'preview', label: 'Preview' },
  { id: 'schema', label: 'Schema' },
  { id: 'publish', label: 'Publish' },
];

function initialForm(source: DesignerSource): DesignerForm {
  if (source.kind === 'template') return importForm(source.form, source.version).form;
  return emptyForm();
}

/**
 * ServiceForm Studio forms designer. Authors a CMP-009 FORM package (JSON Schema + UX4G UI
 * schema) visually, previews it with the citizen renderer and takes it through CMP-033 draft,
 * freeze and CMP-051 maker-checker. Nothing here decides eligibility or publishes by itself.
 */
export function FormDesigner({ source }: { source: DesignerSource }) {
  const history = useHistory<DesignerForm>(() => initialForm(source));
  const form = history.value;
  const [tab, setTab] = useState<Tab>('design');
  const [selection, setSelection] = useState<Selection>({ kind: 'form' });
  const [stepIndex, setStepIndex] = useState(0);
  const [compiled, setCompiled] = useState<CompiledForm | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const loaded = useRef(false);

  const issues = useMemo(() => lintForm(form), [form]);
  const blocked = hasErrors(issues);
  const formPackage = useMemo(() => compileForm(form), [form]);
  const readOnly = doc?.status === 'PUBLISHED' && compiled?.contentHash === doc.savedHash;
  const sourceRef = source.kind === 'template' ? source.source : undefined;

  useEffect(() => {
    let live = true;
    void buildFormDocument(form, sourceRef).then((c) => {
      if (live) setCompiled(c);
    });
    return () => {
      live = false;
    };
  }, [form, sourceRef]);

  useEffect(() => {
    void readSession().then(setSession);
  }, []);

  useEffect(() => {
    if (source.kind !== 'document' || loaded.current) return;
    loaded.current = true;
    void metadataApi.read(source.id).then((res) => {
      if (!res.ok) {
        setLoadError(explain(res.error));
        return;
      }
      const found = formPackageOf(res.body.payload);
      if (!found) {
        setLoadError('This metadata document was not authored with the forms designer.');
        return;
      }
      const imported = importForm(found.formPackage, found.version ?? '1.0.0');
      history.reset(imported.form);
      setDoc({
        id: res.body.document_id,
        key: res.body.document_key,
        status: res.body.status,
        savedHash: found.contentHash,
      });
      if (imported.warnings.length > 0) {
        setNotice(imported.warnings.map((w) => w.message).join(' '));
      }
    });
  }, [source, history]);

  useEffect(() => {
    if (stepIndex > form.steps.length - 1) setStepIndex(Math.max(0, form.steps.length - 1));
  }, [form.steps.length, stepIndex]);

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
    (next: DesignerForm, coalesce?: string) => {
      if (readOnly) return;
      history.apply(next, coalesce);
    },
    [history, readOnly],
  );

  const currentStep = form.steps[Math.min(stepIndex, form.steps.length - 1)];

  /** Section that palette clicks add to: the selection, else the last section of the step. */
  const targetSection = (): string | null => {
    if (selection.kind === 'section') return selection.id;
    if (selection.kind === 'field') return findField(form, selection.id)?.section.id ?? null;
    const sections = currentStep?.sections ?? [];
    return sections[sections.length - 1]?.id ?? null;
  };

  const addFromPalette = (item: FieldPaletteItem, sectionId?: string, index?: number) => {
    let base = form;
    let target = sectionId ?? targetSection();
    if (!target && currentStep) {
      const created = addSection(base, currentStep.id);
      base = created.form;
      target = created.id;
    }
    if (!target) return;
    const res = addField(base, target, item.create(), index);
    apply(res.form);
    setSelection({ kind: 'field', id: res.id });
  };

  const addSectionFromPalette = (id: string) => {
    const item = SECTION_PALETTE.find((p) => p.id === id);
    if (!item || !currentStep) return;
    const res = addSection(form, currentStep.id, item.create());
    apply(res.form);
    setSelection({ kind: 'section', id: res.id });
  };

  const drop = (payload: DropPayload, sectionId: string, index: number) => {
    if ('palette' in payload) {
      const field = FIELD_PALETTE.find((p) => p.id === payload.palette);
      if (field) addFromPalette(field, sectionId, index);
      else addSectionFromPalette(payload.palette);
      return;
    }
    const ref = findField(form, payload.field);
    if (!ref) return;
    const adjusted = ref.section.id === sectionId && ref.fieldIndex < index ? index - 1 : index;
    apply(moveField(form, payload.field, sectionId, adjusted));
    setSelection({ kind: 'field', id: payload.field });
  };

  const select = (s: Selection) => {
    setSelection(s);
    const stepOf = (id: string) => form.steps.findIndex((st) => st.id === id);
    if (s.kind === 'step') setStepIndex(Math.max(0, stepOf(s.id)));
    if (s.kind === 'section') {
      const found = findSection(form, s.id);
      if (found) setStepIndex(found.stepIndex);
    }
    if (s.kind === 'field') {
      const ref = findField(form, s.id);
      if (ref) setStepIndex(ref.stepIndex);
    }
    setTab('design');
  };

  const startNextVersion = () => {
    const next = updateForm(form, { version: nextMinor(form.version) });
    history.reset(next);
    setDoc(null);
    setNotice(`Started version ${next.version}. The frozen version stays unchanged.`);
  };

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const docStatus = doc
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
            {source.kind === 'template' ? `From ${source.label}` : 'Forms designer'}
          </p>
          <h1 className="ux4g-heading-m-strong">{form.title || 'Untitled form'}</h1>
          <div className="sf-tag-row">
            <code className="sf-hash">
              {form.formId} · v{form.version}
            </code>
            <span
              className={
                docStatus === 'FROZEN'
                  ? 'ux4g-tag-tonal-success'
                  : docStatus === 'VALIDATED' || docStatus === 'DRAFT'
                    ? 'ux4g-tag-tonal-info'
                    : 'ux4g-tag-tonal-warning'
              }
              data-testid="designer-status"
            >
              {docStatus}
            </span>
            {compiled ? (
              <span className="ux4g-tag-outline-neutral" title={compiled.contentHash}>
                {shortHash(compiled.contentHash)}
              </span>
            ) : null}
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
            onClick={() => {
              setTab('design');
              setSelection({ kind: 'form' });
            }}
          >
            {errors > 0 ? `${errors} to fix` : 'No errors'}
            {warnings > 0 ? ` · ${warnings} advice` : ''}
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
              id={`designer-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`designer-panel-${t.id}`}
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
                  document.getElementById(`designer-tab-${next.id}`)?.focus();
                }
              }}
            >
              <Icon
                name={
                  t.id === 'design'
                    ? 'sliders'
                    : t.id === 'preview'
                      ? 'eye'
                      : t.id === 'schema'
                        ? 'code'
                        : 'shield'
                }
                size={16}
              />
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
        <Alert variant="info" title={`Version ${form.version} is frozen`}>
          Frozen versions are immutable and pinned by content hash.{' '}
          <Button variant="text-primary" size="s" onClick={startNextVersion}>
            Start version {nextMinor(form.version)}
          </Button>
        </Alert>
      ) : null}

      <div
        id={`designer-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`designer-tab-${tab}`}
        className="sf-designer-panel"
      >
        {tab === 'design' ? (
          <div className="sf-designer-grid">
            <DesignerPalette
              disabled={readOnly}
              onAddField={(item) => addFromPalette(item)}
              onAddSection={addSectionFromPalette}
            />
            <DesignerCanvas
              form={form}
              stepIndex={Math.min(stepIndex, Math.max(0, form.steps.length - 1))}
              onStepIndex={setStepIndex}
              selection={selection}
              issues={issues}
              readOnly={readOnly}
              handlers={{
                select,
                drop,
                moveField: (id, d) => apply(moveFieldBy(form, id, d)),
                duplicateField: (id) => {
                  const res = duplicateField(form, id);
                  apply(res.form);
                  setSelection({ kind: 'field', id: res.id });
                },
                removeField: (id) => {
                  apply(removeField(form, id));
                  setSelection({ kind: 'form' });
                },
                addStep: () => {
                  const res = addStep(form);
                  apply(res.form);
                  const at = res.form.steps.findIndex((s) => s.id === res.id);
                  setStepIndex(at);
                  setSelection({ kind: 'step', id: res.id });
                },
                moveSection: (id, d) => apply(moveSection(form, id, d)),
                removeSection: (id) => {
                  apply(removeSection(form, id));
                  setSelection({ kind: 'form' });
                },
              }}
            />
            <DesignerInspector
              form={form}
              selection={selection}
              issues={issues}
              readOnly={readOnly}
              handlers={{
                patchForm: (patch, key) => apply(updateForm(form, patch), `form:${key}`),
                patchStep: (id, patch, key) => apply(updateStep(form, id, patch), key),
                moveStep: (id, d) => {
                  apply(moveStep(form, id, d));
                  setStepIndex((i) => Math.max(0, Math.min(form.steps.length - 1, i + d)));
                },
                removeStep: (id) => {
                  apply(removeStep(form, id));
                  setSelection({ kind: 'form' });
                  setStepIndex(0);
                },
                patchSection: (id, patch, key) => apply(updateSection(form, id, patch), key),
                patchField: (id, patch, key) => apply(updateField(form, id, patch), key),
                changeKind: (id, kind) => apply(changeKind(form, id, kind)),
                select,
              }}
            />
          </div>
        ) : null}
        {tab === 'preview' ? <DesignerPreview form={formPackage} /> : null}
        {tab === 'schema' ? <DesignerSchema compiled={compiled} /> : null}
        {tab === 'publish' ? (
          <div className="sf-designer-publish-grid">
            <DesignerPublish
              title={form.title}
              compiled={compiled}
              blocked={blocked}
              doc={doc}
              onDoc={setDoc}
              session={session}
            />
            <aside className="sf-designer-pane" aria-label="Checks">
              <ChecksList issues={issues} select={select} />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
