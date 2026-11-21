'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SAMPLE_LAB_GRIEVANCE_ESCALATION } from '@serviceform/m10-sample-lab';

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
          Queue, assign by role (L1–L3 metadata), respond, resolve, or escalate. Fail-closed OPA ·
          no named officers · no LLM statutory decisions. SAMPLE_LAB · CERTIFIED=false · G6=false.
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

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="ux4g-heading-l-strong">
          Queue
        </h2>
        {items.length === 0 ? (
          <p className="ux4g-body-m-default">No open grievances.</p>
        ) : (
          <ul className="sf-stack">
            {items.map((g) => (
              <li key={g.grievance_id}>
                <button
                  type="button"
                  className="ux4g-btn-text-neutral"
                  onClick={() => setSelected(g)}
                >
                  {g.reference_code} · {g.status_label}
                  {g.category_code ? ` · ${g.category_code}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section aria-labelledby="ticket-heading">
          <h2 id="ticket-heading" className="ux4g-heading-l-strong">
            {selected.reference_code}
          </h2>
          <p className="ux4g-body-m-default">
            {selected.status_label}
            {selected.category_code ? ` · ${selected.category_code}` : ''}
            {selected.assignment_role_code ? ` · desk ${selected.assignment_role_code}` : ''}
          </p>
          {selected.application_id ? (
            <p className="ux4g-body-s-default">
              Linked case:{' '}
              <Link href={`/applications/${selected.application_id}`} className="ux4g-link">
                open application
              </Link>
            </p>
          ) : null}
          {(selected.can_respond || selected.can_escalate) && (
            <label className="ux4g-label">
              Response note (opaque SIMULATED ref)
              <textarea
                className="ux4g-textarea"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <div className="sf-actions">
            {selected.can_route ? (
              <button
                type="button"
                className="ux4g-btn-outline-primary"
                disabled={busy}
                onClick={() => void act('ROUTE')}
              >
                Route
              </button>
            ) : null}
            {selected.can_assign ? (
              <button
                type="button"
                className="ux4g-btn-fill-primary"
                disabled={busy}
                onClick={() => void act('ASSIGN')}
              >
                Assign L1 helpdesk
              </button>
            ) : null}
            {selected.can_respond ? (
              <button
                type="button"
                className="ux4g-btn-outline-primary"
                disabled={busy}
                onClick={() => void act('RESPOND')}
              >
                Record response
              </button>
            ) : null}
            {selected.can_escalate && selected.next_escalation_level ? (
              <button
                type="button"
                className="ux4g-btn-outline-warning"
                disabled={busy}
                onClick={() => void act('ESCALATE', { level: selected.next_escalation_level })}
              >
                Escalate to L{selected.next_escalation_level}
              </button>
            ) : null}
            {selected.can_resolve ? (
              <button
                type="button"
                className="ux4g-btn-fill-primary"
                disabled={busy}
                onClick={() => void act('RESOLVE')}
              >
                Resolve
              </button>
            ) : null}
            {selected.can_close ? (
              <button
                type="button"
                className="ux4g-btn-outline-neutral"
                disabled={busy}
                onClick={() => void act('CLOSE')}
              >
                Close
              </button>
            ) : null}
          </div>
          <p className="ux4g-body-s-default">
            Desk ladder:{' '}
            {SAMPLE_LAB_GRIEVANCE_ESCALATION.map((e) => e.role_code).join(' → ')}
          </p>
        </section>
      ) : null}
    </div>
  );
}
