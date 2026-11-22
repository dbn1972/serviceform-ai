'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SAMPLE_LAB_APPOINTMENT_TYPES } from '@serviceform/m10-sample-lab/appointment-catalogue';

interface SlotCard {
  slot_id: string;
  slot_ref: string;
  appointment_type_id: string;
  appointment_type_ref: string | null;
  type_label: string | null;
  capacity: number;
  remaining: number;
  opens_at: string;
  closes_at: string;
  label: string;
  can_book: boolean;
}

interface AppointmentCard {
  appointment_id: string;
  appointment_type_ref: string;
  type_label: string;
  lifecycle_status: string;
  state_label: string;
  slot_ref: string;
  appointment_version: number;
  notification_status: string;
  participant_ref: string | null;
  related_inspection_pin: string | null;
  application_id: string | null;
  can_reschedule: boolean;
  can_cancel: boolean;
  wait_bindings: { binding_id: string; label: string; workflow_wait_node_id: string }[];
}

interface ApplicationOption {
  application_id: string;
  catalogue_id?: string;
  status?: string;
}

interface WaitBinding {
  binding_id: string;
  label: string;
  appointment_type_ref: string;
  on_lifecycle_status: string;
  workflow_wait_node_id: string;
  case_command: string;
}

export function AppointmentBookingDesk() {
  const [slots, setSlots] = useState<SlotCard[]>([]);
  const [mine, setMine] = useState<AppointmentCard[]>([]);
  const [apps, setApps] = useState<ApplicationOption[]>([]);
  const [waitBindings, setWaitBindings] = useState<WaitBinding[]>([]);
  const [selected, setSelected] = useState<AppointmentCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applicationId, setApplicationId] = useState('');
  const [rescheduleSlot, setRescheduleSlot] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const [slotsRes, mineRes, appsRes] = await Promise.all([
      fetch('/api/portal/appointments/slots', { cache: 'no-store' }),
      fetch('/api/portal/appointments', { cache: 'no-store' }),
      fetch('/api/portal/applications', { cache: 'no-store' }),
    ]);
    if (slotsRes.status === 401 || mineRes.status === 401) {
      setError('Sign in to book or manage appointments.');
      return;
    }
    const slotsBody = (await slotsRes.json()) as { slots?: SlotCard[]; message?: string };
    if (!slotsRes.ok) {
      setError(slotsBody.message ?? 'Unable to load appointment slots');
      return;
    }
    setSlots(slotsBody.slots ?? []);

    const mineBody = (await mineRes.json()) as {
      appointments?: AppointmentCard[];
      wait_bindings?: WaitBinding[];
      message?: string;
    };
    if (!mineRes.ok) {
      setError(mineBody.message ?? 'Unable to load your appointments');
      return;
    }
    setMine(mineBody.appointments ?? []);
    setWaitBindings(mineBody.wait_bindings ?? []);

    if (appsRes.ok) {
      const appsBody = (await appsRes.json()) as { applications?: ApplicationOption[] };
      setApps(appsBody.applications ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function book(slot: SlotCard) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slot_ref: slot.slot_ref,
          ...(applicationId ? { application_id: applicationId } : {}),
        }),
      });
      const body = (await res.json()) as { message?: string; appointment?: AppointmentCard };
      if (!res.ok) {
        setError(body.message ?? 'Book refused');
        return;
      }
      if (body.appointment) setSelected(body.appointment);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'reschedule' | 'cancel', extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/appointments/${selected.appointment_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          expected_version: selected.appointment_version,
          ...extra,
        }),
      });
      const body = (await res.json()) as { message?: string; appointment?: AppointmentCard };
      if (!res.ok) {
        setError(body.message ?? 'Action refused');
        return;
      }
      if (body.appointment) setSelected(body.appointment);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Book an appointment</h1>
        <p className="ux4g-body-m-default">
          Self-serve booking from reusable CMP-056 calendar metadata. Opaque refs only · atomic
          capacity · notify failure does not cancel · workflow wait releases without polling ·
          CERTIFIED=false · G6=false.
        </p>
      </section>

      {error ? (
        <p className="ux4g-body-m-default" role="alert">
          {error}{' '}
          {error.includes('Sign in') ? (
            <Link href="/login" className="ux4g-link">
              Sign in
            </Link>
          ) : null}
        </p>
      ) : null}

      <section aria-labelledby="types-heading">
        <h2 id="types-heading" className="ux4g-heading-l-strong">
          Appointment types
        </h2>
        <p className="ux4g-body-m-default">
          Published SAMPLE_LAB metadata pins — not statute calendars.
        </p>
        <ul className="sf-stack">
          {SAMPLE_LAB_APPOINTMENT_TYPES.map((t) => (
            <li key={t.appointment_type_ref}>
              <span className="ux4g-body-m-default">
                <strong>{t.label}</strong> · <code>{t.appointment_type_ref}</code>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {waitBindings.length > 0 ? (
        <section aria-labelledby="wait-heading">
          <h2 id="wait-heading" className="ux4g-heading-l-strong">
            Workflow wait bindings
          </h2>
          <p className="ux4g-body-m-default">
            When a linked application is waiting and the appointment completes, the case advances
            without polling.
          </p>
          <ul className="sf-stack">
            {waitBindings.map((b) => (
              <li key={b.binding_id}>
                <span className="ux4g-body-m-default">
                  {b.label} · <code>{b.workflow_wait_node_id}</code> on {b.on_lifecycle_status} →{' '}
                  <code>{b.case_command}</code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="slots-heading">
        <h2 id="slots-heading" className="ux4g-heading-l-strong">
          Available slots
        </h2>
        <label className="ux4g-body-m-default" htmlFor="application-link">
          Link to my application (optional — enables wait release)
          <select
            id="application-link"
            className="ux4g-select"
            value={applicationId}
            onChange={(e) => setApplicationId(e.target.value)}
          >
            <option value="">No application link</option>
            {apps.map((a) => (
              <option key={a.application_id} value={a.application_id}>
                {a.catalogue_id ?? 'Application'} · {a.status ?? 'open'} ·{' '}
                {a.application_id.slice(0, 8)}…
              </option>
            ))}
          </select>
        </label>
        {slots.length === 0 ? (
          <p className="ux4g-body-m-default">No open slots with remaining capacity.</p>
        ) : (
          <ul className="sf-stack">
            {slots.map((slot) => (
              <li key={slot.slot_id}>
                <div className="sf-stack">
                  <p className="ux4g-body-m-default">
                    {slot.label} · {slot.type_label ?? 'Appointment'} · remaining {slot.remaining}/
                    {slot.capacity}
                    <br />
                    <code>{slot.slot_ref}</code> · opens {slot.opens_at}
                  </p>
                  <button
                    type="button"
                    className="ux4g-btn-fill-primary"
                    disabled={busy || !slot.can_book}
                    onClick={() => void book(slot)}
                  >
                    Book slot
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mine-heading">
        <h2 id="mine-heading" className="ux4g-heading-l-strong">
          My appointments
        </h2>
        {mine.length === 0 ? (
          <p className="ux4g-body-m-default">You have no appointments yet.</p>
        ) : (
          <ul className="sf-stack">
            {mine.map((a) => (
              <li key={a.appointment_id}>
                <button
                  type="button"
                  className="ux4g-btn-outline-primary"
                  disabled={busy}
                  onClick={() => setSelected(a)}
                >
                  {a.type_label} · {a.state_label} · {a.slot_ref}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section aria-labelledby="detail-heading">
          <h2 id="detail-heading" className="ux4g-heading-l-strong">
            {selected.type_label} · {selected.state_label}
          </h2>
          <p className="ux4g-body-m-default">
            <code>{selected.appointment_id}</code> · slot <code>{selected.slot_ref}</code> · notify{' '}
            {selected.notification_status}
            {selected.application_id ? (
              <>
                {' '}
                · application <code>{selected.application_id}</code>
              </>
            ) : null}
          </p>
          {selected.wait_bindings.length > 0 ? (
            <p className="ux4g-body-m-default">
              Wait binding: {selected.wait_bindings.map((b) => b.workflow_wait_node_id).join(', ')}
            </p>
          ) : null}

          {selected.can_reschedule ? (
            <div className="sf-stack">
              <label className="ux4g-body-m-default" htmlFor="citizen-reschedule-slot">
                Reschedule to slot
                <select
                  id="citizen-reschedule-slot"
                  className="ux4g-select"
                  value={rescheduleSlot}
                  onChange={(e) => setRescheduleSlot(e.target.value)}
                >
                  <option value="">Select open slot</option>
                  {slots
                    .filter((s) => s.can_book && s.slot_ref !== selected.slot_ref)
                    .map((s) => (
                      <option key={s.slot_id} value={s.slot_ref}>
                        {s.label} · {s.slot_ref}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="ux4g-btn-fill-primary"
                disabled={busy || !rescheduleSlot}
                onClick={() => void act('reschedule', { slot_ref: rescheduleSlot })}
              >
                Reschedule
              </button>
            </div>
          ) : null}

          {selected.can_cancel ? (
            <div className="sf-actions">
              <button
                type="button"
                className="ux4g-btn-outline-neutral"
                disabled={busy}
                onClick={() => void act('cancel')}
              >
                Cancel appointment
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
