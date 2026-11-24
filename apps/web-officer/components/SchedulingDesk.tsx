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
  can_reschedule: boolean;
  can_cancel: boolean;
  can_complete: boolean;
  can_no_show: boolean;
}

export function SchedulingDesk() {
  const [slots, setSlots] = useState<SlotCard[]>([]);
  const [selected, setSelected] = useState<AppointmentCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [participantRef, setParticipantRef] = useState('participant:sample-lab:case-1');
  const [rescheduleSlot, setRescheduleSlot] = useState('');

  const loadSlots = useCallback(async () => {
    setError(null);
    await fetch('/api/portal/appointments/catalogue', { method: 'POST', cache: 'no-store' }).catch(
      () => undefined,
    );
    const res = await fetch('/api/portal/appointments/slots', { cache: 'no-store' });
    if (res.status === 401) {
      setError('Sign in as a SAMPLE_LAB inspection or case officer to open scheduling.');
      return;
    }
    const body = (await res.json()) as { slots?: SlotCard[]; message?: string };
    if (!res.ok) {
      setError(body.message ?? 'Unable to load appointment slots');
      return;
    }
    setSlots(body.slots ?? []);
  }, []);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  async function book(slot: SlotCard) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slot_ref: slot.slot_ref,
          participant_ref: participantRef.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { message?: string; appointment?: AppointmentCard };
      if (!res.ok) {
        setError(body.message ?? 'Book refused');
        return;
      }
      if (body.appointment) setSelected(body.appointment);
      await loadSlots();
    } finally {
      setBusy(false);
    }
  }

  async function lookup() {
    const id = lookupId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/appointments/${id}`, { cache: 'no-store' });
      const body = (await res.json()) as { message?: string; appointment?: AppointmentCard };
      if (!res.ok) {
        setError(body.message ?? 'Lookup refused');
        return;
      }
      if (body.appointment) setSelected(body.appointment);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
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
      await loadSlots();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Scheduling desk</h1>
        <p className="ux4g-body-m-default">
          Book, reschedule, and close appointments from reusable CMP-056 calendar metadata — beside
          inspection verification. Opaque refs only · atomic capacity · notify failure does not
          cancel · COMPLETED can release WAIT_VERIFICATION without polling · CERTIFIED=false ·
          G6=false.
        </p>
        <p className="ux4g-body-m-default">
          <Link href="/inspection" className="ux4g-text-link-m">
            Open inspection desk
          </Link>{' '}
          for CMP-018 results after a site visit is booked. Citizens self-serve at the citizen
          portal Appointments desk.
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
                {t.related_inspection_pin ? (
                  <>
                    {' '}
                    · beside pin <code>{t.related_inspection_pin}</code>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="slots-heading">
        <h2 id="slots-heading" className="ux4g-heading-l-strong">
          Available slots
        </h2>
        <label className="ux4g-body-m-default" htmlFor="participant-ref">
          Participant ref (opaque)
          <input
            id="participant-ref"
            className="ux4g-input"
            value={participantRef}
            onChange={(e) => setParticipantRef(e.target.value)}
            autoComplete="off"
          />
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
                    className="ux4g-btn-primary ux4g-btn-m"
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

      <section aria-labelledby="lookup-heading">
        <h2 id="lookup-heading" className="ux4g-heading-l-strong">
          Look up appointment
        </h2>
        <label className="ux4g-body-m-default" htmlFor="appointment-id">
          Appointment id
          <input
            id="appointment-id"
            className="ux4g-input"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="UUID"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="ux4g-btn-outline-primary ux4g-btn-m"
          disabled={busy || !lookupId.trim()}
          onClick={() => void lookup()}
        >
          Load
        </button>
      </section>

      {selected ? (
        <section aria-labelledby="detail-heading">
          <h2 id="detail-heading" className="ux4g-heading-l-strong">
            {selected.type_label} · {selected.state_label}
          </h2>
          <p className="ux4g-body-m-default">
            <code>{selected.appointment_id}</code> · slot <code>{selected.slot_ref}</code> · notify{' '}
            {selected.notification_status}
            {selected.related_inspection_pin ? (
              <>
                {' '}
                · inspection pin <code>{selected.related_inspection_pin}</code>
              </>
            ) : null}
          </p>

          {selected.can_reschedule ? (
            <div className="sf-stack">
              <label className="ux4g-body-m-default" htmlFor="reschedule-slot">
                Reschedule to slot ref
                <select
                  id="reschedule-slot"
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
                className="ux4g-btn-primary ux4g-btn-m"
                disabled={busy || !rescheduleSlot}
                onClick={() => void act('reschedule', { slot_ref: rescheduleSlot })}
              >
                Reschedule
              </button>
            </div>
          ) : null}

          <div className="sf-actions">
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
            {selected.can_no_show ? (
              <button
                type="button"
                className="ux4g-btn-outline-primary ux4g-btn-m"
                disabled={busy}
                onClick={() => void act('no_show')}
              >
                Mark no-show
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
        </section>
      ) : null}
    </div>
  );
}
