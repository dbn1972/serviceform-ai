'use client';

import { AppShell, Alert, Card, Select, TextLink } from '@serviceform/ui-ux4g';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { OfficerNav } from '../../components/OfficerNav';
import { RequireOfficerSession } from '../../components/RequireOfficerSession';
import { DESK_LABELS } from '../../lib/portal/desk';
import { statusChrome } from '../../lib/portal/status-view';

type App = {
  id: string;
  status: string;
  platform_state: string;
  applicant_name?: string;
  catalogue_id?: string;
  purpose_of_certificate?: string;
  residence_duration_months?: number;
};

type Task = {
  task_id: string;
  application_id: string;
  workflow_node_id?: string;
  task_state: string;
  assignment: { role_code: string };
};

type Desk = { role_code: string; label: string; open_count: number };

function initialDeskFilter(raw: string | null): string {
  if (!raw) return 'ALL';
  if (raw === 'ALL' || raw === 'TASKS') return raw;
  if (raw in DESK_LABELS || raw.startsWith('SAMPLE_LAB_')) return raw;
  return 'ALL';
}

function QueueList() {
  const searchParams = useSearchParams();
  const [apps, setApps] = useState<App[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [deskFilter, setDeskFilter] = useState(() => initialDeskFilter(searchParams.get('desk')));

  useEffect(() => {
    setDeskFilter(initialDeskFilter(searchParams.get('desk')));
  }, [searchParams]);

  useEffect(() => {
    void Promise.all([
      fetch('/api/portal/applications').then((r) => r.json()) as Promise<{ applications?: App[] }>,
      fetch('/api/portal/tasks').then((r) => r.json()) as Promise<{
        tasks?: Task[];
        desks?: Desk[];
      }>,
    ]).then(([appsBody, tasksBody]) => {
      setApps(appsBody.applications ?? []);
      setTasks(tasksBody.tasks ?? []);
      setDesks(tasksBody.desks ?? []);
    });
  }, []);

  const taskByApp = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) m.set(t.application_id, t);
    return m;
  }, [tasks]);

  const filtered = useMemo(() => {
    if (!apps) return null;
    if (deskFilter === 'ALL') return apps;
    if (deskFilter === 'TASKS') return apps.filter((a) => taskByApp.has(a.id));
    return apps.filter((a) => taskByApp.get(a.id)?.assignment.role_code === deskFilter);
  }, [apps, deskFilter, taskByApp]);

  if (apps === null) {
    return (
      <p className="ux4g-body-m-default" aria-busy="true">
        Loading queue…
      </p>
    );
  }
  if (apps.length === 0) {
    return (
      <Card title="Queue empty">
        <p className="ux4g-body-m-default">No submitted applications for this office yet.</p>
      </Card>
    );
  }

  const deskOptions = [
    { value: 'ALL', label: 'All applications' },
    { value: 'TASKS', label: 'Open desk tasks' },
    ...desks.map((d) => ({
      value: d.role_code,
      label: `${d.label} (${d.open_count})`,
    })),
  ];

  return (
    <div className="sf-queue">
      {desks.length > 0 ? (
        <Card title="Filter by desk" subtitle="Open tasks assigned by desk role">
          <div className="sf-form-stack">
            <Select
              label="Desk filter"
              value={deskFilter}
              onChange={(e) => setDeskFilter(e.target.value)}
              options={deskOptions}
            />
            <div className="sf-meta-row">
              {desks.map((d) => (
                <span key={d.role_code} className="ux4g-tag-tonal-neutral">
                  {d.label}: {d.open_count} open
                </span>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      {(filtered ?? []).map((a) => {
        const task = taskByApp.get(a.id);
        const chrome = statusChrome(a.status, a.platform_state);
        return (
          <Card key={a.id} title={a.applicant_name ?? 'Applicant'}>
            <div className="sf-queue-item">
              <div className="sf-queue-item-main">
                <div className="sf-meta-row">
                  <span className={chrome.primary.tagClass} title={chrome.primary.title}>
                    {chrome.primary.label}
                  </span>
                  {chrome.platformDiff ? (
                    <span
                      className={chrome.platformDiff.tagClass}
                      title={chrome.platformDiff.title}
                    >
                      {chrome.platformDiff.label}
                    </span>
                  ) : null}
                  {task ? (
                    <span className="ux4g-tag-tonal-primary">
                      {DESK_LABELS[task.assignment.role_code] ?? task.assignment.role_code}
                    </span>
                  ) : null}
                </div>
                <p className="ux4g-body-s-default">
                  {a.catalogue_id ? `${a.catalogue_id} · ` : ''}
                  {typeof a.residence_duration_months === 'number'
                    ? `${a.residence_duration_months} months residence · `
                    : a.purpose_of_certificate
                      ? `${a.purpose_of_certificate.slice(0, 40)} · `
                      : ''}
                  Ref {a.id.slice(0, 8)}…
                </p>
              </div>
              <TextLink href={`/applications/${a.id}`}>Review</TextLink>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export default function ApplicationsPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Officer Workbench"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Applications</h1>
        <p className="ux4g-body-m-default">
          Review cases assigned to your desks. Scrutiny and approving desks stay separate roles.
        </p>
      </section>

      <details className="sf-stack">
        <summary className="ux4g-body-s-default">About this desk</summary>
        <Alert variant="info" title="Sample lab path">
          Cases and open desk tasks come from the platform case and workflow services. Connectors
          are simulated. This environment is not production-certified.
        </Alert>
      </details>

      <RequireOfficerSession>
        <Suspense
          fallback={
            <p className="ux4g-body-m-default" aria-busy="true">
              Loading queue…
            </p>
          }
        >
          <QueueList />
        </Suspense>
      </RequireOfficerSession>
    </AppShell>
  );
}
