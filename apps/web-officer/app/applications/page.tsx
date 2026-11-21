'use client';

import { AppShell, Alert, Card, Select, TextLink } from '@serviceform/ui-ux4g';
import { useEffect, useMemo, useState } from 'react';
import { OfficerNav } from '../../components/OfficerNav';
import { RequireOfficerSession } from '../../components/RequireOfficerSession';
import { DESK_LABELS } from '../../lib/portal/desk';

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

function QueueList() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [deskFilter, setDeskFilter] = useState('ALL');

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

  if (apps === null) return <p className="ux4g-body-m-default">Loading queue…</p>;
  if (apps.length === 0) {
    return (
      <Card title="Queue empty">
        <p className="ux4g-body-m-default">No submitted applications for this office yet.</p>
      </Card>
    );
  }

  const deskOptions = [
    { value: 'ALL', label: 'All applications' },
    { value: 'TASKS', label: 'Open HUMAN_TASK desks' },
    ...desks.map((d) => ({
      value: d.role_code,
      label: `${d.label} (${d.open_count})`,
    })),
  ];

  return (
    <div className="sf-queue">
      {desks.length > 0 ? (
        <Card title="Desks by role_code" subtitle="Studio HUMAN_TASK assignment · CMP-017">
          <Select
            label="Desk filter"
            value={deskFilter}
            onChange={(e) => setDeskFilter(e.target.value)}
            options={deskOptions}
          />
          <div className="sf-meta-row" style={{ marginTop: '0.75rem' }}>
            {desks.map((d) => (
              <span key={d.role_code} className="ux4g-tag-tonal-neutral">
                {d.label}: {d.open_count} open
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {(filtered ?? []).map((a) => {
        const task = taskByApp.get(a.id);
        return (
          <Card key={a.id} title={a.applicant_name ?? 'Applicant'}>
            <div className="sf-queue-item">
              <div className="sf-queue-item-main">
                <div className="sf-meta-row">
                  <span className={statusTag(a.status)}>{a.status}</span>
                  <span className="ux4g-tag-tonal-neutral">{a.platform_state}</span>
                  {task ? (
                    <span className="ux4g-tag-tonal-primary">
                      {DESK_LABELS[task.assignment.role_code] ?? task.assignment.role_code}
                    </span>
                  ) : null}
                </div>
                <p className="ux4g-body-s-default">
                  {a.catalogue_id ? `${a.catalogue_id} · ` : ''}
                  {task?.workflow_node_id ? `${task.workflow_node_id} · ` : ''}
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

function statusTag(status: string): string {
  switch (status) {
    case 'ISSUED':
      return 'ux4g-tag-tonal-success';
    case 'REJECTED':
      return 'ux4g-tag-tonal-error';
    case 'SUBMITTED':
      return 'ux4g-tag-tonal-info';
    default:
      return 'ux4g-tag-tonal-neutral';
  }
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
          Multi-desk queue from Studio HUMAN_TASK role_code assignments (CMP-017). Scrutiny and
          approving desks are separate roles — never named officers.
        </p>
      </section>

      <Alert variant="info" title="Platform path (SAMPLE_LAB)">
        Cases come from Application/Case (CMP-015). Open HUMAN_TASK rows come from Temporal CMP-016
        when the graph enters a role-assigned node. Connectors are SIMULATED. CERTIFIED=false ·
        G6=false.
      </Alert>

      <RequireOfficerSession>
        <QueueList />
      </RequireOfficerSession>
    </AppShell>
  );
}
