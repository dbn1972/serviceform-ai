'use client';

import { Alert, Button, Card, TextLink } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SAMPLE_LAB_GRIEVANCE_ESCALATION } from '@serviceform/m10-sample-lab/grievance-catalogue';
import { DESK_LABELS } from '../lib/portal/desk';
import { EmptyState } from './EmptyState';

interface Ticket {
  grievance_id: string;
  reference_code: string;
  status: string;
  status_label: string;
  category_code: string | null;
  application_id: string | null;
  can_route: boolean;
  can_assign: boolean;
  can_respond: boolean;
  can_resolve: boolean;
  can_close: boolean;
  can_escalate: boolean;
  next_escalation_level: number | null;
  assignment_role_code: string | null;
}

export function HelpdeskDesk() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/portal/grievances', { cache: 'no-store' });
    if (res.status === 401) {
      setError('Sign in as a SAMPLE_LAB case officer to open the helpdesk.');
      return;
    }
    const body = (await res.json()) as { grievances?: Ticket[]; message?: string };
    if (!res.ok) {
      setError(body.message ?? 'Unable to load helpdesk queue');
      return;
    }
    setItems(body.grievances ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/grievances/${selected.grievance_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note, ...extra }),
      });
      const body = (await res.json()) as { message?: string; grievance?: Ticket };
      if (!res.ok) {
        setError(body.message ?? 'Action refused');
        return;
      }
      if (body.grievance) setSelected(body.grievance);
      setNote('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Helpdesk</h1>
        <p className="ux4g-body-m-default">
          Queue, assign by desk role (L1–L3), respond, resolve, or escalate. Not a statutory appeal
          court.
        </p>
      </section>

      {error ? (
        <Alert variant="error" title="Helpdesk">
          {error} {error.includes('Sign in') ? <TextLink href="/login">Sign in</TextLink> : null}
        </Alert>
      ) : null}

      <Card title="Queue">
        {items.length === 0 ? (
          <EmptyState
            title="No open grievances"
            icon="message"
            actionLabel="Refresh"
            onAction={() => void load()}
            testId="helpdesk-empty"
          >
            Citizen-raised tickets linked to applications appear here when they are open.
          </EmptyState>
        ) : (
          <ul className="sf-stack">
            {items.map((g) => (
              <li key={g.grievance_id}>
                <Button variant="text-neutral" size="s" onClick={() => setSelected(g)}>
                  {g.reference_code} · {g.status_label}
                  {g.category_code ? ` · ${g.category_code}` : ''}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected ? (
        <Card title={selected.reference_code}>
          <p className="ux4g-body-m-default">
            {selected.status_label}
            {selected.category_code ? ` · ${selected.category_code}` : ''}
            {selected.assignment_role_code
              ? ` · ${DESK_LABELS[selected.assignment_role_code] ?? selected.assignment_role_code}`
              : ''}
          </p>
          {selected.application_id ? (
            <p className="ux4g-body-s-default">
              Linked case:{' '}
              <Link href={`/applications/${selected.application_id}`} className="ux4g-text-link-m">
                open application
              </Link>
            </p>
          ) : null}
          {(selected.can_respond || selected.can_escalate) && (
            <label
              className="ux4g-input-container ux4g-input-m ux4g-input-default"
              htmlFor="helpdesk-note"
            >
              <span className="ux4g-label-m-default">Response note</span>
              <div className="ux4g-input">
                <textarea
                  id="helpdesk-note"
                  className="ux4g-input-input"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Opaque simulated reference"
                />
              </div>
            </label>
          )}
          <div className="sf-actions">
            {selected.can_route ? (
              <Button variant="outline-primary" disabled={busy} onClick={() => void act('ROUTE')}>
                Route
              </Button>
            ) : null}
            {selected.can_assign ? (
              <Button disabled={busy} onClick={() => void act('ASSIGN')}>
                Assign L1 helpdesk
              </Button>
            ) : null}
            {selected.can_respond ? (
              <Button variant="outline-primary" disabled={busy} onClick={() => void act('RESPOND')}>
                Record response
              </Button>
            ) : null}
            {selected.can_escalate && selected.next_escalation_level ? (
              <Button
                variant="outline-neutral"
                disabled={busy}
                onClick={() => void act('ESCALATE', { level: selected.next_escalation_level })}
              >
                Escalate to L{selected.next_escalation_level}
              </Button>
            ) : null}
            {selected.can_resolve ? (
              <Button disabled={busy} onClick={() => void act('RESOLVE')}>
                Resolve
              </Button>
            ) : null}
            {selected.can_close ? (
              <Button variant="outline-neutral" disabled={busy} onClick={() => void act('CLOSE')}>
                Close
              </Button>
            ) : null}
          </div>
          <p className="ux4g-body-s-default">
            Desk ladder:{' '}
            {SAMPLE_LAB_GRIEVANCE_ESCALATION.map(
              (e) => DESK_LABELS[e.role_code] ?? e.role_code,
            ).join(' → ')}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
