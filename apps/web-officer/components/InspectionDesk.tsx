'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  SAMPLE_LAB_INSPECTION_PINS,
  SAMPLE_LAB_VERIFICATION_RESULTS,
} from '@serviceform/m10-sample-lab/inspection-catalogue';

interface InspectionCard {
  inspection_id: string;
  application_id: string;
  workflow_node_id: string | null;
  inspection_state: string;
  state_label: string;
  verification_result: string | null;
  verification_label: string | null;
  pin_label: string | null;
  can_schedule: boolean;
  can_start: boolean;
  can_record_result: boolean;
  can_complete: boolean;
  can_cancel: boolean;
  schedule_summary: string | null;
}

export function InspectionDesk() {
  const [items, setItems] = useState<InspectionCard[]>([]);
  const [selected, setSelected] = useState<InspectionCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applicationId, setApplicationId] = useState('');
  const [pinCode, setPinCode] = useState(SAMPLE_LAB_INSPECTION_PINS[0]?.pin_code ?? '');
  const [slotRef, setSlotRef] = useState('lab-slot:morning');
  const [locationRef, setLocationRef] = useState('lab-loc:site-1');
  const [resultCode, setResultCode] = useState('VERIFIED');

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/portal/inspections', { cache: 'no-store' });
    if (res.status === 401) {
      setError('Sign in as a SAMPLE_LAB inspection or case officer to open this desk.');
      return;
    }
    const body = (await res.json()) as { inspections?: InspectionCard[]; message?: string };
    if (!res.ok) {
      setError(body.message ?? 'Unable to load inspection queue');
      return;
    }
    setItems(body.inspections ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInspection() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/inspections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ application_id: applicationId.trim(), pin_code: pinCode }),
      });
      const body = (await res.json()) as { message?: string; inspection?: InspectionCard };
      if (!res.ok) {
        setError(body.message ?? 'Create refused');
        return;
      }
      if (body.inspection) setSelected(body.inspection);
      setApplicationId('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/inspections/${selected.inspection_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = (await res.json()) as { message?: string; inspection?: InspectionCard };
      if (!res.ok) {
        setError(body.message ?? 'Action refused');
        return;
      }
      if (body.inspection) setSelected(body.inspection);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Inspection desk</h1>
        <p className="ux4g-body-m-default">
          Schedule, start, and record non-statutory verification results (including deficiency
          noted) for services that pin inspection nodes. Metadata-driven · no service forks · fail-
          closed OPA · CERTIFIED=false · G6=false.
        </p>
        <p className="ux4g-body-m-default">
          For departmental capacity calendars, use the{' '}
          <Link href="/scheduling" className="ux4g-text-link-m">
            scheduling desk
          </Link>{' '}
          (CMP-056 · Constitution #37).
        </p>
      </section>

      {error ? (
        <p className="ux4g-body-m-default" role="alert">
          {error}{' '}
          {error.includes('Sign in') ? (
            <Link href="/login" className="ux4g-text-link-m">
              Sign in
            </Link>
          ) : null}
        </p>
      ) : null}

      <section aria-labelledby="request-heading">
        <h2 id="request-heading" className="ux4g-heading-l-strong">
          Request inspection
        </h2>
        <p className="ux4g-body-m-default">
          Pick a published pin and an application id. Assignment uses role_code metadata only.
        </p>
        <div className="sf-stack">
          <label className="ux4g-body-m-default" htmlFor="pin-code">
            Inspection pin
            <select
              id="pin-code"
              className="ux4g-select"
              value={pinCode}
              onChange={(e) => setPinCode(e.target.value)}
            >
              {SAMPLE_LAB_INSPECTION_PINS.map((p) => (
                <option key={p.pin_code} value={p.pin_code}>
                  {p.label}
                  {p.catalogue_id ? ` · ${p.catalogue_id}` : ' · generic'}
                </option>
              ))}
            </select>
          </label>
          <label className="ux4g-body-m-default" htmlFor="application-id">
            Application id
            <input
              id="application-id"
              className="ux4g-input"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              placeholder="UUID"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="ux4g-btn-primary ux4g-btn-m"
            disabled={busy || !applicationId.trim() || !pinCode}
            onClick={() => void createInspection()}
          >
            Create request
          </button>
        </div>
      </section>

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="ux4g-heading-l-strong">
          Available queue
        </h2>
        {items.length === 0 ? (
          <p className="ux4g-body-m-default">No REQUESTED/SCHEDULED inspections in scope.</p>
        ) : (
          <ul className="sf-stack">
            {items.map((item) => (
              <li key={item.inspection_id}>
                <button
                  type="button"
                  className="ux4g-btn-text-neutral ux4g-btn-s"
                  onClick={() => setSelected(item)}
                >
                  {item.pin_label ?? item.workflow_node_id ?? 'Inspection'} · {item.state_label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section aria-labelledby="detail-heading">
          <h2 id="detail-heading" className="ux4g-heading-l-strong">
            {selected.pin_label ?? 'Inspection'} · {selected.state_label}
          </h2>
          <p className="ux4g-body-m-default">
            Application <code>{selected.application_id}</code>
            {selected.workflow_node_id ? (
              <>
                {' '}
                · node <code>{selected.workflow_node_id}</code>
              </>
            ) : null}
            {selected.schedule_summary ? <> · {selected.schedule_summary}</> : null}
            {selected.verification_label ? (
              <>
                {' '}
                · result <strong>{selected.verification_label}</strong>
              </>
            ) : null}
          </p>

          {selected.can_schedule ? (
            <div className="sf-stack">
              <label className="ux4g-body-m-default" htmlFor="slot-ref">
                Slot ref
                <input
                  id="slot-ref"
                  className="ux4g-input"
                  value={slotRef}
                  onChange={(e) => setSlotRef(e.target.value)}
                />
              </label>
              <label className="ux4g-body-m-default" htmlFor="location-ref">
                Location ref
                <input
                  id="location-ref"
                  className="ux4g-input"
                  value={locationRef}
                  onChange={(e) => setLocationRef(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="ux4g-btn-primary ux4g-btn-m"
                disabled={busy}
                onClick={() =>
                  void act('schedule', {
                    slot_ref: slotRef,
                    location_ref: locationRef,
                    timezone_iana: 'Asia/Kolkata',
                  })
                }
              >
                Schedule
              </button>
            </div>
          ) : null}

          <div className="sf-actions">
            {selected.can_start ? (
              <button
                type="button"
                className="ux4g-btn-outline-primary ux4g-btn-m"
                disabled={busy}
                onClick={() => void act('start')}
              >
                Start
              </button>
            ) : null}
            {selected.can_cancel ? (
              <button
                type="button"
                className="ux4g-btn-outline-neutral ux4g-btn-m"
                disabled={busy}
                onClick={() => void act('cancel')}
              >
                Cancel
              </button>
            ) : null}
          </div>

          {selected.can_record_result ? (
            <div className="sf-stack">
              <label className="ux4g-body-m-default" htmlFor="result-code">
                Verification result (non-statutory)
                <select
                  id="result-code"
                  className="ux4g-select"
                  value={resultCode}
                  onChange={(e) => setResultCode(e.target.value)}
                >
                  {SAMPLE_LAB_VERIFICATION_RESULTS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ux4g-btn-primary ux4g-btn-m"
                disabled={busy}
                onClick={() => void act('result', { verification_result: resultCode })}
              >
                Record result
              </button>
            </div>
          ) : null}

          {selected.can_complete ? (
            <button
              type="button"
              className="ux4g-btn-primary ux4g-btn-m"
              disabled={busy}
              onClick={() => void act('complete')}
            >
              Complete
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
