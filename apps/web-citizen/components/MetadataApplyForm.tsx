'use client';

import {
  attachCitizenAbandonHooks,
  beginCitizenFormJourney,
  getBrowserProductMetrics,
} from '@serviceform/forms-product-metrics/browser-product-metrics';
import { recordA11yScore } from '@serviceform/forms-product-metrics/forms-journey-metrics';
import type { CitizenFormSession } from '@serviceform/forms-product-metrics/forms-journey-metrics';
import {
  Button,
  controlScopes,
  fieldError,
  fieldId,
  formProgress,
  getAt,
  Icon,
  isRequired,
  resumeStepIndex,
  ruleConditionScopes,
  scopeToPointer,
  setAt,
  stepErrors,
  stepOfPointer,
  Ux4gFormLayout,
  Ux4gFormReview,
  Ux4gFormStepper,
  visibleScopes,
  wizardSteps,
  withoutHidden,
  type FieldErrors,
  type FieldNote,
  type FormData,
  type FormPackageView,
  type FormSchemaView,
  type InterpretedControl,
  type WizardStep,
} from '@serviceform/ui-ux4g';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
} from 'react';
import { citizenPolicyText } from '../lib/catalogue';
import { markJustSubmitted } from '../lib/just-submitted';
import { EvidenceUploadField, fileKind, type EvidenceUploadValue } from './EvidenceUploadField';
import { ErrorSummary, FormAlert, type FormAlertTone } from './FormFeedback';
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

interface SavedDraft {
  application_id: string;
  catalogue_id: string;
  revision: number;
  form_version_id: string;
  saved_at: string;
  data: FormData;
}

type Interpretation = { key: string; controls: InterpretedControl[] };
type Draft = { id: string; revision: number; savedAt: string };
type SaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: string }
  | { state: 'error'; message: string; retry: boolean };
type SaveResult = { ok: true } | { ok: false; message: string; fieldErrors?: FieldErrors };
type Notice = {
  tone: FormAlertTone;
  title: string;
  body: string;
  action?: { href: string; label: string };
};
type Summary = { message: string; fields: boolean };
type Motion = 'forward' | 'back' | null;

const MOBILE = 'SF-SEM-PERSON-MOBILE';
/** CMP-013 upload binds these published fields (SF-49); the schema itself stays immutable. */
const EVIDENCE = '/evidence_file_name';
const EVIDENCE_MIME = '/evidence_mime';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVE_FAILED = 'Not saved just now. Your answers are still on this page.';
/** Space kept between a focused field and the sticky action bar, in CSS px. */
const FOCUS_GAP = 8;
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

function holdsEvidence(step: WizardStep | undefined): boolean {
  return step ? controlScopes(step.node).some((s) => scopeToPointer(s) === EVIDENCE) : false;
}

function timeOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function withoutKey(errors: FieldErrors, key: string): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key));
}

/** Restores the technically accepted CMP-013 upload a saved draft points at, if it still exists. */
async function savedUpload(data: FormData): Promise<EvidenceUploadValue | null> {
  const id = getAt(data, EVIDENCE);
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const res = await fetch(`/api/portal/documents/${id}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => ({}))) as {
    document?: { status: string; content_type?: string };
    technically_accepted?: boolean;
  };
  if (!body.technically_accepted || !body.document) return null;
  const mime = getAt(data, EVIDENCE_MIME);
  return {
    document_id: id,
    file_name: 'Saved document',
    content_type: body.document.content_type ?? (typeof mime === 'string' ? mime : ''),
    status: body.document.status,
    technically_accepted: true,
  };
}

/**
 * Citizen application wizard rendered from a pinned published FORM package. Steps, sections,
 * controls, labels and conditional visibility come from metadata and the CMP-009 interpretation;
 * CMP-009 validates the submission authoritatively before CMP-015 stores it. Answers are saved
 * as a CMP-015 DRAFT on every step, so the citizen can leave and resume from My applications.
 */
export function MetadataApplyForm({ catalogueId }: { catalogueId: string }) {
  const router = useRouter();
  const citizen = useCitizen();
  const [loaded, setLoaded] = useState<FormResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<FormData>({});
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [motion, setMotion] = useState<Motion>(null);
  const [furthest, setFurthest] = useState(0);
  const [checkedAll, setCheckedAll] = useState(false);
  const [returnToReview, setReturnToReview] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [evidenceUpload, setEvidenceUpload] = useState<EvidenceUploadValue | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [save, setSave] = useState<SaveState>({ state: 'idle' });
  const [notice, setNotice] = useState<Notice | null>(null);
  // One submission key per form session; rotated only when nothing was created (refused input).
  const submissionKey = useRef(newKey());
  const draftKey = useRef(newKey());
  const draftRef = useRef<Draft | null>(null);
  const saving = useRef<Promise<SaveResult> | null>(null);
  const pending = useRef<FormData | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const baseTitle = useRef<string | null>(null);
  const journey = useRef<CitizenFormSession | null>(null);
  const loadStarted = useRef(0);

  useEffect(() => {
    const session = beginCitizenFormJourney({ catalogue_class: 'CERTIFICATE' });
    journey.current = session;
    loadStarted.current = performance.now();
    const detachAbandon = attachCitizenAbandonHooks(session);
    // Optional lab hook: window.__SF_A11Y_SCORE__ = { violations, incomplete, passes }
    const a11y = (window as unknown as { __SF_A11Y_SCORE__?: Record<string, number> })
      .__SF_A11Y_SCORE__;
    if (a11y && typeof a11y['violations'] === 'number') {
      recordA11yScore(getBrowserProductMetrics(), {
        surface: 'citizen',
        tool: 'AXE',
        violations: a11y['violations'] ?? 0,
        incomplete: a11y['incomplete'] ?? 0,
        passes: a11y['passes'] ?? 0,
        route_class: 'CITIZEN_APPLY',
      });
    }
    return () => {
      detachAbandon();
      if (journey.current && !journey.current.completed && !journey.current.abandoned) {
        journey.current.markAbandon('NAVIGATE');
      }
      journey.current = null;
    };
  }, [catalogueId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draftId = new URLSearchParams(window.location.search).get('draft');
      const [res, savedRes] = await Promise.all([
        fetch(`/api/portal/forms/${catalogueId}`, { cache: 'no-store' }),
        draftId
          ? fetch(`/api/portal/drafts/${encodeURIComponent(draftId)}`, { cache: 'no-store' })
          : Promise.resolve(null),
      ]);
      const body = (await res.json().catch(() => ({}))) as FormResponse & { message?: string };
      if (cancelled) return;
      const loadMs = performance.now() - loadStarted.current;
      if (!res.ok || !body.form) {
        journey.current?.markLoaded(loadMs, 'ERROR');
        setLoadError(body.message ?? 'We could not load this form. Try again shortly.');
        return;
      }
      journey.current?.markLoaded(loadMs, 'OK');
      let resumed: SavedDraft | null = null;
      let restoredNotice: Notice | null = null;
      if (savedRes) {
        const saved = (await savedRes.json().catch(() => ({}))) as {
          draft?: SavedDraft;
          message?: string;
          application_id?: string;
        };
        if (
          savedRes.ok &&
          saved.draft?.catalogue_id === catalogueId &&
          saved.draft.form_version_id === body.form.pin.version_id
        ) {
          resumed = saved.draft;
        } else {
          restoredNotice =
            savedRes.status === 409 && saved.application_id
              ? {
                  tone: 'info',
                  title: 'Already submitted',
                  body: saved.message ?? 'This application has already been submitted.',
                  action: {
                    href: `/certificates/${saved.application_id}`,
                    label: 'View its status',
                  },
                }
              : savedRes.ok
                ? {
                    tone: 'warning',
                    title: 'The form has changed',
                    body: 'This service form was updated after you saved, so your saved answers cannot be reused. Start again below.',
                  }
                : {
                    tone: 'warning',
                    title: 'Saved application not found',
                    body: 'We could not find that saved application. You can start a new one below.',
                  };
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      let initial: FormData = resumed ? { ...resumed.data } : { ...body.prefill };
      for (const pointer of mobilePointers(body.form.package.json_schema)) {
        if (getAt(initial, pointer) === undefined && citizen.mobile) {
          initial = setAt(initial, pointer, citizen.mobile);
        }
      }
      const upload = resumed ? await savedUpload(initial) : null;
      if (resumed && !upload) {
        initial = setAt(setAt(initial, EVIDENCE, undefined), EVIDENCE_MIME, undefined);
      }
      if (cancelled) return;
      const { json_schema: schema, ui_schema: ui } = body.form.package;
      setLoaded(body);
      setData(initial);
      setEvidenceUpload(upload);
      setInterpretation({
        key: ruleKey(ruleConditionScopes(ui), body.prefill),
        controls: body.interpretation.controls,
      });
      if (resumed) {
        const saved = {
          id: resumed.application_id,
          revision: resumed.revision,
          savedAt: resumed.saved_at,
        };
        draftRef.current = saved;
        setDraft(saved);
        setSave({ state: 'saved', at: resumed.saved_at });
        const steps = wizardSteps(ui);
        let start = resumeStepIndex(schema, steps, initial, visibleScopes(ui, initial));
        const evidenceAt = steps.findIndex(holdsEvidence);
        if (!upload && evidenceAt >= 0 && evidenceAt < start) start = evidenceAt;
        setStepIndex(start);
        setFurthest(start);
        const when = timeOf(resumed.saved_at) ? ` at ${timeOf(resumed.saved_at)}` : '';
        restoredNotice = {
          tone: 'success',
          title: 'Welcome back',
          body: steps[start]?.review
            ? `We restored the answers you saved${when}. Everything is answered: check them and submit.`
            : `We restored the answers you saved${when}. You are on the first step that still needs an answer.`,
        };
      }
      setNotice(restoredNotice);
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

  const errorEntries = Object.entries(errors).filter(([, m]) => m);
  const step = steps[stepIndex] ?? steps[0];

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  useEffect(() => {
    if (notice?.tone === 'success' && notice.title === 'Saved') noticeRef.current?.focus();
  }, [notice]);

  // Page title names the step and flags errors, so tab lists and screen readers say where you are.
  useEffect(() => {
    if (!step) return;
    baseTitle.current ??= document.title;
    const flag = summary && errorEntries.length > 0 ? 'Error: ' : '';
    document.title = `${flag}${step.title} (step ${stepIndex + 1} of ${steps.length}) - ${baseTitle.current}`;
  }, [step, stepIndex, steps.length, summary, errorEntries.length]);

  if (loadError) {
    return (
      <FormAlert tone="error" title="Form unavailable">
        {loadError}
      </FormAlert>
    );
  }
  if (!loaded || !schema || !ui || !step) {
    return (
      <div className="sf-gate" role="status">
        <span className="sf-spinner" aria-hidden="true" />
        <p className="ux4g-body-m-default">Loading the application form…</p>
      </div>
    );
  }

  const isLast = stepIndex === steps.length - 1;
  const reviewIndex = steps.findIndex((s) => s.review);
  const hasEvidence = Boolean(schema.properties?.['evidence_file_name']);
  const checks = loaded.service.indicative_checks.map((c) => {
    const value = getAt(data, c.pointer);
    return { ...c, value, pass: typeof value === 'number' && value >= c.minimum };
  });
  const policy = loaded.service.policy;

  function payloadOf(current: FormData): FormData {
    let payload = ui ? withoutHidden(ui, current, visible) : current;
    if (evidenceUpload?.document_id) {
      payload = setAt(payload, EVIDENCE, evidenceUpload.document_id);
      payload = setAt(payload, EVIDENCE_MIME, evidenceUpload.content_type);
    }
    return payload;
  }

  async function persist(payload: FormData): Promise<SaveResult> {
    const current = draftRef.current;
    setSave({ state: 'saving' });
    const res = await fetch(current ? `/api/portal/drafts/${current.id}` : '/api/portal/drafts', {
      method: current ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': draftKey.current },
      body: JSON.stringify({
        catalogue_id: catalogueId,
        data: payload,
        ...(current ? { expected_revision: current.revision } : {}),
      }),
    }).catch(() => null);
    const body = (res ? await res.json().catch(() => ({})) : {}) as {
      draft?: { application_id: string; revision: number; saved_at: string };
      message?: string;
      field?: string;
    };
    if (res?.ok && body.draft) {
      const next = {
        id: body.draft.application_id,
        revision: body.draft.revision,
        savedAt: body.draft.saved_at,
      };
      if (!current) {
        window.history.replaceState(null, '', `${window.location.pathname}?draft=${next.id}`);
      }
      draftRef.current = next;
      setDraft(next);
      setSave({ state: 'saved', at: next.savedAt });
      return { ok: true };
    }
    if (res?.status === 400 && body.field) {
      setSave({
        state: 'error',
        message: 'Not saved: check the highlighted answer.',
        retry: false,
      });
      return {
        ok: false,
        message: body.message ?? 'Check the highlighted answer',
        fieldErrors: { [`/${body.field.replaceAll('.', '/')}`]: body.message ?? '' },
      };
    }
    const message = body.message ?? SAVE_FAILED;
    setSave({ state: 'error', message, retry: true });
    return { ok: false, message };
  }

  /** One save in flight at a time, always sending the latest answers. */
  function queueSave(payload: FormData): Promise<SaveResult> {
    pending.current = payload;
    saving.current ??= (async () => {
      let result: SaveResult = { ok: true };
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        result = await persist(next);
        if (!result.ok) pending.current = null;
      }
      saving.current = null;
      return result;
    })();
    return saving.current;
  }

  function showErrors(found: FieldErrors, message: string) {
    setErrors(found);
    setSummary({ message, fields: Object.keys(found).length > 0 });
    setAttempt((n) => n + 1);
  }

  function autosave() {
    void queueSave(payloadOf(data)).then((result) => {
      if (result.ok || !result.fieldErrors) return;
      const target = stepOfPointer(steps, Object.keys(result.fieldErrors));
      if (target >= 0) moveTo(target);
      showErrors(result.fieldErrors, result.message);
    });
  }

  /** Changes step; the step body slides in from the direction of travel. */
  function moveTo(index: number) {
    setMotion(index > stepIndex ? 'forward' : index < stepIndex ? 'back' : null);
    setStepIndex(index);
  }

  function goTo(index: number) {
    setErrors({});
    setSummary(null);
    moveTo(index);
    setFurthest((f) => Math.max(f, index));
    if (index === reviewIndex) setReturnToReview(false);
    journey.current?.markStep(index, steps.length);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  function change(pointer: string, value: unknown) {
    const nextData = setAt(data, pointer, value);
    setData(nextData);
    if (!errors[pointer] || !schema) return;
    // Once flagged, a field clears as soon as its answer is valid ("reward early").
    const message = pointer === EVIDENCE ? undefined : fieldError(schema, pointer, nextData);
    setErrors((prev) => (message ? { ...prev, [pointer]: message } : withoutKey(prev, pointer)));
  }

  function blur(pointer: string) {
    if (!schema) return;
    const value = getAt(data, pointer);
    if (value === undefined || value === '') return;
    // A given answer is checked when the citizen leaves it, never while they are typing.
    const message = fieldError(schema, pointer, data);
    setErrors((prev) =>
      message ? { ...prev, [pointer]: message } : prev[pointer] ? withoutKey(prev, pointer) : prev,
    );
  }

  function applyEvidenceUpload(nextUpload: EvidenceUploadValue | null) {
    setEvidenceUpload(nextUpload);
    if (nextUpload?.technically_accepted) {
      // Pin the CMP-013 document id into the published evidence_file_name field (immutable schema).
      setData((prev) =>
        setAt(
          setAt(prev, EVIDENCE, nextUpload.document_id),
          EVIDENCE_MIME,
          nextUpload.content_type,
        ),
      );
      setErrors((prev) => withoutKey(prev, EVIDENCE));
    } else if (!nextUpload) {
      setData((prev) => setAt(setAt(prev, EVIDENCE, ''), EVIDENCE_MIME, undefined));
    }
  }

  function evidenceMissing(): FieldErrors {
    if (!hasEvidence || !visible.has('#/properties/evidence_file_name')) return {};
    if (evidenceUpload?.technically_accepted && evidenceUpload.document_id) return {};
    return {
      [EVIDENCE]: 'Upload a supporting document and wait until it is technically accepted',
    };
  }

  function errorsFor(index: number): FieldErrors {
    const target = steps[index];
    if (!schema || !target) return {};
    const found = stepErrors(schema, target.node, data, visible);
    return holdsEvidence(target) ? { ...found, ...evidenceMissing() } : found;
  }

  function next() {
    const found = errorsFor(stepIndex);
    if (Object.keys(found).length > 0) {
      showErrors(found, 'Check the highlighted answers before you continue');
      return;
    }
    let target = stepIndex + 1;
    if (returnToReview && reviewIndex > stepIndex) {
      const gap = steps.findIndex(
        (s, i) => i > stepIndex && i < reviewIndex && Object.keys(errorsFor(i)).length > 0,
      );
      target = gap >= 0 ? gap : reviewIndex;
    }
    goTo(target);
    autosave();
  }

  function back() {
    goTo(stepIndex - 1);
    autosave();
  }

  async function saveForLater() {
    setErrors({});
    setSummary(null);
    const result = await queueSave(payloadOf(data));
    if (!result.ok) {
      if (result.fieldErrors) {
        const target = stepOfPointer(steps, Object.keys(result.fieldErrors));
        if (target >= 0 && target !== stepIndex) moveTo(target);
        showErrors(result.fieldErrors, result.message);
      }
      return;
    }
    const ref = draftRef.current?.id.slice(0, 8).toUpperCase() ?? '';
    setNotice({
      tone: 'success',
      title: 'Saved',
      body: `Your application is saved (Ref ${ref}). You can close this page and continue later from My applications. It is not submitted yet.`,
      action: { href: '/certificates', label: 'Go to My applications' },
    });
  }

  async function submit() {
    if (!schema || !ui) return;
    for (let i = 0; i < steps.length; i += 1) {
      const found = errorsFor(i);
      if (Object.keys(found).length > 0) {
        setCheckedAll(true);
        if (i !== stepIndex) moveTo(i);
        showErrors(
          found,
          i === stepIndex
            ? 'Check the highlighted answers before you submit'
            : `Some answers in ${steps[i]?.label ?? 'an earlier step'} need attention before you submit`,
        );
        return;
      }
    }
    setBusy(true);
    setSummary(null);
    await saving.current;
    const payload = payloadOf(data);
    const submitStarted = performance.now();
    const res = await fetch('/api/portal/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': submissionKey.current },
      body: JSON.stringify({
        catalogue_id: catalogueId,
        data: payload,
        ...(draftRef.current ? { application_id: draftRef.current.id } : {}),
      }),
    }).catch(() => null);
    const body = (res ? await res.json().catch(() => ({})) : {}) as {
      message?: string;
      field?: string;
      field_errors?: { pointer: string; message: string }[];
      application?: { id: string };
      application_id?: string;
    };
    const submitMs = performance.now() - submitStarted;
    if (res?.ok && body.application) {
      journey.current?.markSubmit(submitMs, 'OK');
      journey.current?.markComplete();
      markJustSubmitted(body.application.id);
      router.push(`/certificates/${body.application.id}`);
      return;
    }
    if (res?.status === 409 && body.application_id) {
      journey.current?.markSubmit(submitMs, 'ERROR');
      router.push(`/certificates/${body.application_id}`);
      return;
    }
    setBusy(false);
    const outcome = res?.status === 422 || res?.status === 400 ? 'VALIDATION' : 'ERROR';
    journey.current?.markSubmit(submitMs, outcome);
    const fieldErrors: FieldErrors = {};
    for (const e of body.field_errors ?? []) fieldErrors[e.pointer] ??= e.message;
    if (body.field) fieldErrors[`/${body.field.replaceAll('.', '/')}`] = body.message ?? '';
    if (res?.status === 422 || res?.status === 400) submissionKey.current = newKey();
    const target = stepOfPointer(steps, Object.keys(fieldErrors));
    if (target >= 0) setCheckedAll(true);
    if (target >= 0 && target !== stepIndex) moveTo(target);
    showErrors(fieldErrors, body.message ?? 'We could not submit your application. Try again.');
  }

  /** Browsers only scroll a partly visible field on focus; lift it fully clear of the action bar. */
  function keepFocusClear(event: FocusEvent<HTMLFormElement>) {
    const bar = event.currentTarget.querySelector('.sf-wizard-actions');
    const target = event.target;
    if (!bar || !(target instanceof HTMLElement) || bar.contains(target)) return;
    const field = target.getBoundingClientRect();
    const hidden = field.bottom + FOCUS_GAP - bar.getBoundingClientRect().top;
    if (hidden <= 0) return;
    const top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    window.scrollBy(0, Math.max(0, Math.min(hidden, field.top - top)));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (isLast) void submit();
    else next();
  }

  const saveText =
    save.state === 'saving'
      ? 'Saving…'
      : save.state === 'saved'
        ? `Saved${timeOf(save.at) ? ` at ${timeOf(save.at)}` : ''}`
        : save.state === 'error'
          ? save.message
          : '';
  const primary = isLast
    ? busy
      ? 'Submitting…'
      : `Submit application (${citizenPolicyText(policy.fee)})`
    : returnToReview
      ? 'Save & return to preview'
      : 'Save & continue';
  const slots = hasEvidence
    ? {
        [EVIDENCE]: (
          <EvidenceUploadField
            inputId={fieldId(EVIDENCE)}
            label="Upload supporting evidence"
            hint="Required. PDF, PNG or JPEG up to 1 MB. Upload is a technical accept only — an officer still reviews it."
            value={evidenceUpload}
            onChange={applyEvidenceUpload}
            disabled={busy}
            error={errors[EVIDENCE]}
          />
        ),
        [EVIDENCE_MIME]: null,
      }
    : undefined;
  const display = hasEvidence
    ? {
        [EVIDENCE]: evidenceUpload?.technically_accepted
          ? evidenceUpload.file_name
          : 'Not uploaded yet',
        [EVIDENCE_MIME]: evidenceUpload?.technically_accepted
          ? fileKind(evidenceUpload.content_type)
          : null,
      }
    : undefined;
  const layoutProps = {
    schema,
    data,
    visible,
    isRequired: required,
    errors,
    notes,
    labels,
    onChange: change,
    onBlur: blur,
    slots,
  };
  // A prefilled evidence reference is not an upload: it counts only once CMP-013 accepted a file.
  const progress = formProgress(
    schema,
    steps,
    hasEvidence && !evidenceUpload?.technically_accepted ? setAt(data, EVIDENCE, undefined) : data,
    visible,
  );
  // Reached answer steps that no longer pass their checks are never shown as completed; after a
  // refused submit they are also flagged until fixed.
  const incomplete = steps.flatMap((s, i) =>
    !s.review && i !== stepIndex && Object.keys(errorsFor(i)).length > 0 ? [i] : [],
  );
  const attention = checkedAll ? incomplete : [];

  return (
    <div className="sf-wizard">
      <Ux4gFormStepper
        steps={steps.map((s) => ({ label: s.label, hint: s.hint }))}
        current={stepIndex}
        reachable={furthest}
        progress={progress}
        attention={attention}
        incomplete={incomplete}
        onSelect={(i) => {
          goTo(i);
          autosave();
        }}
      />

      <form
        className="sf-wizard-main"
        noValidate
        onSubmit={onSubmit}
        onFocus={keepFocusClear}
        aria-labelledby="sf-step-heading"
      >
        {notice ? (
          <div ref={noticeRef} tabIndex={-1} data-testid="apply-notice">
            <FormAlert tone={notice.tone} title={notice.title} action={notice.action}>
              {notice.body}
            </FormAlert>
          </div>
        ) : null}

        {summary && summary.fields && errorEntries.length > 0 ? (
          <ErrorSummary
            ref={summaryRef}
            items={errorEntries.map(([pointer, message]) => ({
              fieldId: fieldId(pointer),
              message,
            }))}
          />
        ) : summary && !summary.fields ? (
          <div ref={summaryRef} tabIndex={-1}>
            <FormAlert tone="error" title="Cannot continue">
              {summary.message}
            </FormAlert>
          </div>
        ) : null}

        <section className="sf-step-panel" aria-labelledby="sf-step-heading">
          <header className="sf-step-head">
            <h2 id="sf-step-heading" ref={headingRef} tabIndex={-1} className="sf-step-title">
              <span className="ux4g-label-l-strong sf-step-kicker">
                Step {stepIndex + 1} of {steps.length}
              </span>
              <span className="ux4g-heading-m-strong">{step.title}</span>
            </h2>
            <p className="ux4g-body-m-default sf-step-lead">
              {step.review
                ? 'Check every answer before you submit. Use Change to correct anything.'
                : step.hint}
            </p>
          </header>

          <div
            key={stepIndex}
            className={`sf-step-body${motion ? ` sf-step-enter-${motion}` : ''}`}
            data-testid="step-body"
          >
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
                  display={display}
                  onEdit={(i) => {
                    setReturnToReview(true);
                    goTo(i);
                  }}
                />
                <div className="sf-form-section">
                  <h3 className="ux4g-heading-xs-strong">Declaration</h3>
                  <Ux4gFormLayout node={step.node} {...layoutProps} />
                </div>
              </>
            ) : (
              <Ux4gFormLayout node={step.node} {...layoutProps} />
            )}
          </div>

          {stepIndex === 0 && !draft && !notice ? (
            <p className="ux4g-body-s-default sf-apply-trust" data-testid="apply-trust">
              <Icon name="shield" size={18} />
              <span>
                <strong>
                  {citizen.masked_mobile
                    ? `Signed in as ${citizen.masked_mobile} (OTP).`
                    : 'Signed in with OTP.'}
                </strong>{' '}
                {loaded.prefill_source === 'CMP-005'
                  ? 'Name and mobile are from your profile; the rest are samples.'
                  : 'Sample answers are filled in.'}{' '}
                Answers save as you go. Synthetic values only — sample lab.
              </span>
            </p>
          ) : null}

          <p className="ux4g-body-s-default sf-form-provenance">
            Checked by platform form rules · sample lab · form v{loaded.form.version}
          </p>
        </section>

        <div className="sf-wizard-actions">
          <div className="sf-wizard-actions-start">
            <div className="sf-save-state">
              <p
                className={`ux4g-body-s-default sf-save-status${save.state === 'saved' ? ' sf-save-status-saved' : save.state === 'error' ? ' sf-save-status-error' : ''}`}
                role="status"
                data-testid="save-status"
              >
                {save.state === 'saved' ? <Icon name="check-circle" size={16} /> : null}
                {save.state === 'error' ? <Icon name="alert" size={16} /> : null}
                {saveText}
              </p>
              {save.state === 'error' && save.retry ? (
                <Button variant="text-primary" size="s" onClick={autosave} disabled={busy}>
                  <Icon name="refresh" size={16} />
                  Try saving again
                </Button>
              ) : null}
            </div>
            <Button
              variant="text-primary"
              size="s"
              onClick={() => void saveForLater()}
              disabled={busy}
            >
              Save and come back later
            </Button>
          </div>
          <div className="sf-wizard-actions-end">
            {stepIndex > 0 ? (
              <Button variant="outline-neutral" onClick={back} disabled={busy}>
                <Icon name="arrow-left" size={18} />
                Back
              </Button>
            ) : null}
            <Button type="submit" disabled={busy}>
              {primary}
              {isLast ? null : <Icon name="arrow-right" size={18} />}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
