'use client';

import { Alert, Button, Card, Select, TextInput, TextLink } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SAMPLE_LAB_APPOINTMENT_TYPES } from '@serviceform/m10-sample-lab/appointment-catalogue';
import { EmptyState } from './EmptyState';

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
          Book, reschedule, and close appointments from reusable calendar metadata — beside
          inspection verification.{' '}
          <Link href="/inspection" className="ux4g-text-link-m">
            Open inspection desk
          </Link>{' '}
          for site-visit results.
        </p>
      </section>

      {error ? (
        <Alert variant="error" title="Scheduling desk">
          {error}{' '}
          {error.includes('Sign in') ? <TextLink href="/login">Sign in</TextLink> : null}
        </Alert>
      ) : null}

      <Card title="Appointment types" subtitle="Published sample lab metadata — not statute calendars">
        <ul className="sf-stack">
          {SAMPLE_LAB_APPOINTMENT_TYPES.map((t) => (
            <li key={t.appointment_type_ref}>
              <span className="ux4g-body-m-default">
                <strong>{t.label}</strong>
                {t.related_inspection_pin ? (
                  <> · beside inspection pin {t.related_inspection_pin}</>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Available slots">
        <div className="sf-form-stack">
          <TextInput
            id="participant-ref"
            label="Participant ref"
            value={participantRef}
            onChange={(e) => setParticipantRef(e.target.value)}
            autoComplete="off"
            hint="Opaque reference only — no PII."
          />
          {slots.length === 0 ? (
            <EmptyState
              title="No open slots"
              icon="clock"
              actionLabel="Refresh slots"
              onAction={() => void loadSlots()}
              testId="scheduling-empty"
            >
              No open slots with remaining capacity. Refresh after seeding the lab calendar.
            </EmptyState>
          ) : (
            <ul className="sf-stack">
              {slots.map((slot) => (
                <li key={slot.slot_id}>
                  <Card
                    title={slot.label}
                    subtitle={`${slot.type_label ?? 'Appointment'} · remaining ${slot.remaining}/${slot.capacity}`}
                    footer={
                      <Button disabled={busy || !slot.can_book} onClick={() => void book(slot)}>
                        Book slot
                      </Button>
                    }
                  >
                    <p className="ux4g-body-s-default">Opens {slot.opens_at}</p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card
        title="Look up appointment"
        footer={
          <Button
            variant="outline-primary"
            disabled={busy || !lookupId.trim()}
            onClick={() => void lookup()}
          >
            Load
          </Button>
        }
      >
        <TextInput
          id="appointment-id"
          label="Appointment id"
          value={lookupId}
          onChange={(e) => setLookupId(e.target.value)}
          placeholder="UUID"
          autoComplete="off"
        />
      </Card>

      {selected ? (
        <Card title={`${selected.type_label} · ${selected.state_label}`}>
          <p className="ux4g-body-m-default">
            Notify {selected.notification_status}
            {selected.related_inspection_pin ? (
              <> · inspection pin {selected.related_inspection_pin}</>
            ) : null}
          </p>

          {selected.can_reschedule ? (
            <div className="sf-form-stack">
              <Select
                id="reschedule-slot"
                label="Reschedule to slot"
                value={rescheduleSlot}
                onChange={(e) => setRescheduleSlot(e.target.value)}
                placeholder="Select open slot"
                options={slots
                  .filter((s) => s.can_book && s.slot_ref !== selected.slot_ref)
                  .map((s) => ({
                    value: s.slot_ref,
                    label: `${s.label} · ${s.slot_ref}`,
                  }))}
              />
              <Button
                disabled={busy || !rescheduleSlot}
                onClick={() => void act('reschedule', { slot_ref: rescheduleSlot })}
              >
                Reschedule
              </Button>
            </div>
          ) : null}

          <div className="sf-actions">
            {selected.can_complete ? (
              <Button disabled={busy} onClick={() => void act('complete')}>
                Complete
              </Button>
            ) : null}
            {selected.can_no_show ? (
              <Button variant="outline-primary" disabled={busy} onClick={() => void act('no_show')}>
                Mark no-show
              </Button>
            ) : null}
            {selected.can_cancel ? (
              <Button variant="outline-neutral" disabled={busy} onClick={() => void act('cancel')}>
                Cancel
              </Button>
            ) : null}
          </div>

          <div className="sf-officer-tech">
            <details>
              <summary>Technical details</summary>
              <p className="ux4g-body-s-default">
                <code>{selected.appointment_id}</code> · slot <code>{selected.slot_ref}</code>
              </p>
            </details>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
