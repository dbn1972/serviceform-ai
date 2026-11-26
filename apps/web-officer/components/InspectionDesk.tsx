'use client';

import { Alert, Button, Card, Select, TextInput, TextLink } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  SAMPLE_LAB_INSPECTION_PINS,
  SAMPLE_LAB_VERIFICATION_RESULTS,
} from '@serviceform/m10-sample-lab/inspection-catalogue';
import { EmptyState } from './EmptyState';

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
          Schedule, start, and record non-statutory verification results for services that need a
          site check. For calendars, use the{' '}
          <Link href="/scheduling" className="ux4g-text-link-m">
            scheduling desk
          </Link>
          .
        </p>
      </section>

      {error ? (
        <Alert variant="error" title="Inspection desk">
          {error}{' '}
          {error.includes('Sign in') ? <TextLink href="/login">Sign in</TextLink> : null}
        </Alert>
      ) : null}

      <Card
        title="Request inspection"
        subtitle="Pick a published pin and an application id"
        footer={
          <Button
            disabled={busy || !applicationId.trim() || !pinCode}
            onClick={() => void createInspection()}
          >
            {busy ? 'Creating…' : 'Create request'}
          </Button>
        }
      >
        <div className="sf-form-stack">
          <Select
            id="pin-code"
            label="Inspection pin"
            value={pinCode}
            onChange={(e) => setPinCode(e.target.value)}
            options={SAMPLE_LAB_INSPECTION_PINS.map((p) => ({
              value: p.pin_code,
              label: `${p.label}${p.catalogue_id ? ` · ${p.catalogue_id}` : ' · generic'}`,
            }))}
          />
          <TextInput
            id="application-id"
            label="Application id"
            value={applicationId}
            onChange={(e) => setApplicationId(e.target.value)}
            placeholder="UUID"
            autoComplete="off"
          />
        </div>
      </Card>

      <Card title="Available queue">
        {items.length === 0 ? (
          <EmptyState
            title="No inspections in queue"
            icon="layers"
            actionLabel="Refresh"
            onAction={() => void load()}
            testId="inspection-empty"
          >
            No requested or scheduled inspections are in scope for your desks yet.
          </EmptyState>
        ) : (
          <ul className="sf-stack">
            {items.map((item) => (
              <li key={item.inspection_id}>
                <Button
                  variant="text-neutral"
                  size="s"
                  onClick={() => setSelected(item)}
                >
                  {item.pin_label ?? item.workflow_node_id ?? 'Inspection'} · {item.state_label}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected ? (
        <Card title={`${selected.pin_label ?? 'Inspection'} · ${selected.state_label}`}>
          <p className="ux4g-body-m-default">
            Application <code>{selected.application_id}</code>
            {selected.schedule_summary ? <> · {selected.schedule_summary}</> : null}
            {selected.verification_label ? (
              <>
                {' '}
                · result <strong>{selected.verification_label}</strong>
              </>
            ) : null}
          </p>

          {selected.can_schedule ? (
            <div className="sf-form-stack">
              <TextInput
                id="slot-ref"
                label="Slot ref"
                value={slotRef}
                onChange={(e) => setSlotRef(e.target.value)}
              />
              <TextInput
                id="location-ref"
                label="Location ref"
                value={locationRef}
                onChange={(e) => setLocationRef(e.target.value)}
              />
              <Button
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
              </Button>
            </div>
          ) : null}

          <div className="sf-actions">
            {selected.can_start ? (
              <Button variant="outline-primary" disabled={busy} onClick={() => void act('start')}>
                Start
              </Button>
            ) : null}
            {selected.can_cancel ? (
              <Button variant="outline-neutral" disabled={busy} onClick={() => void act('cancel')}>
                Cancel
              </Button>
            ) : null}
          </div>

          {selected.can_record_result ? (
            <div className="sf-form-stack">
              <Select
                id="result-code"
                label="Verification result (non-statutory)"
                value={resultCode}
                onChange={(e) => setResultCode(e.target.value)}
                options={SAMPLE_LAB_VERIFICATION_RESULTS.map((r) => ({
                  value: r.code,
                  label: r.label,
                }))}
              />
              <Button
                disabled={busy}
                onClick={() => void act('result', { verification_result: resultCode })}
              >
                Record result
              </Button>
            </div>
          ) : null}

          {selected.can_complete ? (
            <Button disabled={busy} onClick={() => void act('complete')}>
              Complete
            </Button>
          ) : null}

          {selected.workflow_node_id ? (
            <div className="sf-officer-tech">
              <details>
                <summary>Technical details</summary>
                <p className="ux4g-body-s-default">
                  Workflow node <code>{selected.workflow_node_id}</code>
                </p>
              </details>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
