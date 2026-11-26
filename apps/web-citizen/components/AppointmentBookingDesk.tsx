'use client';

import { Button, Icon, Select } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SAMPLE_LAB_APPOINTMENT_TYPES } from '@serviceform/m10-sample-lab/appointment-catalogue';
import { FormAlert } from './FormFeedback';

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

  const applicationOptions = useMemo(
    () =>
      apps.map((a) => ({
        value: a.application_id,
        label: `${a.catalogue_id ?? 'Application'} · ${a.status ?? 'open'} · ${a.application_id.slice(0, 8)}…`,
      })),
    [apps],
  );

  const rescheduleOptions = useMemo(() => {
    if (!selected) return [];
    return slots
      .filter((s) => s.can_book && s.slot_ref !== selected.slot_ref)
      .map((s) => ({ value: s.slot_ref, label: `${s.label} · ${s.type_label ?? 'Appointment'}` }));
  }, [slots, selected]);

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
          Choose an open slot, optionally link it to an application, and manage reschedule or cancel
          from My appointments.
        </p>
      </section>

      <FormAlert tone="info" title="Sample lab environment">
        Appointment types and capacity are SAMPLE_LAB calendar metadata — not production statute
        calendars.
      </FormAlert>

      {error ? (
        <FormAlert tone="error">
          {error}{' '}
          {error.includes('Sign in') ? (
            <Link href="/login" className="ux4g-text-link-m">
              Sign in
            </Link>
          ) : null}
        </FormAlert>
      ) : null}

      <section aria-labelledby="types-heading">
        <h2 id="types-heading" className="ux4g-heading-l-strong">
          Appointment types
        </h2>
        <ul className="sf-stack">
          {SAMPLE_LAB_APPOINTMENT_TYPES.map((t) => (
            <li key={t.appointment_type_ref}>
              <span className="ux4g-body-m-default">
                <strong>{t.label}</strong>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {waitBindings.length > 0 ? (
        <section aria-labelledby="wait-heading">
          <h2 id="wait-heading" className="ux4g-heading-l-strong">
            Linked case waits
          </h2>
          <p className="ux4g-body-m-default">
            When a linked application is waiting and the appointment completes, the case can advance
            automatically.
          </p>
          <ul className="sf-stack">
            {waitBindings.map((b) => (
              <li key={b.binding_id}>
                <span className="ux4g-body-m-default">{b.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="slots-heading">
        <h2 id="slots-heading" className="ux4g-heading-l-strong">
          Available slots
        </h2>
        <Select
          id="application-link"
          label="Link to my application"
          optional
          hint="Optional — links the booking so a waiting case can continue when the appointment finishes."
          value={applicationId}
          options={applicationOptions}
          placeholder="No application link"
          onChange={(e) => setApplicationId(e.target.value)}
        />
        {slots.length === 0 ? (
          <section className="sf-empty" aria-labelledby="slots-empty">
            <span className="sf-service-mark">
              <Icon name="clock" size={24} />
            </span>
            <h3 id="slots-empty" className="ux4g-heading-s-strong">
              No open slots right now
            </h3>
            <p className="ux4g-body-m-default">Check again later when capacity is published.</p>
          </section>
        ) : (
          <ul className="sf-catalogue-grid" aria-label="Open appointment slots">
            {slots.map((slot) => (
              <li key={slot.slot_id}>
                <article className="sf-template-card">
                  <h3 className="ux4g-heading-s-strong">{slot.label}</h3>
                  <p className="ux4g-body-s-default">
                    {slot.type_label ?? 'Appointment'} · {slot.remaining} of {slot.capacity} left
                  </p>
                  <p className="ux4g-body-s-default">Opens {slot.opens_at}</p>
                  <div className="sf-template-card-foot">
                    <Button
                      type="button"
                      size="s"
                      disabled={busy || !slot.can_book}
                      onClick={() => void book(slot)}
                    >
                      Book slot
                    </Button>
                  </div>
                </article>
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
          <section className="sf-empty" aria-labelledby="appointments-empty">
            <span className="sf-service-mark">
              <Icon name="clock" size={24} />
            </span>
            <h3 id="appointments-empty" className="ux4g-heading-s-strong">
              You have no appointments yet
            </h3>
            <p className="ux4g-body-m-default">Book an open slot above to see it listed here.</p>
          </section>
        ) : (
          <ul className="sf-stack">
            {mine.map((a) => (
              <li key={a.appointment_id}>
                <Button
                  type="button"
                  variant="outline-primary"
                  disabled={busy}
                  onClick={() => setSelected(a)}
                >
                  {a.type_label} · {a.state_label}
                </Button>
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
            Slot {selected.slot_ref}
            {selected.application_id ? ' · linked to an application' : ''}
          </p>
          {selected.wait_bindings.length > 0 ? (
            <p className="ux4g-body-m-default">
              Linked waits: {selected.wait_bindings.map((b) => b.label).join(', ')}
            </p>
          ) : null}

          {selected.can_reschedule ? (
            <div className="sf-stack">
              <Select
                id="citizen-reschedule-slot"
                label="Reschedule to slot"
                value={rescheduleSlot}
                options={rescheduleOptions}
                placeholder="Select open slot"
                onChange={(e) => setRescheduleSlot(e.target.value)}
              />
              <Button
                type="button"
                disabled={busy || !rescheduleSlot}
                onClick={() => void act('reschedule', { slot_ref: rescheduleSlot })}
              >
                Reschedule
              </Button>
            </div>
          ) : null}

          {selected.can_cancel ? (
            <div className="sf-actions">
              <Button
                type="button"
                variant="outline-neutral"
                disabled={busy}
                onClick={() => void act('cancel')}
              >
                Cancel appointment
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
