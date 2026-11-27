'use client';

import { Button, Icon, Select } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SAMPLE_LAB_GRIEVANCE_CATEGORIES } from '@serviceform/m10-sample-lab/grievance-catalogue';
import { FormAlert } from './FormFeedback';

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

  const categoryOptions = useMemo(
    () => SAMPLE_LAB_GRIEVANCE_CATEGORIES.map((c) => ({ value: c.code, label: c.label })),
    [],
  );
  const applicationOptions = useMemo(
    () =>
      apps.map((a) => ({
        value: a.application_id,
        label:
          (a.catalogue_id ?? 'Application') +
          ' · ' +
          a.application_id.slice(0, 8) +
          (a.status ? ` · ${a.status}` : ''),
      })),
    [apps],
  );

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
          Raise an issue about one of your applications and track its status. An officer decides the
          outcome — not an automated system.
        </p>
      </section>

      <FormAlert tone="info" title="Sample lab environment">
        This desk runs in SAMPLE_LAB. Categories are lab metadata (case, document, payment,
        fulfillment, other).
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

      <section aria-labelledby="raise-heading">
        <h2 id="raise-heading" className="ux4g-heading-l-strong">
          Raise a grievance
        </h2>
        <form className="sf-stack" onSubmit={(e) => void raise(e)}>
          <Select
            id="grievance-category"
            label="Category"
            value={category}
            options={categoryOptions}
            onChange={(e) => setCategory(e.target.value)}
            required
          />
          <Select
            id="grievance-application"
            label="Application"
            value={applicationId}
            options={applicationOptions}
            placeholder="Select application"
            onChange={(e) => setApplicationId(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy || !applicationId}>
            {busy ? 'Filing…' : 'File grievance'}
          </Button>
        </form>
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="ux4g-heading-l-strong">
          My grievances
        </h2>
        {items.length === 0 ? (
          <section className="sf-empty" aria-labelledby="grievances-empty">
            <span className="sf-service-mark">
              <Icon name="document" size={24} />
            </span>
            <h3 id="grievances-empty" className="ux4g-heading-s-strong">
              No grievances filed yet
            </h3>
            <p className="ux4g-body-m-default">
              When you file a grievance, it appears here with its helpdesk status.
            </p>
          </section>
        ) : (
          <ul className="sf-stack">
            {items.map((g) => (
              <li key={g.grievance_id}>
                <Button
                  type="button"
                  variant="text-neutral"
                  size="s"
                  onClick={() => setSelected(g)}
                >
                  {g.reference_code} · {g.status_label}
                  {g.category_label ? ` · ${g.category_label}` : ''}
                </Button>
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
              <Link href={`/certificates/${selected.application_id}`} className="ux4g-text-link-m">
                view application
              </Link>
            </p>
          ) : null}
          {(selected.can_respond || selected.can_request_escalation) && (
            <label className="ux4g-label-m-default" htmlFor="grievance-note">
              Note (do not include personal data you do not want stored)
              <textarea
                id="grievance-note"
                className="ux4g-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </label>
          )}
          <div className="sf-actions">
            {selected.can_respond ? (
              <Button type="button" disabled={busy} onClick={() => void act('RESPOND')}>
                Send reply
              </Button>
            ) : null}
            {selected.can_request_escalation ? (
              <Button
                type="button"
                variant="outline-primary"
                disabled={busy}
                onClick={() => void act('REQUEST_ESCALATION')}
              >
                Request escalation
              </Button>
            ) : null}
            {selected.can_withdraw ? (
              <Button
                type="button"
                variant="outline-neutral"
                disabled={busy}
                onClick={() => void act('WITHDRAW')}
              >
                Withdraw
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
