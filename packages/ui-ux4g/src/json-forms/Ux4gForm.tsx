import type { ReactNode } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { RadioGroup } from '../components/Feedback';
import { TextInput } from '../components/TextInput';
import {
  controlScopes,
  displayValue,
  getAt,
  labelOf,
  schemaAt,
  scopeToPointer,
  wizardSteps,
  type FieldErrors,
  type FormData,
  type FormSchemaView,
  type FormUiView,
} from './form-model';
import { resolveUx4gRenderer } from './registry';

/** Per-field presentation state supplied by the host (e.g. "verified at sign-in"). */
export type FieldNote = { state: 'success'; hint: string };

export type Ux4gFormLayoutProps = {
  node: FormUiView;
  schema: FormSchemaView;
  data: FormData;
  visible: ReadonlySet<string>;
  isRequired: (pointer: string) => boolean;
  errors?: FieldErrors;
  notes?: Record<string, FieldNote>;
  /** Labels from the CMP-009 interpretation, keyed by scope; schema titles otherwise. */
  labels?: Record<string, string>;
  onChange?: (pointer: string, value: unknown) => void;
  readOnly?: boolean;
  idPrefix?: string;
};

export function fieldId(pointer: string, prefix = ''): string {
  return `${prefix}${pointer.slice(1).replaceAll('/', '__')}`;
}

function numberFrom(raw: string): number | string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  return /^-?[0-9]{1,15}$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function isWide(node: FormSchemaView, renderer: string): boolean {
  return (
    node['x-ux4g']?.span === 2 ||
    renderer === 'Ux4gTextarea' ||
    renderer === 'Ux4gRadioGroup' ||
    renderer === 'Ux4gCheckbox'
  );
}

function Field({
  pointer,
  scope,
  format,
  props,
}: {
  pointer: string;
  scope: string;
  format: string | undefined;
  props: Ux4gFormLayoutProps;
}) {
  const node = schemaAt(props.schema, pointer) ?? {};
  const hints = node['x-ux4g'] ?? {};
  const renderer = resolveUx4gRenderer(node, format ? { control: format } : undefined);
  const id = fieldId(pointer, props.idPrefix);
  const label = props.labels?.[scope] ?? labelOf(node, pointer);
  const value = getAt(props.data, pointer);
  const required = props.isRequired(pointer);
  const error = props.errors?.[pointer];
  const note = props.notes?.[pointer];
  const change = (next: unknown) => props.onChange?.(pointer, next);
  const disabled = props.readOnly === true;
  const enumLabel = (v: unknown) => hints.enum_labels?.[String(v)] ?? String(v);
  let control: ReactNode;

  if (renderer === 'Ux4gCheckbox') {
    const messageId = error ? `${id}-error` : undefined;
    control = (
      <div className="sf-form-check">
        <Checkbox
          id={id}
          name={id}
          label={label}
          checked={value === true}
          error={Boolean(error)}
          disabled={disabled}
          aria-describedby={messageId}
          onChange={(e) => change(e.target.checked)}
        />
        {error ? (
          <p id={messageId} className="ux4g-input-helper ux4g-input-helper-text sf-form-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  } else if (renderer === 'Ux4gRadioGroup' && node.enum) {
    control = (
      <RadioGroup
        name={id}
        legend={required ? label : `${label} (optional)`}
        options={node.enum.map((v) => ({ value: String(v), label: enumLabel(v) }))}
        value={value === undefined ? '' : String(value)}
        onChange={(next) => change(next)}
        error={Boolean(error)}
        message={error}
        disabled={disabled}
      />
    );
  } else if (renderer === 'Ux4gSelect' && node.enum) {
    const messageId = error ? `${id}-error` : hints.hint ? `${id}-hint` : undefined;
    control = (
      <div
        className={`ux4g-input-container ux4g-input-m ${error ? 'ux4g-input-error' : 'ux4g-input-default'}`}
      >
        <label className="ux4g-label-m-default" htmlFor={id}>
          {label}
          {required ? null : <span className="sf-label-optional"> (optional)</span>}
        </label>
        <div className="ux4g-input">
          <select
            id={id}
            name={id}
            className="ux4g-input-input"
            value={value === undefined ? '' : String(value)}
            required={required}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={messageId}
            onChange={(e) => change(e.target.value === '' ? undefined : e.target.value)}
          >
            <option value="">Select</option>
            {node.enum.map((v) => (
              <option key={String(v)} value={String(v)}>
                {enumLabel(v)}
              </option>
            ))}
          </select>
        </div>
        {messageId ? (
          <p id={messageId} className="ux4g-input-helper ux4g-input-helper-text">
            {error ?? hints.hint}
          </p>
        ) : null}
      </div>
    );
  } else if (renderer === 'Ux4gTextarea') {
    const messageId = error ? `${id}-error` : hints.hint ? `${id}-hint` : undefined;
    control = (
      <div
        className={`ux4g-input-container ux4g-input-m ${error ? 'ux4g-input-error' : 'ux4g-input-default'}`}
      >
        <label className="ux4g-label-m-default" htmlFor={id}>
          {label}
          {required ? null : <span className="sf-label-optional"> (optional)</span>}
        </label>
        <textarea
          id={id}
          name={id}
          className="ux4g-textarea"
          rows={4}
          value={typeof value === 'string' ? value : ''}
          required={required}
          disabled={disabled}
          maxLength={node.maxLength}
          aria-invalid={Boolean(error)}
          aria-describedby={messageId}
          onChange={(e) => change(e.target.value === '' ? undefined : e.target.value)}
        />
        {messageId ? (
          <p id={messageId} className="ux4g-input-helper ux4g-input-helper-text">
            {error ?? hints.hint}
          </p>
        ) : null}
      </div>
    );
  } else if (renderer === 'Ux4gUnsupported') {
    control = (
      <p className="ux4g-body-s-default" role="note">
        {label}: no UX4G renderer is registered for this field.
      </p>
    );
  } else {
    const numeric = renderer === 'Ux4gNumberInput';
    control = (
      <TextInput
        id={id}
        name={id}
        label={label}
        type={renderer === 'Ux4gDateInput' ? 'date' : node.format === 'email' ? 'email' : 'text'}
        inputMode={numeric ? 'numeric' : hints.inputMode}
        autoComplete={hints.autocomplete}
        value={value === undefined || typeof value === 'boolean' ? '' : String(value)}
        required={required}
        optional={!required}
        disabled={disabled}
        maxLength={node.maxLength}
        error={error}
        state={note?.state ?? 'default'}
        hint={note?.hint ?? hints.hint}
        onChange={(e) =>
          change(
            numeric
              ? numberFrom(e.target.value)
              : e.target.value === ''
                ? undefined
                : e.target.value,
          )
        }
      />
    );
  }
  return isWide(node, renderer) ? <div className="sf-span-2">{control}</div> : <>{control}</>;
}

function Layout({ node, props }: { node: FormUiView; props: Ux4gFormLayoutProps }): ReactNode {
  if (node.type === 'Control') {
    if (!node.scope || !props.visible.has(node.scope)) return null;
    return (
      <Field
        pointer={scopeToPointer(node.scope)}
        scope={node.scope}
        format={node.options?.format}
        props={props}
      />
    );
  }
  const children = node.elements ?? [];
  if (!controlScopes(node).some((s) => props.visible.has(s))) return null;
  if (node.type === 'Group') {
    return (
      <div className="sf-form-section" role="group" aria-label={node.label}>
        {node.label ? <h3 className="ux4g-heading-s-strong">{node.label}</h3> : null}
        <div className="sf-form-grid">
          {children.map((child, i) => (
            <Layout key={child.scope ?? `${child.type}-${i}`} node={child} props={props} />
          ))}
        </div>
      </div>
    );
  }
  const onlyControls = children.every((c) => c.type === 'Control');
  const content = children.map((child, i) => (
    <Layout key={child.scope ?? `${child.type}-${i}`} node={child} props={props} />
  ));
  return onlyControls ? (
    <div className="sf-form-grid">{content}</div>
  ) : (
    <div className="sf-form-stack">{content}</div>
  );
}

/** Renders one layout node (a wizard step, Group or Control) of a FORM package with UX4G. */
export function Ux4gFormLayout(props: Ux4gFormLayoutProps) {
  return <Layout node={props.node} props={props} />;
}

export type Ux4gFormReviewProps = {
  schema: FormSchemaView;
  ui: FormUiView;
  data: FormData;
  visible: ReadonlySet<string>;
  labels?: Record<string, string>;
  onEdit?: (stepIndex: number) => void;
};

/** Read-only summary of every non-review step, for the final "Preview" step. */
export function Ux4gFormReview({ schema, ui, data, visible, labels, onEdit }: Ux4gFormReviewProps) {
  const steps = wizardSteps(ui);
  return (
    <div className="sf-preview-grid">
      {steps.map((step, index) => {
        if (step.review) return null;
        const scopes = controlScopes(step.node).filter((s) => visible.has(s));
        if (scopes.length === 0) return null;
        return (
          <section key={step.label} className="sf-preview-block sf-span-2">
            <div className="sf-preview-head">
              <h3 className="ux4g-heading-s-strong">{step.label}</h3>
              {onEdit ? (
                <Button
                  variant="text-primary"
                  size="s"
                  aria-label={`Change ${step.label.toLowerCase()} details`}
                  onClick={() => onEdit(index)}
                >
                  Change
                </Button>
              ) : null}
            </div>
            <dl className="sf-dl">
              {scopes.map((scope) => {
                const pointer = scopeToPointer(scope);
                const node = schemaAt(schema, pointer);
                return (
                  <div key={scope} className="sf-dl-row">
                    <dt>{labels?.[scope] ?? labelOf(node, pointer)}</dt>
                    <dd>{displayValue(node, getAt(data, pointer))}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
