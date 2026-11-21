'use client';

import {
  Button,
  Card,
  fieldId,
  getAt,
  isRequired,
  ruleConditionScopes,
  scopeToPointer,
  setAt,
  stepErrors,
  stepOfPointer,
  Ux4gFormLayout,
  Ux4gFormReview,
  visibleScopes,
  wizardSteps,
  withoutHidden,
  type FieldErrors,
  type FieldNote,
  type FormData,
  type FormPackageView,
  type FormSchemaView,
  type InterpretedControl,
} from '@serviceform/ui-ux4g';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EvidenceUploadField, type EvidenceUploadValue } from './EvidenceUploadField';
import { ErrorSummary, FormAlert } from './FormFeedback';
import { useCitizen } from './RequireCitizenSession';

type Policy = { fee: string; service_time: string; eligibility: string };
type IndicativeCheck = { pointer: string; minimum: number; label: string };

interface FormResponse {
  catalogue_id: string;
  service: { name: string; policy: Policy; indicative_checks: IndicativeCheck[] };
  form: {
    pin: { form_key: string; version_id: string; content_hash: string };
    version: string;
    package: FormPackageView;
  };
  prefill: FormData;
  prefill_source?: 'CMP-005' | 'SAMPLE_LAB' | null;
  interpretation: { controls: InterpretedControl[] };
}

type Interpretation = { key: string; controls: InterpretedControl[] };

const MOBILE = 'SF-SEM-PERSON-MOBILE';
const newKey = () => crypto.randomUUID().replace(/-/g, '');

function mobilePointers(schema: FormSchemaView, base = ''): string[] {
  return Object.entries(schema.properties ?? {}).flatMap(([name, node]) => {
    const pointer = `${base}/${name}`;
    const own = (node as { semanticElementId?: string }).semanticElementId === MOBILE;
    return [...(own ? [pointer] : []), ...(node.properties ? mobilePointers(node, pointer) : [])];
  });
}

function ruleKey(scopes: readonly string[], data: FormData): string {
  return JSON.stringify(scopes.map((s) => getAt(data, scopeToPointer(s)) ?? null));
}

/**
 * Citizen application wizard rendered from a pinned published FORM package. Steps, sections,
 * controls, labels and conditional visibility come from metadata and the CMP-009 interpretation;
 * CMP-009 validates the submission authoritatively before CMP-015 stores it.
 */
export function MetadataApplyForm({ catalogueId }: { catalogueId: string }) {
  const router = useRouter();
  const citizen = useCitizen();
  const [loaded, setLoaded] = useState<FormResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<FormData>({});
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [evidenceUpload, setEvidenceUpload] = useState<EvidenceUploadValue | null>(null);
  // One submission key per form session; rotated only when nothing was created (refused input).
  const submissionKey = useRef(newKey());
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/portal/forms/${catalogueId}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as FormResponse & { message?: string };
      if (cancelled) return;
      if (!res.ok || !body.form) {
        setLoadError(body.message ?? 'We could not load this form. Try again shortly.');
        return;
      }
      let initial: FormData = { ...body.prefill };
      for (const pointer of mobilePointers(body.form.package.json_schema)) {
        if (getAt(initial, pointer) === undefined && citizen.mobile) {
          initial = setAt(initial, pointer, citizen.mobile);
        }
      }
      const scopes = ruleConditionScopes(body.form.package.ui_schema);
      setLoaded(body);
      setData(initial);
      setInterpretation({
        key: ruleKey(scopes, body.prefill),
        controls: body.interpretation.controls,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogueId, citizen.mobile]);

  const pack = loaded?.form.package;
  const schema = pack?.json_schema;
  const ui = pack?.ui_schema;
  const steps = useMemo(() => (ui ? wizardSteps(ui) : []), [ui]);
  const conditionScopes = useMemo(() => (ui ? ruleConditionScopes(ui) : []), [ui]);
  const currentKey = ruleKey(conditionScopes, data);
  const fresh = interpretation?.key === currentKey ? interpretation : null;

  // Re-interpret through CMP-009 only when a value that drives a rule changes.
  useEffect(() => {
    if (!loaded || interpretation?.key === currentKey) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        const res = await fetch(`/api/portal/forms/${catalogueId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          interpretation?: { controls: InterpretedControl[] };
        };
        if (res.ok && body.interpretation) {
          setInterpretation({ key: currentKey, controls: body.interpretation.controls });
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [loaded, interpretation?.key, currentKey, catalogueId, data]);

  const visible = useMemo(() => {
    if (!ui) return new Set<string>();
    if (fresh) return new Set(fresh.controls.filter((c) => c.visible).map((c) => c.scope));
    return visibleScopes(ui, data);
  }, [ui, fresh, data]);

  const labels = useMemo(
    () =>
      Object.fromEntries(
        (interpretation?.controls ?? []).filter((c) => c.label).map((c) => [c.scope, c.label]),
      ) as Record<string, string>,
    [interpretation],
  );

  const required = useCallback(
    (pointer: string) => {
      const control = fresh?.controls.find((c) => scopeToPointer(c.scope) === pointer);
      if (control) return control.required;
      return schema ? isRequired(schema, pointer, data) : false;
    },
    [fresh, schema, data],
  );

  const notes = useMemo(() => {
    const out: Record<string, FieldNote> = {};
    if (!schema) return out;
    for (const pointer of mobilePointers(schema)) {
      if (citizen.mobile && getAt(data, pointer) === citizen.mobile) {
        out[pointer] = { state: 'success', hint: 'Verified by OTP at sign-in' };
      }
    }
    return out;
  }, [schema, data, citizen.mobile]);

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  if (loadError) {
    return (
      <FormAlert tone="error" title="Form unavailable">
        {loadError}
      </FormAlert>
    );
  }
  if (!loaded || !schema || !ui || steps.length === 0) {
    return (
      <Card title="Loading the application form" subtitle="Published form · CMP-009">
        <p className="ux4g-body-m-default" role="status">
          Fetching the pinned form version…
        </p>
      </Card>
    );
  }

  const step = steps[stepIndex] ?? steps[0];
  if (!step) return null;
  const isLast = stepIndex === steps.length - 1;
  const checks = loaded.service.indicative_checks.map((c) => {
    const value = getAt(data, c.pointer);
    return { ...c, value, pass: typeof value === 'number' && value >= c.minimum };
  });
  const policy = loaded.service.policy;

  function change(pointer: string, value: unknown) {
    setData((prev) => setAt(prev, pointer, value));
    if (errors[pointer]) {
      setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== pointer)));
    }
  }

  function showErrors(found: FieldErrors, message: string) {
    setErrors(found);
    setSummary(message);
    setAttempt((n) => n + 1);
  }

  function goTo(index: number) {
    setErrors({});
    setSummary('');
    setStepIndex(index);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  function evidenceStep(): boolean {
    return (step?.label ?? '').toLowerCase() === 'evidence';
  }

  function applyEvidenceUpload(nextUpload: EvidenceUploadValue | null) {
    setEvidenceUpload(nextUpload);
    if (nextUpload?.technically_accepted) {
      // Pin the CMP-013 document id into the published evidence_file_name field (immutable schema).
      change('/evidence_file_name', nextUpload.document_id);
      change('/evidence_mime', nextUpload.content_type);
    } else if (!nextUpload) {
      change('/evidence_file_name', '');
      change('/evidence_mime', undefined);
    }
  }

  function requireEvidenceUpload(): boolean {
    if (!evidenceStep() && !isLast) return true;
    if (evidenceUpload?.technically_accepted && evidenceUpload.document_id) return true;
    const fileName = getAt(data, '/evidence_file_name');
    if (
      typeof fileName === 'string' &&
      /^[0-9a-f-]{36}$/i.test(fileName) &&
      evidenceUpload?.technically_accepted
    ) {
      return true;
    }
    showErrors(
      {
        '/evidence_file_name':
          'Upload a supporting document and wait until it is technically accepted',
      },
      'Upload required evidence before you continue',
    );
    return false;
  }

  function next() {
    if (!schema || !step) return;
    const found = stepErrors(schema, step.node, data, visible);
    if (Object.keys(found).length > 0) {
      showErrors(found, 'Check the highlighted answers before you continue');
      return;
    }
    if (evidenceStep() && !requireEvidenceUpload()) return;
    goTo(stepIndex + 1);
  }

  async function submit() {
    if (!schema || !ui || !step) return;
    const found = stepErrors(schema, step.node, data, visible);
    if (Object.keys(found).length > 0) {
      showErrors(found, 'Check the highlighted answers before you submit');
      return;
    }
    if (!requireEvidenceUpload()) return;
    setBusy(true);
    setSummary('');
    const payload = withoutHidden(ui, data, visible);
    if (evidenceUpload?.document_id) {
      payload['evidence_file_name'] = evidenceUpload.document_id;
      payload['evidence_mime'] = evidenceUpload.content_type;
    }
    const res = await fetch('/api/portal/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': submissionKey.current },
      body: JSON.stringify({ catalogue_id: catalogueId, data: payload }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      field?: string;
      field_errors?: { pointer: string; message: string }[];
      application?: { id: string };
    };
    setBusy(false);
    if (res.ok && body.application) {
      router.push(`/certificates/${body.application.id}`);
      return;
    }
    const fieldErrors: FieldErrors = {};
    for (const e of body.field_errors ?? []) fieldErrors[e.pointer] ??= e.message;
    if (body.field) fieldErrors[`/${body.field.replaceAll('.', '/')}`] = body.message ?? '';
    if (res.status === 422 || res.status === 400) submissionKey.current = newKey();
    const target = stepOfPointer(steps, Object.keys(fieldErrors));
    if (target >= 0 && target !== stepIndex) setStepIndex(target);
    showErrors(fieldErrors, body.message ?? 'We could not submit your application. Try again.');
  }

  const errorEntries = Object.entries(errors).filter(([, m]) => m);

  return (
    <div className="sf-wizard">
      <nav className="sf-stepper" aria-label="Application steps">
        <ol className="sf-stepper-list">
          {steps.map((s, i) => {
            const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
            return (
              <li key={s.label} className={`sf-stepper-item sf-stepper-${state}`}>
                <button
                  type="button"
                  className="sf-stepper-btn"
                  aria-current={state === 'current' ? 'step' : undefined}
                  onClick={() => {
                    if (i <= stepIndex) goTo(i);
                  }}
                >
                  <span className="sf-stepper-index" aria-hidden="true">
                    {i < stepIndex ? '✓' : i + 1}
                  </span>
                  <span className="sf-stepper-copy">
                    <span className="ux4g-label-m-strong">{s.label}</span>
                    <span className="ux4g-body-s-default">{s.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="sf-wizard-main">
        <FormAlert
          tone="info"
          title={
            citizen.masked_mobile
              ? `Signed in as ${citizen.masked_mobile}`
              : 'Signed in with a verified mobile (OTP)'
          }
        >
          {loaded?.prefill_source === 'CMP-005'
            ? 'Your name and mobile are pre-filled from your citizen profile, with sample answers for the rest.'
            : 'Sample answers are pre-filled. Create an account with your name to pre-fill it from your citizen profile.'}{' '}
          Every field follows the published form; use synthetic values only — SAMPLE_LAB, G6 not
          issued.
        </FormAlert>

        <div className="sf-meta-row" aria-label="Service policy summary">
          <span className="ux4g-tag-tonal-info">Eligibility {policy.eligibility}</span>
          <span className="ux4g-tag-tonal-success">Fee {policy.fee}</span>
          <span className="ux4g-tag-tonal-neutral">Service time {policy.service_time}</span>
          <span className="ux4g-tag-outline-warning">DigiLocker SIMULATED</span>
        </div>

        {summary && errorEntries.length > 0 ? (
          <ErrorSummary
            ref={summaryRef}
            items={errorEntries.map(([pointer, message]) => ({
              fieldId: fieldId(pointer),
              message,
            }))}
          />
        ) : summary ? (
          <div ref={summaryRef} tabIndex={-1}>
            <FormAlert tone="error" title="Cannot continue">
              {summary}
            </FormAlert>
          </div>
        ) : null}

        <Card
          title={`${stepIndex + 1}. ${step.title}`}
          subtitle={step.review ? 'Review every answer before you submit' : step.hint}
        >
          <h3 ref={headingRef} tabIndex={-1} className="ux4g-sr-only">
            Step {stepIndex + 1} of {steps.length}: {step.label}
          </h3>
          {step.review ? (
            <>
              {checks.map((c) => (
                <FormAlert
                  key={c.pointer}
                  tone={c.pass ? 'success' : 'warning'}
                  title={c.pass ? 'Indicative check: met' : 'Indicative check: not met'}
                >
                  {c.label}. You entered {String(c.value ?? '—')}. This is not a decision: the
                  officer decides after verification.
                </FormAlert>
              ))}
              <Ux4gFormReview
                schema={schema}
                ui={ui}
                data={data}
                visible={visible}
                labels={labels}
                onEdit={goTo}
              />
            </>
          ) : null}
          {step.review ? (
            <div className="sf-form-section">
              <h3 className="ux4g-heading-s-strong">Declaration</h3>
              <Ux4gFormLayout
                node={step.node}
                schema={schema}
                data={data}
                visible={visible}
                isRequired={required}
                errors={errors}
                notes={notes}
                labels={labels}
                onChange={change}
              />
            </div>
          ) : (
            <>
              <Ux4gFormLayout
                node={step.node}
                schema={schema}
                data={data}
                visible={visible}
                isRequired={required}
                errors={errors}
                notes={notes}
                labels={labels}
                onChange={change}
              />
              {evidenceStep() ? (
                <EvidenceUploadField
                  label="Upload supporting evidence"
                  value={evidenceUpload}
                  onChange={applyEvidenceUpload}
                  disabled={busy}
                  hint="Required. PDF, PNG or JPEG up to 1 MB. CMP-013 technical acceptance only — not officer verification."
                />
              ) : null}
            </>
          )}
          <p className="ux4g-body-s-default sf-form-provenance">
            Form {loaded.form.pin.form_key} · v{loaded.form.version} · pinned{' '}
            {loaded.form.pin.content_hash.slice(0, 15)}… · checked by the CMP-009 form engine
          </p>
        </Card>

        <div className="sf-wizard-actions">
          {stepIndex > 0 ? (
            <Button variant="outline-neutral" onClick={() => goTo(stepIndex - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="sf-actions">
            {!isLast ? (
              <Button onClick={next}>Save &amp; continue</Button>
            ) : (
              <Button disabled={busy} onClick={() => void submit()}>
                {busy ? 'Submitting…' : `Submit application (${policy.fee})`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
