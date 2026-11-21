'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SAMPLE_LAB_GRIEVANCE_CATEGORIES } from '@serviceform/m10-sample-lab/grievance-catalogue';

interface PortalGrievance {
  grievance_id: string;
  reference_code: string;
  status: string;
  status_label: string;
  category_code: string | null;
  category_label: string | null;
  application_id: string | null;
  can_withdraw: boolean;
  can_respond: boolean;
  can_request_escalation: boolean;
}

interface ApplicationOption {
  application_id: string;
  catalogue_id?: string;
  status?: string;
}

export function GrievanceDesk() {
  const [items, setItems] = useState<PortalGrievance[]>([]);
  const [apps, setApps] = useState<ApplicationOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<string>('CASE');
  const [applicationId, setApplicationId] = useState('');
  const [selected, setSelected] = useState<PortalGrievance | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const [gRes, aRes] = await Promise.all([
      fetch('/api/portal/grievances', { cache: 'no-store' }),
      fetch('/api/portal/applications', { cache: 'no-store' }),
    ]);
    if (gRes.status === 401) {
      setError('Sign in to raise or track grievances.');
      return;
    }
    const gBody = (await gRes.json()) as {
      grievances?: PortalGrievance[];
      message?: string;
    };
    if (!gRes.ok) {
      setError(gBody.message ?? 'Unable to load grievances');
      return;
    }
    setItems(gBody.grievances ?? []);
    if (aRes.ok) {
      const aBody = (await aRes.json()) as { applications?: ApplicationOption[] };
      setApps(aBody.applications ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function raise(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/grievances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category_code: category, application_id: applicationId }),
      });
      const body = (await res.json()) as { message?: string; grievance?: PortalGrievance };
      if (!res.ok) {
        setError(body.message ?? 'Could not file grievance');
        return;
      }
      if (body.grievance) setSelected(body.grievance);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'WITHDRAW' | 'RESPOND' | 'REQUEST_ESCALATION') {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/grievances/${selected.grievance_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      const body = (await res.json()) as { message?: string; grievance?: PortalGrievance };
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
        <h1 className="ux4g-heading-2xl-strong">Grievances & helpdesk</h1>
        <p className="ux4g-body-m-default">
          Raise an issue against one of your applications and track helpdesk status. Categories
          follow SAMPLE_LAB metadata (case, document, payment, fulfillment, other). Officers decide
          outcomes — not an AI. SAMPLE_LAB · CERTIFIED=false · G6=false.
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

      <section aria-labelledby="raise-heading">
        <h2 id="raise-heading" className="ux4g-heading-l-strong">
          Raise a grievance
        </h2>
        <form className="sf-stack" onSubmit={(e) => void raise(e)}>
          <label className="ux4g-label">
            Category
            <select
              className="ux4g-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
            >
              {SAMPLE_LAB_GRIEVANCE_CATEGORIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ux4g-label">
            Application
            <select
              className="ux4g-select"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              required
            >
              <option value="">Select application</option>
              {apps.map((a) => (
                <option key={a.application_id} value={a.application_id}>
                  {(a.catalogue_id ?? 'Application') + ' · ' + a.application_id.slice(0, 8)}
                  {a.status ? ` · ${a.status}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ux4g-btn-fill-primary" disabled={busy || !applicationId}>
            {busy ? 'Filing…' : 'File grievance'}
          </button>
        </form>
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="ux4g-heading-l-strong">
          My grievances
        </h2>
        {items.length === 0 ? (
          <p className="ux4g-body-m-default">No grievances filed yet.</p>
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
                  {g.category_label ? ` · ${g.category_label}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section aria-labelledby="detail-heading">
          <h2 id="detail-heading" className="ux4g-heading-l-strong">
            {selected.reference_code}
          </h2>
          <p className="ux4g-body-m-default">
            Status: {selected.status_label}
            {selected.category_label ? ` · ${selected.category_label}` : ''}
          </p>
          {selected.application_id ? (
            <p className="ux4g-body-s-default">
              Linked application:{' '}
              <Link href={`/certificates/${selected.application_id}`} className="ux4g-link">
                view application
              </Link>
            </p>
          ) : null}
          {(selected.can_respond || selected.can_request_escalation) && (
            <label className="ux4g-label">
              Note (stored as opaque SIMULATED ref — avoid personal data)
              <textarea
                className="ux4g-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </label>
          )}
          <div className="sf-actions">
            {selected.can_respond ? (
              <button
                type="button"
                className="ux4g-btn-fill-primary"
                disabled={busy}
                onClick={() => void act('RESPOND')}
              >
                Send reply
              </button>
            ) : null}
            {selected.can_request_escalation ? (
              <button
                type="button"
                className="ux4g-btn-outline-primary"
                disabled={busy}
                onClick={() => void act('REQUEST_ESCALATION')}
              >
                Request escalation
              </button>
            ) : null}
            {selected.can_withdraw ? (
              <button
                type="button"
                className="ux4g-btn-outline-neutral"
                disabled={busy}
                onClick={() => void act('WITHDRAW')}
              >
                Withdraw
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
