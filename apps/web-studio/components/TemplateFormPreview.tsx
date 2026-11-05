'use client';

import {
  Button,
  isRequired,
  setAt,
  stepErrors,
  Ux4gFormLayout,
  visibleScopes,
  wizardSteps,
  type FieldErrors,
  type FormData,
  type FormPackageView,
} from '@serviceform/ui-ux4g';
import { useMemo, useState } from 'react';

/**
 * Interactive, local-only preview of a template version's form through the same UX4G renderer
 * the citizen portal uses. Nothing is submitted; validation here is the non-authoritative mirror.
 */
export function TemplateFormPreview({
  form,
  sample,
}: {
  form: FormPackageView;
  sample: FormData | undefined;
}) {
  const steps = useMemo(() => wizardSteps(form.ui_schema), [form]);
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<FormData>(sample ?? {});
  const [errors, setErrors] = useState<FieldErrors>({});
  const visible = useMemo(() => visibleScopes(form.ui_schema, data), [form, data]);
  const step = steps[index] ?? steps[0];
  if (!step) return null;

  function check() {
    if (!step) return;
    setErrors(stepErrors(form.json_schema, step.node, data, visible));
  }

  return (
    <div className="sf-preview-frame">
      <ul className="sf-step-tabs" aria-label="Preview steps">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Button
              variant={i === index ? 'tonal-primary' : 'text-neutral'}
              size="s"
              aria-pressed={i === index}
              onClick={() => {
                setIndex(i);
                setErrors({});
              }}
            >
              {i + 1}. {s.label}
            </Button>
          </li>
        ))}
      </ul>
      <h3 className="ux4g-heading-s-strong">{step.title}</h3>
      <Ux4gFormLayout
        node={step.node}
        schema={form.json_schema}
        data={data}
        visible={visible}
        isRequired={(p) => isRequired(form.json_schema, p, data)}
        errors={errors}
        onChange={(pointer, value) => setData((prev) => setAt(prev, pointer, value))}
        idPrefix="preview-"
      />
      <div className="sf-actions">
        <Button variant="outline-primary" size="s" onClick={check}>
          Check this step
        </Button>
        <span className="ux4g-body-s-default" role="status">
          {Object.keys(errors).length > 0
            ? `${Object.keys(errors).length} answer(s) need attention`
            : 'Preview only · nothing is submitted · CMP-009 validates on the citizen path'}
        </span>
      </div>
    </div>
  );
}
