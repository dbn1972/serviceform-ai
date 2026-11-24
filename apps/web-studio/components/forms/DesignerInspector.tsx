'use client';

import {
  Alert,
  Button,
  Icon,
  issueMessage,
  RadioGroup,
  Select,
  stepErrors,
  Switch,
  TextInput,
  type FormSchemaView,
} from '@serviceform/ui-ux4g';
import {
  allFields,
  buildPattern,
  citizenValue,
  conditionCandidates,
  conditionText,
  describePattern,
  describeValidation,
  examplePattern,
  fieldSchema,
  optionsFromText,
  sectionTargets,
  findField,
  findSection,
  FIELD_KINDS,
  isBoolean,
  isChoice,
  isNumeric,
  isSupportedPattern,
  KIND_LABEL,
  MESSAGE_CODES,
  PATTERN_PRESETS,
  reachableCodes,
  sameCondition,
  sharedRequirement,
  validationCases,
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
  type RequiredWhen,
  type VisibilityRule,
} from '@serviceform/studio-designers/forms';
import { useState, type ReactNode } from 'react';
import { ConditionValueEditor, defaultValue } from './ConditionEditor';
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
  moveToSection: (fieldId: string, sectionId: string) => void;
  select: (s: Selection) => void;
}

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
              onChange({
                effect: rule.effect,
                field: e.target.value,
                ...(rule.answered ? { answered: true } : { equals: defaultValue(next) }),
              });
            }}
          />
          <ConditionValueEditor
            idPrefix={idPrefix}
            target={target}
            condition={rule}
            allowAnswered
            onChange={(v) => onChange({ effect: rule.effect, field: rule.field, ...v })}
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
      <PasteOptions fieldId={field.id} onChange={onChange} />
    </fieldset>
  );
}

function PasteOptions({
  fieldId,
  onChange,
}: {
  fieldId: string;
  onChange: (options: ChoiceOption[]) => void;
}) {
  const [text, setText] = useState('');
  const parsed = optionsFromText(text);
  const id = `opt-paste-${fieldId}`;
  return (
    <details className="sf-designer-details">
      <summary className="ux4g-label-m-strong">Paste a list of options</summary>
      <div className="ux4g-input-container ux4g-input-m ux4g-input-default">
        <label className="ux4g-label-m-default" htmlFor={id}>
          Options, one per line
        </label>
        <textarea
          id={id}
          className="ux4g-textarea"
          rows={5}
          value={text}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setText(e.target.value)}
        />
        <p id={`${id}-hint`} className="ux4g-input-helper ux4g-input-helper-text">
          Write the label applicants see. To keep a stored value, write VALUE | Label.
        </p>
      </div>
      <Button
        variant="outline-primary"
        size="s"
        disabled={parsed.length === 0}
        onClick={() => {
          onChange(parsed);
          setText('');
        }}
      >
        Replace options with {parsed.length} {parsed.length === 1 ? 'line' : 'lines'}
      </Button>
    </details>
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
        <p className="ux4g-body-s-default sf-designer-muted">
          Example accepted value:{' '}
          <code className="sf-hash">
            {examplePattern(field.pattern, field.minLength, field.maxLength) ?? ''}
          </code>
        </p>
      ) : null}
      {field.pattern ? <code className="sf-hash">{field.pattern}</code> : null}
    </div>
  );
}

/** One-field form for the citizen runtime mirror: exactly the check and copy applicants get. */
function benchCheck(field: DesignerField, raw: string, required: boolean): string | null {
  const node = fieldSchema(field) as FormSchemaView;
  const scope = `#/properties/${field.key}`;
  const schema: FormSchemaView = {
    type: 'object',
    properties: { [field.key]: node },
    required: required ? [field.key] : [],
  };
  const value = citizenValue(field.kind, raw);
  const errors = stepErrors(
    schema,
    { type: 'Control', scope },
    value === undefined ? {} : { [field.key]: value },
    new Set([scope]),
  );
  return errors[`/${field.key}`] ?? null;
}

const SHOWN_CHARACTERS = 12;

function shownInput(input: string): ReactNode {
  if (input === '') return <span className="sf-designer-muted">(nothing)</span>;
  const text =
    input.length > SHOWN_CHARACTERS
      ? `${input.slice(0, SHOWN_CHARACTERS)}… (${input.length} characters)`
      : input;
  return <code className="sf-hash">{text}</code>;
}

/** Edge cases of the field's own rules, each with the verdict and copy an applicant gets. */
function FieldCases({ field, required }: { field: DesignerField; required: boolean }) {
  const cases = validationCases(field);
  if (cases.length === 0) return null;
  return (
    <details className="sf-designer-details" open>
      <summary className="ux4g-label-m-strong">Test cases ({cases.length})</summary>
      <div className="sf-table-wrap" tabIndex={0} role="region" aria-label="Test cases">
        <table className="sf-table" data-testid="field-cases">
          <caption>
            Inputs at the edges of this field&rsquo;s rules
            {required ? ', checked as a required answer' : ''}, run through the citizen form
            runtime. CMP-009 gives the same verdict on submit.
          </caption>
          <thead>
            <tr>
              <th scope="col">Applicant types</th>
              <th scope="col">Applicant sees</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const message = benchCheck(field, c.input, required);
              return (
                <tr key={c.id}>
                  <th scope="row">
                    <span className="ux4g-body-s-default sf-designer-muted">{c.label}:</span>{' '}
                    {shownInput(c.input)}
                  </th>
                  <td>
                    <span className={message ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-success'}>
                      {message ?? 'Accepted'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {field.kind === 'number' ? (
        <p className="ux4g-body-s-default sf-designer-muted">
          The citizen number box currently stores whole numbers only, so decimals are refused there
          even though this field allows them.
        </p>
      ) : null}
    </details>
  );
}

function FieldBench({ field }: { field: DesignerField }) {
  const [sample, setSample] = useState('');
  const [touched, setTouched] = useState(false);
  const required = field.required || field.requiredWhen !== undefined;
  const message = touched ? benchCheck(field, sample, required) : null;
  return (
    <div className="sf-designer-row sf-designer-row-end">
      <TextInput
        id={`bench-${field.id}`}
        label="Try a value"
        type={field.kind === 'date' ? 'date' : 'text'}
        inputMode={isNumeric(field.kind) ? 'numeric' : undefined}
        hint={
          field.requiredWhen && !field.required
            ? `Checked as if it is required (its "required ${field.requiredWhen.unless ? 'unless' : 'when'}" rule applies).`
            : 'Shows exactly what an applicant would see.'
        }
        value={sample}
        onChange={(e) => {
          setSample(e.target.value);
          setTouched(true);
        }}
      />
      {touched ? (
        <span
          role="status"
          data-testid="field-bench-result"
          className={message ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-success'}
        >
          {message ?? (sample === '' ? 'Accepted (left empty)' : 'Accepted')}
        </span>
      ) : null}
    </div>
  );
}

function FieldInspector({
  form,
  field,
  sectionId,
  nested,
  readOnly,
  h,
}: {
  form: DesignerForm;
  field: DesignerField;
  sectionId: string;
  nested: boolean;
  readOnly: boolean;
  h: InspectorHandlers;
}) {
  const patch = (p: FieldPatch, key: string) => h.patchField(field.id, p, `${field.id}:${key}`);
  const topCandidates = conditionCandidates(form, field.id).filter((c) => !c.path.includes('/'));
  const when = field.requiredWhen;
  const requirement = field.required
    ? 'always'
    : when
      ? when.unless
        ? 'unless'
        : 'when'
      : 'optional';
  const whenTarget = topCandidates.find((c) => c.path === when?.field)?.field;
  const textual = field.kind === 'text' || field.kind === 'textarea' || field.kind === 'email';
  const shared = sharedRequirement(form, field.id);
  const sharing = when
    ? allFields(form).filter(
        (r) =>
          r.field.id !== field.id &&
          r.field.requiredWhen &&
          sameCondition(r.field.requiredWhen, when),
      ).length
    : 0;
  const setWhen = (next: RequiredWhen) => patch({ required: false, requiredWhen: next }, 'reqwhen');
  const startCondition = (): RequiredWhen => {
    if (when) return when;
    if (shared) return { ...shared };
    const first =
      topCandidates.find((c) => isBoolean(c.field.kind) || isChoice(c.field.kind)) ??
      topCandidates[0];
    return { field: first?.path ?? '', equals: defaultValue(first?.field) };
  };
  const required = field.required || when !== undefined;
  const reachable = reachableCodes(field);
  const messageCodes = MESSAGE_CODES.filter(
    (code) => reachable.has(code) || (field.errorMessages?.[code] ?? '') !== '',
  );
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
            ...(nested
              ? []
              : [
                  { value: 'when', label: 'Required when…' },
                  { value: 'unless', label: 'Required unless…' },
                ]),
          ]}
          onChange={(v) => {
            if (v === 'always') patch({ required: true, requiredWhen: null }, 'required');
            else if (v === 'optional') patch({ required: false, requiredWhen: null }, 'required');
            else {
              const { unless: _unless, ...condition } = startCondition();
              patch(
                {
                  required: false,
                  requiredWhen: v === 'unless' ? { ...condition, unless: true } : condition,
                },
                'required',
              );
            }
          }}
        />
        {when ? (
          <div className="sf-designer-row">
            <Select
              id="insp-reqwhen-field"
              label={when.unless ? 'Unless the answer to' : 'When the answer to'}
              value={when.field}
              placeholder="Select a field"
              options={topCandidates.map((c) => ({ value: c.path, label: c.label }))}
              onChange={(e) => {
                const t = topCandidates.find((c) => c.path === e.target.value)?.field;
                setWhen({
                  field: e.target.value,
                  equals: defaultValue(t),
                  ...(when.unless ? { unless: true } : {}),
                });
              }}
            />
            <ConditionValueEditor
              idPrefix="insp-reqwhen"
              target={whenTarget}
              condition={when}
              allowAnswered={false}
              onChange={(v) =>
                setWhen({ field: when.field, ...v, ...(when.unless ? { unless: true } : {}) })
              }
            />
          </div>
        ) : null}
        {when && shared && !sameCondition(shared, when) ? (
          <p className="ux4g-body-s-default">
            Other fields are required when {conditionText(form, shared)}. The form runtime checks
            one condition for every &ldquo;required when / unless&rdquo; rule.{' '}
            <Button
              variant="text-primary"
              size="xs"
              onClick={() => setWhen({ ...shared, ...(when.unless ? { unless: true } : {}) })}
            >
              Use that condition
            </Button>
          </p>
        ) : when && sharing > 0 ? (
          <p className="ux4g-body-s-default sf-designer-muted">
            Shares its condition with {sharing} other {sharing === 1 ? 'field' : 'fields'}; the form
            runtime checks one condition for every &ldquo;required when / unless&rdquo; rule.
          </p>
        ) : null}
      </fieldset>

      {isChoice(field.kind) ? (
        <OptionsEditor
          field={field}
          readOnly={readOnly}
          onChange={(options) => patch({ options }, 'options')}
        />
      ) : null}

      {textual || isNumeric(field.kind) || field.kind === 'date' ? (
        <fieldset className="sf-designer-fieldset" disabled={readOnly}>
          <legend className="ux4g-label-m-strong">Validation</legend>
          <p className="ux4g-body-s-default" data-testid="field-validation-summary">
            {[required ? 'Required' : 'Optional', ...describeValidation(field)].join(' · ')}
          </p>
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
          <FieldBench key={`${field.id}:${field.kind}`} field={field} />
          <FieldCases field={field} required={required} />
        </fieldset>
      ) : null}

      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Layout</legend>
        <Select
          id="insp-move-to"
          label="Move to"
          value=""
          placeholder="Choose a step and section"
          options={sectionTargets(form)
            .filter((t) => t.id !== sectionId)
            .map((t) => ({ value: t.id, label: t.label }))}
          onChange={(e) => {
            if (e.target.value) h.moveToSection(field.id, e.target.value);
          }}
        />
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

      {messageCodes.length > 0 ? (
        <details className="sf-designer-details">
          <summary className="ux4g-label-m-strong">
            Error messages for applicants (optional)
          </summary>
          <fieldset className="sf-designer-fieldset" disabled={readOnly}>
            <legend className="ux4g-sr-only">Error messages</legend>
            <p className="ux4g-body-s-default sf-designer-muted">
              Only the problems this field&rsquo;s rules can produce are listed.
            </p>
            {messageCodes.map((code) => (
              <TextInput
                key={code}
                id={`insp-err-${code}`}
                label={CODE_LABEL[code] ?? code}
                optional
                state={reachable.has(code) ? 'default' : 'warning'}
                hint={
                  reachable.has(code)
                    ? `Default: “${issueMessage(
                        fieldSchema({ ...field, errorMessages: {} }) as FormSchemaView,
                        code,
                        `/${field.key}`,
                      )}”`
                    : 'Applicants never see this message with the current rules.'
                }
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
          sectionId={ref.section.id}
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
