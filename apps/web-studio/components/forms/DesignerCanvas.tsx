'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import {
  KIND_LABEL,
  type DesignerField,
  type DesignerForm,
  type DesignerSection,
  type DesignIssue,
  type VisibilityRule,
} from '@serviceform/studio-designers/forms';
import { useState, type DragEvent } from 'react';
import { PALETTE_MIME } from './DesignerPalette';

export type Selection =
  | { kind: 'form' }
  | { kind: 'step'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'field'; id: string };

const FIELD_MIME = 'application/x-sf-field';

export type DropPayload = { palette: string } | { field: string };

function readDrop(e: DragEvent): DropPayload | null {
  const palette = e.dataTransfer.getData(PALETTE_MIME);
  if (palette) return { palette };
  const field = e.dataTransfer.getData(FIELD_MIME);
  return field ? { field } : null;
}

function accepts(e: DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types);
  return types.includes(PALETTE_MIME) || types.includes(FIELD_MIME);
}

function describeRule(form: DesignerForm, rule: VisibilityRule): string {
  for (const step of form.steps) {
    for (const s of step.sections) {
      for (const f of s.fields) {
        const path = s.object ? `${s.object.key}/${f.key}` : f.key;
        if (path !== rule.field) continue;
        const values = rule.oneOf ?? (rule.equals === undefined ? [] : [rule.equals]);
        const shown = values.map((v) => {
          if (typeof v === 'boolean') return v ? 'Yes' : 'No';
          return f.options?.find((o) => o.value === v)?.label ?? String(v);
        });
        return `${f.label || path} is ${shown.join(' or ') || '…'}`;
      }
    }
  }
  return rule.field;
}

function requirementTag(f: DesignerField) {
  if (f.required) return <span className="ux4g-tag-tonal-primary">Required</span>;
  if (f.requiredWhen) return <span className="ux4g-tag-tonal-info">Required when…</span>;
  return <span className="ux4g-tag-tonal-neutral">Optional</span>;
}

export interface CanvasHandlers {
  select: (s: Selection) => void;
  drop: (payload: DropPayload, sectionId: string, index: number) => void;
  moveField: (id: string, delta: number) => void;
  duplicateField: (id: string) => void;
  removeField: (id: string) => void;
  addStep: () => void;
  moveSection: (id: string, delta: number) => void;
  removeSection: (id: string) => void;
}

/**
 * The form canvas: step tabs, then sections and their fields in applicant order. Every action is
 * a real button (keyboard reachable); drag-and-drop is an additional pointer shortcut.
 */
export function DesignerCanvas({
  form,
  stepIndex,
  onStepIndex,
  selection,
  issues,
  readOnly,
  handlers,
}: {
  form: DesignerForm;
  stepIndex: number;
  onStepIndex: (i: number) => void;
  selection: Selection;
  issues: readonly DesignIssue[];
  readOnly: boolean;
  handlers: CanvasHandlers;
}) {
  const [dropAt, setDropAt] = useState<string | null>(null);
  const step = form.steps[stepIndex];
  const issueCount = (kind: 'field' | 'section' | 'step', id: string) =>
    issues.filter((i) => i.target.kind === kind && 'id' in i.target && i.target.id === id);

  const dropZone = (sectionId: string, index: number, key: string) => ({
    onDragOver: (e: DragEvent) => {
      if (readOnly || !accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropAt(key);
    },
    onDragLeave: () => setDropAt((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropAt(null);
      const payload = readDrop(e);
      if (payload && !readOnly) handlers.drop(payload, sectionId, index);
    },
  });

  const renderField = (section: DesignerSection, f: DesignerField, index: number) => {
    const selected = selection.kind === 'field' && selection.id === f.id;
    const fieldIssues = issueCount('field', f.id);
    const hasError = fieldIssues.some((i) => i.severity === 'error');
    const zoneKey = `${section.id}:${index}`;
    return (
      <li
        key={f.id}
        className={[
          'sf-designer-field',
          selected ? 'sf-designer-selected' : '',
          dropAt === zoneKey ? 'sf-designer-drop-before' : '',
          hasError ? 'sf-designer-has-error' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        draggable={!readOnly}
        onDragStart={(e) => {
          e.dataTransfer.setData(FIELD_MIME, f.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        {...dropZone(section.id, index, zoneKey)}
      >
        <span className="sf-designer-grip" aria-hidden="true">
          <Icon name="grip" size={16} />
        </span>
        <button
          type="button"
          className="sf-designer-field-main"
          aria-pressed={selected}
          aria-label={`${f.label || f.key}, ${KIND_LABEL[f.kind]}${hasError ? ', has errors' : ''}`}
          onClick={() => handlers.select({ kind: 'field', id: f.id })}
        >
          <span className="sf-designer-field-head">
            <span className="ux4g-label-m-strong sf-designer-field-label">
              {f.label || 'Untitled field'}
            </span>
            <span className="ux4g-tag-outline-neutral">{KIND_LABEL[f.kind]}</span>
          </span>
          <span className="sf-designer-field-meta">
            <code className="sf-hash">
              {section.object ? `${section.object.key}.${f.key}` : f.key}
            </code>
            {requirementTag(f)}
            {f.visibleWhen ? (
              <span className="ux4g-tag-tonal-warning">
                {f.visibleWhen.effect === 'SHOW' ? 'Shown when' : 'Hidden when'}{' '}
                {describeRule(form, f.visibleWhen)}
              </span>
            ) : null}
            {f.semanticElementId ? (
              <span className="ux4g-tag-tonal-success" title={f.semanticElementId}>
                Semantic
              </span>
            ) : null}
            {fieldIssues.length > 0 ? (
              <span className={hasError ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-warning'}>
                {fieldIssues.length} {fieldIssues.length === 1 ? 'check' : 'checks'}
              </span>
            ) : null}
          </span>
        </button>
        {readOnly ? null : (
          <span className="sf-designer-field-actions">
            <Button
              variant="text-neutral"
              size="xs"
              aria-label={`Move ${f.label || f.key} up`}
              onClick={() => handlers.moveField(f.id, -1)}
            >
              <Icon name="arrow-up" size={16} />
            </Button>
            <Button
              variant="text-neutral"
              size="xs"
              aria-label={`Move ${f.label || f.key} down`}
              onClick={() => handlers.moveField(f.id, 1)}
            >
              <Icon name="arrow-down" size={16} />
            </Button>
            <Button
              variant="text-neutral"
              size="xs"
              aria-label={`Duplicate ${f.label || f.key}`}
              onClick={() => handlers.duplicateField(f.id)}
            >
              <Icon name="copy" size={16} />
            </Button>
            <Button
              variant="text-danger"
              size="xs"
              aria-label={`Delete ${f.label || f.key}`}
              onClick={() => handlers.removeField(f.id)}
            >
              <Icon name="trash" size={16} />
            </Button>
          </span>
        )}
      </li>
    );
  };

  return (
    <section className="sf-designer-pane sf-designer-canvas" aria-label="Form canvas">
      <div className="sf-designer-steps">
        <div
          className="sf-designer-step-tabs"
          role="tablist"
          aria-label="Steps"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const n = form.steps.length;
            const next = (stepIndex + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
            onStepIndex(next);
            document.getElementById(`step-tab-${form.steps[next]?.id ?? ''}`)?.focus();
          }}
        >
          {form.steps.map((s, i) => {
            const stepIssues = issueCount('step', s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`step-tab-${s.id}`}
                aria-selected={i === stepIndex}
                aria-controls="designer-step-panel"
                tabIndex={i === stepIndex ? 0 : -1}
                className={`sf-designer-step${i === stepIndex ? ' sf-designer-step-current' : ''}`}
                onClick={() => {
                  onStepIndex(i);
                  handlers.select({ kind: 'step', id: s.id });
                }}
              >
                <span className="sf-designer-step-index" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{s.label || 'Untitled step'}</span>
                {s.review ? <span className="ux4g-tag-tonal-info">Review</span> : null}
                {stepIssues.some((x) => x.severity === 'error') ? (
                  <span className="ux4g-tag-tonal-error">
                    <span aria-hidden="true">!</span>
                    <span className="ux4g-sr-only">has errors</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {readOnly ? null : (
          <Button variant="text-primary" size="s" onClick={handlers.addStep}>
            <Icon name="plus" size={16} /> Add step
          </Button>
        )}
      </div>

      {step ? (
        <div
          id="designer-step-panel"
          role="tabpanel"
          aria-labelledby={`step-tab-${step.id}`}
          className="sf-designer-step-panel"
        >
          <button
            type="button"
            className={`sf-designer-step-head${selection.kind === 'step' && selection.id === step.id ? ' sf-designer-selected' : ''}`}
            onClick={() => handlers.select({ kind: 'step', id: step.id })}
            aria-label={`Step settings: ${step.label}`}
          >
            <span className="ux4g-heading-s-strong">{step.title || step.label}</span>
            {step.hint ? <span className="ux4g-body-s-default">{step.hint}</span> : null}
          </button>

          {step.sections.map((section, si) => {
            const selected = selection.kind === 'section' && selection.id === section.id;
            const endKey = `${section.id}:end`;
            const sectionIssues = issueCount('section', section.id);
            return (
              <section
                key={section.id}
                className={`sf-designer-section${selected ? ' sf-designer-selected' : ''}`}
                aria-label={section.label ?? section.object?.title ?? 'Fields'}
              >
                <div className="sf-designer-section-head">
                  <button
                    type="button"
                    className="sf-designer-section-title"
                    aria-pressed={selected}
                    onClick={() => handlers.select({ kind: 'section', id: section.id })}
                  >
                    <span className="ux4g-label-l-strong">
                      {section.label ?? 'Fields without a section heading'}
                    </span>
                    {section.object ? (
                      <span className="ux4g-tag-tonal-info">
                        Grouped data · <code className="sf-hash">{section.object.key}</code>
                      </span>
                    ) : null}
                    {section.visibleWhen ? (
                      <span className="ux4g-tag-tonal-warning">
                        {section.visibleWhen.effect === 'SHOW' ? 'Shown when' : 'Hidden when'}{' '}
                        {describeRule(form, section.visibleWhen)}
                      </span>
                    ) : null}
                    {sectionIssues.length > 0 ? (
                      <span className="ux4g-tag-tonal-warning">{sectionIssues.length} checks</span>
                    ) : null}
                  </button>
                  {readOnly ? null : (
                    <span className="sf-designer-field-actions">
                      <Button
                        variant="text-neutral"
                        size="xs"
                        aria-label="Move section up"
                        disabled={si === 0}
                        onClick={() => handlers.moveSection(section.id, -1)}
                      >
                        <Icon name="arrow-up" size={16} />
                      </Button>
                      <Button
                        variant="text-neutral"
                        size="xs"
                        aria-label="Move section down"
                        disabled={si === step.sections.length - 1}
                        onClick={() => handlers.moveSection(section.id, 1)}
                      >
                        <Icon name="arrow-down" size={16} />
                      </Button>
                      <Button
                        variant="text-danger"
                        size="xs"
                        aria-label="Delete section"
                        onClick={() => handlers.removeSection(section.id)}
                      >
                        <Icon name="trash" size={16} />
                      </Button>
                    </span>
                  )}
                </div>
                <ol className="sf-designer-field-list" aria-label="Fields">
                  {section.fields.map((f, i) => renderField(section, f, i))}
                </ol>
                <div
                  className={`sf-designer-dropzone${dropAt === endKey ? ' sf-designer-dropzone-active' : ''}`}
                  {...dropZone(section.id, section.fields.length, endKey)}
                >
                  {section.fields.length === 0
                    ? 'Drop a field here, or select this section and click a field in the palette.'
                    : 'Drop here to add at the end'}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="ux4g-body-m-default">Add a step to start.</p>
      )}
    </section>
  );
}
