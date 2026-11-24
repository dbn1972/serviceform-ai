'use client';

import {
  Alert,
  Button,
  controlScopes,
  fieldError,
  fieldId,
  getAt,
  isRequired,
  resolveUx4gRenderer,
  schemaAt,
  scopeToPointer,
  Select,
  setAt,
  stepErrors,
  stepOfPointer,
  Switch,
  Icon,
  Ux4gFormLayout,
  Ux4gFormReview,
  Ux4gFormStepper,
  visibleScopes,
  wizardSteps,
  type FieldErrors,
  type FormData,
  type FormPackageView,
  type FormUiView,
} from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

type Device = 'desktop' | 'mobile';

const ID_PREFIX = 'designer-preview-';

function controlFormats(node: FormUiView): Map<string, string | undefined> {
  if (node.type === 'Control') {
    return new Map(node.scope ? [[node.scope, node.options?.format]] : []);
  }
  return new Map((node.elements ?? []).flatMap((child) => [...controlFormats(child)]));
}

/** As the citizen wizard: show the question (label or legend) first, then focus the field. */
function focusField(id: string): void {
  const field =
    document.getElementById(id) ??
    document.querySelector<HTMLElement>(`[name="${CSS.escape(id)}"]`);
  if (!field) return;
  const question =
    field.closest('fieldset')?.querySelector('legend') ??
    document.querySelector(`label[for="${CSS.escape(field.id)}"]`) ??
    field;
  question.scrollIntoView({ block: 'start' });
  field.focus({ preventScroll: true });
}

/** Same markup and classes as the citizen wizard's error summary; links focus each field. */
function PreviewErrorSummary({
  errors,
  summaryRef,
}: {
  errors: FieldErrors;
  summaryRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={summaryRef}
      className="ux4g-form-alert ux4g-alert-error sf-auth-error-summary"
      role="alert"
      tabIndex={-1}
      aria-labelledby="preview-error-summary-title"
      data-testid="preview-error-summary"
    >
      <span className="ux4g-alert-icon">
        <Icon name="alert" />
      </span>
      <div className="ux4g-form-alert-body">
        <p id="preview-error-summary-title" className="ux4g-label-s-strong ux4g-text-error">
          {Object.keys(errors).length > 1
            ? `There are ${Object.keys(errors).length} problems`
            : 'There is a problem'}
        </p>
        <ul className="sf-auth-error-list">
          {Object.entries(errors).map(([pointer, message]) => {
            const id = fieldId(pointer, ID_PREFIX);
            return (
              <li key={pointer}>
                <a
                  href={`#${id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    focusField(id);
                  }}
                >
                  {message}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Per-control runtime state on the current step, as the citizen runtime computes it. */
function RuntimeDetails({
  form,
  node,
  data,
  visible,
  errors,
}: {
  form: FormPackageView;
  node: FormUiView;
  data: FormData;
  visible: Set<string>;
  errors: FieldErrors;
}) {
  const formats = controlFormats(node);
  return (
    <div className="sf-table-wrap">
      <table className="sf-table" data-testid="preview-runtime">
        <caption>
          Runtime details for this step: the UX4G renderer, visibility and requirement the citizen
          form computes for the current answers. CMP-009 computes the same on submit.
        </caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Data key</th>
            <th scope="col">UX4G renderer</th>
            <th scope="col">Shown</th>
            <th scope="col">Required</th>
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          {controlScopes(node).map((scope) => {
            const pointer = scopeToPointer(scope);
            const schema = schemaAt(form.json_schema, pointer) ?? {};
            const format = formats.get(scope);
            const shown = visible.has(scope);
            return (
              <tr key={scope}>
                <th scope="row">{schema.title ?? pointer}</th>
                <td>
                  <code className="sf-hash">{pointer.slice(1).replaceAll('/', '.')}</code>
                </td>
                <td>
                  <code className="sf-hash">
                    {resolveUx4gRenderer(schema, format ? { control: format } : undefined)}
                  </code>
                </td>
                <td>
                  {shown ? (
                    <span className="ux4g-tag-tonal-success">Shown</span>
                  ) : (
                    <span className="ux4g-tag-outline-neutral">Hidden</span>
                  )}
                </td>
                <td>
                  {shown && isRequired(form.json_schema, pointer, data) ? (
                    <span className="ux4g-tag-tonal-primary">Required</span>
                  ) : (
                    <span className="ux4g-tag-tonal-neutral">Optional</span>
                  )}
                </td>
                <td>
                  {errors[pointer] ? (
                    <span className="ux4g-tag-tonal-error">{errors[pointer]}</span>
                  ) : (
                    <span className="sf-designer-muted">
                      {getAt(data, pointer) === undefined ? '—' : 'OK'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Live, local-only preview of the compiled FORM package with the citizen wizard's layout and the
 * same UX4G renderer and runtime mirror. Nothing is submitted; CMP-009 stays authoritative and
 * `tests/cdc/studio-forms-preview-parity.cdc.test.ts` proves the mirror agrees with it.
 */
export function DesignerPreview({
  form,
  contentHash,
  version,
  data: initialData,
  onData,
}: {
  form: FormPackageView;
  contentHash?: string | undefined;
  version?: string;
  data?: FormData;
  onData?: (data: FormData) => void;
}) {
  const steps = useMemo(() => wizardSteps(form.ui_schema), [form]);
  const [index, setIndex] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [device, setDevice] = useState<Device>('desktop');
  const [data, setDataState] = useState<FormData>(initialData ?? {});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [runtime, setRuntime] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const visible = useMemo(() => visibleScopes(form.ui_schema, data), [form, data]);
  const current = Math.min(index, Math.max(steps.length - 1, 0));
  const step = steps[current];

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  if (!step) {
    return (
      <Alert variant="info" title="Nothing to preview">
        Add a step with at least one field.
      </Alert>
    );
  }

  const setData = (next: FormData) => {
    setDataState(next);
    onData?.(next);
  };

  const goTo = (i: number) => {
    setErrors({});
    setReady(false);
    setIndex(i);
    setFurthest((f) => Math.max(f, i));
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const change = (pointer: string, value: unknown) => {
    const next = setAt(data, pointer, value);
    setData(next);
    if (!errors[pointer]) return;
    // As the citizen wizard: a flagged field clears as soon as its answer is valid.
    const message = fieldError(form.json_schema, pointer, next);
    setErrors((prev) =>
      message
        ? { ...prev, [pointer]: message }
        : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== pointer)),
    );
  };

  const blur = (pointer: string) => {
    const value = getAt(data, pointer);
    if (value === undefined || value === '') return;
    const message = fieldError(form.json_schema, pointer, data);
    setErrors((prev) =>
      message
        ? { ...prev, [pointer]: message }
        : prev[pointer]
          ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== pointer))
          : prev,
    );
  };

  const fail = (found: FieldErrors) => {
    setErrors(found);
    setReady(false);
    setAttempt((n) => n + 1);
  };

  const next = () => {
    const found = stepErrors(form.json_schema, step.node, data, visible);
    if (Object.keys(found).length > 0) return fail(found);
    if (current < steps.length - 1) goTo(current + 1);
  };

  /** Every step at once, as CMP-009 validates the whole submission. */
  const checkAll = () => {
    const found = stepErrors(form.json_schema, form.ui_schema, data, visible);
    if (Object.keys(found).length === 0) {
      setErrors({});
      setReady(true);
      return;
    }
    const target = stepOfPointer(steps, Object.keys(found));
    const own = target >= 0 ? steps[target] : step;
    if (target >= 0 && target !== current) {
      setIndex(target);
      setFurthest((f) => Math.max(f, target));
    }
    fail(own ? stepErrors(form.json_schema, own.node, data, visible) : found);
  };

  const errorCount = Object.keys(errors).length;
  const layout = (
    <Ux4gFormLayout
      node={step.node}
      schema={form.json_schema}
      data={data}
      visible={visible}
      isRequired={(p) => isRequired(form.json_schema, p, data)}
      errors={errors}
      onChange={change}
      onBlur={blur}
      idPrefix={ID_PREFIX}
    />
  );

  return (
    <div className="sf-designer-preview">
      <div className="sf-designer-preview-bar">
        <div className="sf-designer-segmented" role="group" aria-label="Preview width">
          {(['desktop', 'mobile'] as const).map((d) => (
            <Button
              key={d}
              size="s"
              variant={device === d ? 'tonal-primary' : 'text-neutral'}
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
            >
              {d === 'desktop' ? 'Desktop' : 'Phone (360 px)'}
            </Button>
          ))}
        </div>
        <Button
          size="s"
          variant="text-neutral"
          onClick={() => {
            setData({});
            setErrors({});
            setReady(false);
            setIndex(0);
            setFurthest(0);
          }}
        >
          Clear answers
        </Button>
        {steps.length > 1 ? (
          <Select
            id="preview-jump"
            label="Jump to step"
            size="s"
            value={String(current)}
            options={steps.map((s, i) => ({ value: String(i), label: `${i + 1}. ${s.label}` }))}
            onChange={(e) => goTo(Number(e.target.value))}
          />
        ) : null}
        <Switch
          id="preview-runtime-toggle"
          label="Runtime details"
          checked={runtime}
          onChange={setRuntime}
        />
        <span className="ux4g-body-s-default sf-designer-muted">
          Preview only · nothing is submitted · same UX4G runtime as the citizen form
        </span>
      </div>
      <div className={`sf-designer-device sf-designer-device-${device}`}>
        <div className="sf-wizard">
          <Ux4gFormStepper
            label="Preview steps"
            steps={steps.map((s) => ({ label: s.label, hint: s.hint }))}
            current={current}
            reachable={furthest}
            onSelect={goTo}
          />

          <div className="sf-wizard-main">
            {errorCount > 0 && attempt > 0 ? (
              <PreviewErrorSummary errors={errors} summaryRef={summaryRef} />
            ) : null}
            {ready ? (
              <Alert variant="success" title="Every answer passes the form checks">
                In the citizen portal this application could now be submitted; CMP-009 checks the
                same answers again on submit.
              </Alert>
            ) : null}
            <section className="sf-step-panel" aria-labelledby="preview-step-heading">
              <header className="sf-step-head">
                <h2
                  id="preview-step-heading"
                  ref={headingRef}
                  tabIndex={-1}
                  className="sf-step-title"
                >
                  <span className="ux4g-label-l-strong sf-step-kicker">
                    Step {current + 1} of {steps.length}
                  </span>
                  <span className="ux4g-heading-m-strong">{step.title}</span>
                </h2>
                <p className="ux4g-body-m-default sf-step-lead">
                  {step.review
                    ? 'Check every answer before you submit. Use Change to correct anything.'
                    : step.hint}
                </p>
              </header>
              {step.review ? (
                <>
                  <Ux4gFormReview
                    schema={form.json_schema}
                    ui={form.ui_schema}
                    data={data}
                    visible={visible}
                    onEdit={goTo}
                  />
                  <div className="sf-form-section">
                    <h3 className="ux4g-heading-xs-strong">Declaration</h3>
                    {layout}
                  </div>
                </>
              ) : (
                layout
              )}
              <p className="ux4g-body-s-default sf-form-provenance">
                Form {form.form_id}
                {version ? ` · v${version}` : ''}
                {contentHash ? ` · draft ${shortHash(contentHash)}` : ''} · checked by the CMP-009
                form engine on submit
              </p>
            </section>
            {runtime ? (
              <RuntimeDetails
                form={form}
                node={step.node}
                data={data}
                visible={visible}
                errors={errors}
              />
            ) : null}
            <div className="sf-wizard-actions">
              <div className="sf-wizard-actions-start">
                {current > 0 ? (
                  <Button variant="outline-neutral" onClick={() => goTo(current - 1)}>
                    Back
                  </Button>
                ) : null}
                <p className="ux4g-body-s-default sf-save-status" role="status">
                  {errorCount > 0 ? `${errorCount} answer(s) need attention` : ''}
                </p>
              </div>
              <div className="sf-wizard-actions-end">
                <Button
                  variant={current < steps.length - 1 ? 'outline-primary' : 'primary'}
                  onClick={checkAll}
                >
                  Check whole form
                </Button>
                {current < steps.length - 1 ? (
                  <Button onClick={next}>Check and continue</Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
