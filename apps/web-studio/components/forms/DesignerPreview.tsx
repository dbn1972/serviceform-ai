'use client';

import {
  Alert,
  Button,
  isRequired,
  setAt,
  stepErrors,
  Ux4gFormLayout,
  Ux4gFormReview,
  visibleScopes,
  wizardSteps,
  type FieldErrors,
  type FormData,
  type FormPackageView,
} from '@serviceform/ui-ux4g';
import { useMemo, useState } from 'react';

type Device = 'desktop' | 'mobile';

/**
 * Live, local-only preview of the compiled FORM package through the same UX4G renderer the citizen
 * portal uses. Nothing is submitted; checks here mirror CMP-009, which stays authoritative.
 */
export function DesignerPreview({ form }: { form: FormPackageView }) {
  const steps = useMemo(() => wizardSteps(form.ui_schema), [form]);
  const [index, setIndex] = useState(0);
  const [device, setDevice] = useState<Device>('desktop');
  const [data, setData] = useState<FormData>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const visible = useMemo(() => visibleScopes(form.ui_schema, data), [form, data]);
  const current = Math.min(index, Math.max(steps.length - 1, 0));
  const step = steps[current];

  if (!step) {
    return (
      <Alert variant="info" title="Nothing to preview">
        Add a step with at least one field.
      </Alert>
    );
  }

  const check = () => {
    const found = stepErrors(form.json_schema, step.node, data, visible);
    setErrors(found);
    return Object.keys(found).length === 0;
  };

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
            setIndex(0);
          }}
        >
          Clear answers
        </Button>
        <span className="ux4g-body-s-default sf-designer-muted">
          Preview only · nothing is submitted · CMP-009 validates on the citizen path
        </span>
      </div>
      <div className={`sf-designer-device sf-designer-device-${device}`}>
        <ol className="sf-designer-preview-steps" aria-label="Preview steps">
          {steps.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <Button
                size="s"
                variant={i === current ? 'tonal-primary' : 'text-neutral'}
                aria-current={i === current ? 'step' : undefined}
                onClick={() => {
                  setIndex(i);
                  setErrors({});
                }}
              >
                {i + 1}. {s.label}
              </Button>
            </li>
          ))}
        </ol>
        <section className="sf-designer-preview-card" aria-labelledby="preview-step-title">
          <h3 id="preview-step-title" className="ux4g-heading-s-strong">
            {step.title}
          </h3>
          {step.hint ? <p className="ux4g-body-s-default sf-designer-muted">{step.hint}</p> : null}
          {step.review ? (
            <Ux4gFormReview
              schema={form.json_schema}
              ui={form.ui_schema}
              data={data}
              visible={visible}
              onEdit={(i) => setIndex(i)}
            />
          ) : null}
          <Ux4gFormLayout
            node={step.node}
            schema={form.json_schema}
            data={data}
            visible={visible}
            isRequired={(p) => isRequired(form.json_schema, p, data)}
            errors={errors}
            onChange={(pointer, value) => setData((prev) => setAt(prev, pointer, value))}
            idPrefix="designer-preview-"
          />
          <div className="sf-actions">
            <Button
              variant="outline-primary"
              size="s"
              disabled={current === 0}
              onClick={() => {
                setErrors({});
                setIndex(current - 1);
              }}
            >
              Back
            </Button>
            <Button
              size="s"
              onClick={() => {
                if (check() && current < steps.length - 1) setIndex(current + 1);
              }}
            >
              {current < steps.length - 1 ? 'Check and continue' : 'Check answers'}
            </Button>
            <span className="ux4g-body-s-default" role="status">
              {Object.keys(errors).length > 0
                ? `${Object.keys(errors).length} answer(s) need attention`
                : ''}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
