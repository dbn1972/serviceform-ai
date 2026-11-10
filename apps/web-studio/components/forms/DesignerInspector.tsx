'use client';

import { Alert, Button, Icon, RadioGroup, Select, Switch, TextInput } from '@serviceform/ui-ux4g';
import {
  buildPattern,
  conditionCandidates,
  describePattern,
  findField,
  findSection,
  FIELD_KINDS,
  isBoolean,
  isChoice,
  isNumeric,
  isSupportedPattern,
  KIND_LABEL,
  matchesPattern,
  PATTERN_PRESETS,
  type ChoiceOption,
  type DesignerField,
  type DesignerForm,
  type DesignerSection,
  type DesignerStep,
  type DesignIssue,
  type FieldKind,
  type FieldPatch,
  type InputMode,
  type PatternPresetId,
  type Scalar,
  type VisibilityRule,
} from '@serviceform/studio-designers/forms';
import { useState, type ReactNode } from 'react';
import type { Selection } from './DesignerCanvas';

export interface InspectorHandlers {
  patchForm: (
    patch: Partial<Pick<DesignerForm, 'title' | 'formId' | 'version'>>,
    key: string,
  ) => void;
  patchStep: (
    id: string,
    patch: Partial<Omit<DesignerStep, 'id' | 'sections'>>,
    key: string,
  ) => void;
  moveStep: (id: string, delta: number) => void;
  removeStep: (id: string) => void;
  patchSection: (
    id: string,
    patch: {
      label?: string | null;
      object?: DesignerSection['object'] | null;
      visibleWhen?: VisibilityRule | null;
    },
    key: string,
  ) => void;
  patchField: (id: string, patch: FieldPatch, key: string) => void;
  changeKind: (id: string, kind: FieldKind) => void;
  select: (s: Selection) => void;
}

const ERROR_CODES: Record<FieldKind, string[]> = {
  text: ['REQUIRED', 'MIN_LENGTH', 'MAX_LENGTH', 'PATTERN'],
  textarea: ['REQUIRED', 'MIN_LENGTH', 'MAX_LENGTH', 'PATTERN'],
  email: ['REQUIRED', 'FORMAT_EMAIL', 'MAX_LENGTH'],
  date: ['REQUIRED', 'FORMAT_DATE'],
  integer: ['REQUIRED', 'TYPE_NUMBER', 'MINIMUM', 'MAXIMUM'],
  number: ['REQUIRED', 'TYPE_NUMBER', 'MINIMUM', 'MAXIMUM'],
  select: ['REQUIRED'],
  radio: ['REQUIRED'],
  checkbox: [],
  declaration: ['REQUIRED', 'CONST_MISMATCH'],
};

const CODE_LABEL: Record<string, string> = {
  REQUIRED: 'When left empty',
  MIN_LENGTH: 'When too short',
  MAX_LENGTH: 'When too long',
  PATTERN: 'When the pattern does not match',
  FORMAT_EMAIL: 'When not an email address',
  FORMAT_DATE: 'When not a date',
  TYPE_NUMBER: 'When not a number',
  MINIMUM: 'When below the minimum',
  MAXIMUM: 'When above the maximum',
  CONST_MISMATCH: 'When not confirmed',
};

function numberOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function encode(v: Scalar | undefined): string {
  return v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
}

function decodeFor(target: DesignerField | undefined, raw: string): Scalar {
  if (target && isBoolean(target.kind)) return raw === 'true';
  if (target && isNumeric(target.kind)) return Number(raw);
  return raw;
}

function ValueInput({
  id,
  label,
  target,
  value,
  onChange,
}: {
  id: string;
  label: string;
  target: DesignerField | undefined;
  value: Scalar | undefined;
  onChange: (v: Scalar) => void;
}) {
  if (target && isBoolean(target.kind)) {
    return (
      <Select
        id={id}
        label={label}
        value={encode(value)}
        options={[
          { value: 'true', label: 'Yes (ticked)' },
          { value: 'false', label: 'No (not ticked)' },
        ]}
        onChange={(e) => onChange(e.target.value === 'true')}
      />
    );
  }
  if (target && isChoice(target.kind)) {
    return (
      <Select
        id={id}
        label={label}
        value={encode(value)}
        placeholder="Select"
        options={(target.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <TextInput
      id={id}
      label={label}
      type={target && isNumeric(target.kind) ? 'number' : 'text'}
      value={encode(value)}
      onChange={(e) => onChange(decodeFor(target, e.target.value))}
    />
  );
}

function defaultValue(target: DesignerField | undefined): Scalar {
  if (!target) return '';
  if (isBoolean(target.kind)) return true;
  if (isChoice(target.kind)) return target.options?.[0]?.value ?? '';
  if (isNumeric(target.kind)) return 0;
  return '';
}

function VisibilityEditor({
  idPrefix,
  form,
  selfId,
  rule,
  onChange,
  readOnly,
}: {
  idPrefix: string;
  form: DesignerForm;
  selfId: string;
  rule: VisibilityRule | undefined;
  onChange: (rule: VisibilityRule | null) => void;
  readOnly: boolean;
}) {
  const candidates = conditionCandidates(form, selfId);
  const target = candidates.find((c) => c.path === rule?.field)?.field;
  return (
    <fieldset className="sf-designer-fieldset" disabled={readOnly}>
      <legend className="ux4g-label-m-strong">Visibility</legend>
      <Switch
        id={`${idPrefix}-visible-toggle`}
        label="Show or hide based on another answer"
        checked={rule !== undefined}
        onChange={(on) => {
          if (!on) return onChange(null);
          const first =
            candidates.find((c) => isBoolean(c.field.kind) || isChoice(c.field.kind)) ??
            candidates[0];
          onChange({
            effect: 'SHOW',
            field: first?.path ?? '',
            equals: defaultValue(first?.field),
          });
        }}
      />
      {rule ? (
        <div className="sf-designer-row">
          <Select
            id={`${idPrefix}-effect`}
            label="Rule"
            value={rule.effect}
            options={[
              { value: 'SHOW', label: 'Show only when' },
              { value: 'HIDE', label: 'Hide when' },
            ]}
            onChange={(e) => onChange({ ...rule, effect: e.target.value as 'SHOW' | 'HIDE' })}
          />
          <Select
            id={`${idPrefix}-field`}
            label="Answer to"
            value={rule.field}
            placeholder="Select a field"
            options={candidates.map((c) => ({ value: c.path, label: c.label }))}
            onChange={(e) => {
              const next = candidates.find((c) => c.path === e.target.value)?.field;
              onChange({ effect: rule.effect, field: e.target.value, equals: defaultValue(next) });
            }}
          />
          <ValueInput
            id={`${idPrefix}-value`}
            label="Is"
            target={target}
            value={rule.oneOf ? rule.oneOf[0] : rule.equals}
            onChange={(v) => onChange({ effect: rule.effect, field: rule.field, equals: v })}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

function OptionsEditor({
  field,
  onChange,
  readOnly,
}: {
  field: DesignerField;
  onChange: (options: ChoiceOption[]) => void;
  readOnly: boolean;
}) {
  const options = field.options ?? [];
  const set = (i: number, patch: Partial<ChoiceOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, d: number) => {
    const next = [...options];
    const [o] = next.splice(i, 1);
    if (!o) return;
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, o);
    onChange(next);
  };
  return (
    <fieldset className="sf-designer-fieldset" disabled={readOnly}>
      <legend className="ux4g-label-m-strong">Options</legend>
      <p className="ux4g-body-s-default sf-designer-muted">
        The label is what applicants see; the stored value is what the platform records. Keep stored
        values stable once a version is frozen.
      </p>
      <ol className="sf-designer-options">
        {options.map((o, i) => (
          <li key={i} className="sf-designer-option">
            <TextInput
              id={`opt-${field.id}-${i}-label`}
              label={`Option ${i + 1} label`}
              size="s"
              value={o.label}
              onChange={(e) => set(i, { label: e.target.value })}
            />
            <TextInput
              id={`opt-${field.id}-${i}-value`}
              label={`Option ${i + 1} stored value`}
              size="s"
              value={o.value}
              onChange={(e) => set(i, { value: e.target.value })}
            />
            <span className="sf-designer-field-actions">
              <Button
                variant="text-neutral"
                size="xs"
                aria-label={`Move option ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <Icon name="arrow-up" size={16} />
              </Button>
              <Button
                variant="text-neutral"
                size="xs"
                aria-label={`Move option ${i + 1} down`}
                disabled={i === options.length - 1}
                onClick={() => move(i, 1)}
              >
                <Icon name="arrow-down" size={16} />
              </Button>
              <Button
                variant="text-danger"
                size="xs"
                aria-label={`Remove option ${i + 1}`}
                onClick={() => onChange(options.filter((_, j) => j !== i))}
              >
                <Icon name="trash" size={16} />
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <Button
        variant="outline-primary"
        size="s"
        onClick={() => {
          const taken = new Set(options.map((o) => o.value));
          let n = options.length + 1;
          while (taken.has(`OPTION_${n}`)) n += 1;
          onChange([...options, { value: `OPTION_${n}`, label: `Option ${n}` }]);
        }}
      >
        <Icon name="plus" size={16} /> Add option
      </Button>
    </fieldset>
  );
}

type PatternMode = 'none' | PatternPresetId | 'custom';

function PatternEditor({
  field,
  onChange,
}: {
  field: DesignerField;
  onChange: (pattern: string | null) => void;
}) {
  const described = field.pattern ? describePattern(field.pattern) : null;
  const [custom, setCustom] = useState(false);
  const mode: PatternMode = !field.pattern
    ? custom
      ? 'custom'
      : 'none'
    : described && !custom
      ? described.preset
      : 'custom';
  const [sample, setSample] = useState('');
  const min = described?.min ?? 1;
  const max = described?.max ?? 10;
  const supported = field.pattern ? isSupportedPattern(field.pattern) : true;
  return (
    <div className="sf-designer-stack">
      <Select
        id={`pattern-mode-${field.id}`}
        label="Allowed characters"
        value={mode}
        options={[
          { value: 'none', label: 'Anything' },
          ...PATTERN_PRESETS.map((p) => ({ value: p.id, label: p.label })),
          { value: 'custom', label: 'Custom pattern (advanced)' },
        ]}
        onChange={(e) => {
          const v = e.target.value as PatternMode;
          if (v === 'none') {
            setCustom(false);
            onChange(null);
          } else if (v === 'custom') {
            setCustom(true);
          } else {
            setCustom(false);
            onChange(buildPattern(v, min, max));
          }
        }}
      />
      {mode !== 'none' && mode !== 'custom' ? (
        <div className="sf-designer-row">
          <TextInput
            id={`pattern-min-${field.id}`}
            label="Fewest characters"
            type="number"
            min={1}
            max={64}
            value={String(min)}
            onChange={(e) => {
              const p = buildPattern(
                mode,
                Number(e.target.value),
                Math.max(max, Number(e.target.value)),
              );
              if (p) onChange(p);
            }}
          />
          <TextInput
            id={`pattern-max-${field.id}`}
            label="Most characters"
            type="number"
            min={1}
            max={64}
            value={String(max)}
            onChange={(e) => {
              const p = buildPattern(
                mode,
                Math.min(min, Number(e.target.value)),
                Number(e.target.value),
              );
              if (p) onChange(p);
            }}
          />
        </div>
      ) : null}
      {mode === 'custom' ? (
        <TextInput
          id={`pattern-${field.id}`}
          label="Pattern"
          hint="Anchored ^…$ character classes with {n} or {n,m}; no groups or alternation."
          error={supported ? undefined : 'The form runtime cannot check this pattern.'}
          value={field.pattern ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      ) : null}
      {field.pattern && supported ? (
        <div className="sf-designer-row sf-designer-row-end">
          <TextInput
            id={`pattern-try-${field.id}`}
            label="Try a value"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
          {sample ? (
            <span
              role="status"
              className={
                matchesPattern(field.pattern, sample)
                  ? 'ux4g-tag-tonal-success'
                  : 'ux4g-tag-tonal-error'
              }
            >
              {matchesPattern(field.pattern, sample) ? 'Accepted' : 'Refused'}
            </span>
          ) : null}
        </div>
      ) : null}
      {field.pattern ? <code className="sf-hash">{field.pattern}</code> : null}
    </div>
  );
}

function FieldInspector({
  form,
  field,
  nested,
  readOnly,
  h,
}: {
  form: DesignerForm;
  field: DesignerField;
  nested: boolean;
  readOnly: boolean;
  h: InspectorHandlers;
}) {
  const patch = (p: FieldPatch, key: string) => h.patchField(field.id, p, `${field.id}:${key}`);
  const topCandidates = conditionCandidates(form, field.id).filter((c) => !c.path.includes('/'));
  const requirement = field.required ? 'always' : field.requiredWhen ? 'when' : 'optional';
  const whenTarget = topCandidates.find((c) => c.path === field.requiredWhen?.field)?.field;
  const textual = field.kind === 'text' || field.kind === 'textarea' || field.kind === 'email';
  return (
    <div className="sf-designer-stack">
      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Field</legend>
        <TextInput
          id="insp-label"
          label="Label"
          value={field.label}
          onChange={(e) => patch({ label: e.target.value }, 'label')}
        />
        <TextInput
          id="insp-key"
          label="Data key"
          hint="Lowercase letters, digits and _. Rules that use this field follow a rename."
          value={field.key}
          onChange={(e) => patch({ key: e.target.value.trim() }, 'key')}
        />
        <Select
          id="insp-kind"
          label="Type"
          value={field.kind}
          options={FIELD_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          onChange={(e) => h.changeKind(field.id, e.target.value as FieldKind)}
        />
        <TextInput
          id="insp-hint"
          label="Help text"
          optional
          value={field.hint ?? ''}
          onChange={(e) => patch({ hint: e.target.value === '' ? null : e.target.value }, 'hint')}
        />
        <RadioGroup
          name="insp-required"
          legend="Answer is"
          value={requirement}
          disabled={readOnly}
          options={[
            { value: 'always', label: 'Required' },
            { value: 'optional', label: 'Optional' },
            ...(nested ? [] : [{ value: 'when', label: 'Required when…' }]),
          ]}
          onChange={(v) => {
            if (v === 'always') patch({ required: true, requiredWhen: null }, 'required');
            else if (v === 'optional') patch({ required: false, requiredWhen: null }, 'required');
            else {
              const first =
                topCandidates.find((c) => isBoolean(c.field.kind) || isChoice(c.field.kind)) ??
                topCandidates[0];
              patch(
                {
                  required: false,
                  requiredWhen: { field: first?.path ?? '', equals: defaultValue(first?.field) },
                },
                'required',
              );
            }
          }}
        />
        {field.requiredWhen ? (
          <div className="sf-designer-row">
            <Select
              id="insp-reqwhen-field"
              label="When the answer to"
              value={field.requiredWhen.field}
              placeholder="Select a field"
              options={topCandidates.map((c) => ({ value: c.path, label: c.label }))}
              onChange={(e) => {
                const t = topCandidates.find((c) => c.path === e.target.value)?.field;
                patch(
                  { requiredWhen: { field: e.target.value, equals: defaultValue(t) } },
                  'reqwhen',
                );
              }}
            />
            <ValueInput
              id="insp-reqwhen-value"
              label="Is"
              target={whenTarget}
              value={field.requiredWhen.equals}
              onChange={(v) =>
                patch(
                  { requiredWhen: { field: field.requiredWhen?.field ?? '', equals: v } },
                  'reqwhen',
                )
              }
            />
          </div>
        ) : null}
      </fieldset>

      {isChoice(field.kind) ? (
        <OptionsEditor
          field={field}
          readOnly={readOnly}
          onChange={(options) => patch({ options }, 'options')}
        />
      ) : null}

      {textual || isNumeric(field.kind) ? (
        <fieldset className="sf-designer-fieldset" disabled={readOnly}>
          <legend className="ux4g-label-m-strong">Validation</legend>
          {textual ? (
            <div className="sf-designer-row">
              <TextInput
                id="insp-minlen"
                label="Minimum length"
                type="number"
                min={0}
                optional
                value={field.minLength === undefined ? '' : String(field.minLength)}
                onChange={(e) => patch({ minLength: numberOrNull(e.target.value) }, 'minlen')}
              />
              <TextInput
                id="insp-maxlen"
                label="Maximum length"
                type="number"
                min={0}
                optional
                value={field.maxLength === undefined ? '' : String(field.maxLength)}
                onChange={(e) => patch({ maxLength: numberOrNull(e.target.value) }, 'maxlen')}
              />
            </div>
          ) : null}
          {field.kind === 'text' || field.kind === 'textarea' ? (
            <PatternEditor field={field} onChange={(p) => patch({ pattern: p }, 'pattern')} />
          ) : null}
          {isNumeric(field.kind) ? (
            <div className="sf-designer-row">
              <TextInput
                id="insp-min"
                label="Minimum"
                type="number"
                optional
                value={field.minimum === undefined ? '' : String(field.minimum)}
                onChange={(e) => patch({ minimum: numberOrNull(e.target.value) }, 'min')}
              />
              <TextInput
                id="insp-max"
                label="Maximum"
                type="number"
                optional
                value={field.maximum === undefined ? '' : String(field.maximum)}
                onChange={(e) => patch({ maximum: numberOrNull(e.target.value) }, 'max')}
              />
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Layout</legend>
        <Switch
          id="insp-wide"
          label="Use the full row"
          checked={field.wide === true}
          onChange={(on) => patch({ wide: on ? true : null }, 'wide')}
        />
        {textual || isNumeric(field.kind) ? (
          <Select
            id="insp-inputmode"
            label="Keyboard on phones"
            value={field.inputMode ?? ''}
            placeholder="Default"
            options={[
              { value: 'numeric', label: 'Digits' },
              { value: 'tel', label: 'Phone' },
              { value: 'email', label: 'Email' },
              { value: 'text', label: 'Text' },
            ]}
            onChange={(e) =>
              patch(
                {
                  inputMode: e.target.value === '' ? null : (e.target.value as InputMode),
                },
                'inputmode',
              )
            }
          />
        ) : null}
      </fieldset>

      <VisibilityEditor
        idPrefix={`field-${field.id}`}
        form={form}
        selfId={field.id}
        rule={field.visibleWhen}
        readOnly={readOnly}
        onChange={(rule) => patch({ visibleWhen: rule }, 'visible')}
      />

      {ERROR_CODES[field.kind].length > 0 ? (
        <details className="sf-designer-details">
          <summary className="ux4g-label-m-strong">
            Error messages for applicants (optional)
          </summary>
          <fieldset className="sf-designer-fieldset" disabled={readOnly}>
            <legend className="ux4g-sr-only">Error messages</legend>
            {ERROR_CODES[field.kind].map((code) => (
              <TextInput
                key={code}
                id={`insp-err-${code}`}
                label={CODE_LABEL[code] ?? code}
                optional
                hint={code}
                value={field.errorMessages?.[code] ?? ''}
                onChange={(e) => {
                  const next = Object.fromEntries([
                    ...Object.entries(field.errorMessages ?? {}).filter(([k]) => k !== code),
                    ...(e.target.value === '' ? [] : [[code, e.target.value]]),
                  ]);
                  patch(
                    { errorMessages: Object.keys(next).length > 0 ? next : null },
                    `err-${code}`,
                  );
                }}
              />
            ))}
          </fieldset>
        </details>
      ) : null}

      <div className="sf-designer-semantic">
        <span className="ux4g-label-m-strong">Semantic binding</span>
        {field.semanticElementId ? (
          <>
            <span className="ux4g-tag-tonal-success">{field.semanticElementId}</span>
            <p className="ux4g-body-s-default sf-designer-muted">
              Canonical government element (Constitution §38). Bindings come from palette presets;
              they are never typed in.
            </p>
            {readOnly ? null : (
              <Button
                variant="text-danger"
                size="s"
                onClick={() => patch({ semanticElementId: null }, 'semantic')}
              >
                Remove binding
              </Button>
            )}
          </>
        ) : (
          <p className="ux4g-body-s-default sf-designer-muted">
            Not bound. Add a field from “Common government fields” to reuse a canonical element.
          </p>
        )}
      </div>
    </div>
  );
}

function SectionInspector({
  form,
  section,
  readOnly,
  h,
}: {
  form: DesignerForm;
  section: DesignerSection;
  readOnly: boolean;
  h: InspectorHandlers;
}) {
  const key = (k: string) => `${section.id}:${k}`;
  return (
    <div className="sf-designer-stack">
      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Section</legend>
        <Switch
          id="sec-heading"
          label="Show a heading"
          checked={section.label !== undefined}
          onChange={(on) =>
            h.patchSection(section.id, { label: on ? 'Details' : null }, key('heading'))
          }
        />
        {section.label !== undefined ? (
          <TextInput
            id="sec-label"
            label="Heading"
            value={section.label}
            onChange={(e) => h.patchSection(section.id, { label: e.target.value }, key('label'))}
          />
        ) : null}
        <Switch
          id="sec-object"
          label="Store these answers together (grouped data)"
          checked={section.object !== undefined}
          onChange={(on) =>
            h.patchSection(
              section.id,
              {
                object: on ? { key: 'group_data', title: section.label ?? 'Grouped data' } : null,
              },
              key('object'),
            )
          }
        />
        {section.object ? (
          <div className="sf-designer-row">
            <TextInput
              id="sec-object-key"
              label="Data key"
              value={section.object.key}
              onChange={(e) =>
                h.patchSection(
                  section.id,
                  {
                    object: {
                      ...section.object,
                      key: e.target.value.trim(),
                    } as DesignerSection['object'],
                  },
                  key('objkey'),
                )
              }
            />
            <TextInput
              id="sec-object-title"
              label="Data title"
              value={section.object.title}
              onChange={(e) =>
                h.patchSection(
                  section.id,
                  {
                    object: {
                      ...section.object,
                      title: e.target.value,
                    } as DesignerSection['object'],
                  },
                  key('objtitle'),
                )
              }
            />
          </div>
        ) : null}
      </fieldset>
      <VisibilityEditor
        idPrefix={`section-${section.id}`}
        form={form}
        selfId={section.id}
        rule={section.visibleWhen}
        readOnly={readOnly}
        onChange={(rule) => h.patchSection(section.id, { visibleWhen: rule }, key('visible'))}
      />
    </div>
  );
}

function StepInspector({
  form,
  step,
  readOnly,
  h,
}: {
  form: DesignerForm;
  step: DesignerStep;
  readOnly: boolean;
  h: InspectorHandlers;
}) {
  const index = form.steps.findIndex((s) => s.id === step.id);
  const key = (k: string) => `${step.id}:${k}`;
  return (
    <div className="sf-designer-stack">
      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Step {index + 1}</legend>
        <TextInput
          id="step-label"
          label="Name in the stepper"
          value={step.label}
          onChange={(e) => h.patchStep(step.id, { label: e.target.value }, key('label'))}
        />
        <TextInput
          id="step-title"
          label="Heading"
          optional
          value={step.title ?? ''}
          onChange={(e) => h.patchStep(step.id, { title: e.target.value }, key('title'))}
        />
        <TextInput
          id="step-hint"
          label="Short description"
          optional
          value={step.hint ?? ''}
          onChange={(e) => h.patchStep(step.id, { hint: e.target.value }, key('hint'))}
        />
        <Switch
          id="step-review"
          label="Review step (shows every answer before submit)"
          checked={step.review}
          onChange={(on) => h.patchStep(step.id, { review: on }, key('review'))}
        />
        <p className="ux4g-body-s-default sf-designer-muted">
          Page id <code className="sf-hash">{step.key}</code>
        </p>
      </fieldset>
      {readOnly ? null : (
        <div className="sf-actions">
          <Button
            variant="outline-neutral"
            size="s"
            disabled={index <= 0}
            onClick={() => h.moveStep(step.id, -1)}
          >
            <Icon name="arrow-left" size={16} /> Earlier
          </Button>
          <Button
            variant="outline-neutral"
            size="s"
            disabled={index >= form.steps.length - 1}
            onClick={() => h.moveStep(step.id, 1)}
          >
            Later <Icon name="arrow-right" size={16} />
          </Button>
          <Button
            variant="outline-danger"
            size="s"
            disabled={form.steps.length <= 1}
            onClick={() => h.removeStep(step.id)}
          >
            <Icon name="trash" size={16} /> Delete step
          </Button>
        </div>
      )}
    </div>
  );
}

function FormInspector({
  form,
  issues,
  readOnly,
  h,
}: {
  form: DesignerForm;
  issues: readonly DesignIssue[];
  readOnly: boolean;
  h: InspectorHandlers;
}) {
  return (
    <div className="sf-designer-stack">
      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Form</legend>
        <TextInput
          id="form-title"
          label="Title"
          value={form.title}
          onChange={(e) => h.patchForm({ title: e.target.value }, 'title')}
        />
        <TextInput
          id="form-key"
          label="Form key"
          hint="CMP-009 form key, e.g. lab.trade-licence.application"
          value={form.formId}
          onChange={(e) => h.patchForm({ formId: e.target.value.trim() }, 'formId')}
        />
        <TextInput
          id="form-version"
          label="Version"
          hint="major.minor.patch — each frozen version is immutable"
          value={form.version}
          onChange={(e) => h.patchForm({ version: e.target.value.trim() }, 'version')}
        />
      </fieldset>
      <ChecksList issues={issues} select={h.select} />
    </div>
  );
}

export function ChecksList({
  issues,
  select,
}: {
  issues: readonly DesignIssue[];
  select: (s: Selection) => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <section className="sf-designer-checks" aria-labelledby="checks-title">
      <h3 id="checks-title" className="ux4g-label-l-strong">
        Checks{' '}
        <span className={errors > 0 ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-success'}>
          {errors > 0 ? `${errors} to fix` : 'Ready to save'}
        </span>
      </h3>
      {issues.length === 0 ? (
        <p className="ux4g-body-s-default">
          No problems found. CMP-033 and CMP-009 still check again when you save and publish.
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
              {issue.target.kind !== 'form' ? (
                <Button
                  variant="text-primary"
                  size="xs"
                  onClick={() => select(issue.target as Selection)}
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

/** Properties of the current selection; with nothing selected, form settings and checks. */
export function DesignerInspector({
  form,
  selection,
  issues,
  readOnly,
  handlers,
}: {
  form: DesignerForm;
  selection: Selection;
  issues: readonly DesignIssue[];
  readOnly: boolean;
  handlers: InspectorHandlers;
}) {
  let body: ReactNode = null;
  let title = 'Form settings';
  if (selection.kind === 'field') {
    const ref = findField(form, selection.id);
    if (ref) {
      title = 'Field properties';
      body = (
        <FieldInspector
          key={ref.field.id}
          form={form}
          field={ref.field}
          nested={ref.section.object !== undefined}
          readOnly={readOnly}
          h={handlers}
        />
      );
    }
  } else if (selection.kind === 'section') {
    const found = findSection(form, selection.id);
    if (found) {
      title = 'Section properties';
      body = (
        <SectionInspector form={form} section={found.section} readOnly={readOnly} h={handlers} />
      );
    }
  } else if (selection.kind === 'step') {
    const step = form.steps.find((s) => s.id === selection.id);
    if (step) {
      title = 'Step properties';
      body = <StepInspector form={form} step={step} readOnly={readOnly} h={handlers} />;
    }
  }
  if (!body) {
    body = <FormInspector form={form} issues={issues} readOnly={readOnly} h={handlers} />;
  }
  return (
    <aside className="sf-designer-pane sf-designer-inspector" aria-label="Properties">
      <div className="sf-designer-inspector-head">
        <h2 className="ux4g-heading-xs-strong">{title}</h2>
        {selection.kind !== 'form' ? (
          <Button
            variant="text-primary"
            size="xs"
            onClick={() => handlers.select({ kind: 'form' })}
          >
            Form settings
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
