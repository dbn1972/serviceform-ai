'use client';

import { Alert, Button, Card, Checkbox, Select, TextInput } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';
import { DESK_LABELS, deskActionsForRole, type DeskAction } from '../lib/portal/desk';
import {
  clockStatusLabel,
  pauseReasonLabel,
  SAMPLE_LAB_SLA_CATALOGUE,
} from '@serviceform/m10-sample-lab/sla-catalogue';
import { slaStatusTag, type SlaClockView } from '../lib/portal/sla-view';

type App = {
  id: string;
  status: string;
  platform_state: string;
  applicant_name?: string;
  applicant_mobile?: string;
  residence_duration_months?: number;
  purpose_of_certificate?: string;
  evidence_type?: string;
  evidence_file_name?: string;
  residence_address?: {
    house_no_or_name: string;
    locality: string;
    district: string;
    state_code: string;
    pincode: string;
  };
  credential_id?: string;
  rejection_reason?: string;
  digilocker?: { mode: string; status: string; provider_transaction_ref?: string };
  issuance_error?: { error_code: string; step: string };
};

type Task = {
  task_id: string;
  application_id: string;
  workflow_node_id?: string;
  task_state: string;
  assignment: { role_code: string; claimed_principal_id?: string };
};

type Catalogue = {
  reasons: {
    reason_code: string;
    label: string;
    notice_code: string;
    instruction_ref: string;
    default_item_codes: string[];
  }[];
  item_codes: { item_code: string; label: string }[];
  close_reason_codes: { close_reason_code: string; label: string }[];
};

type DeficiencyNotice = {
  deficiency_id: string;
  status: string;
  reason_code: string;
  notice_code: string;
  items: { item_code: string; required: boolean; item_status: string }[];
  responded_at: string | null;
  closed_at: string | null;
};

const AWAITING_ISSUE = ['APPROVED', 'SIGNING_PENDING'];
const CAN_RAISE = ['SUBMITTED', 'RECEIVED', 'UNDER_SCRUTINY'];

function statusTag(status: string): string {
  switch (status) {
    case 'ISSUED':
      return 'ux4g-tag-tonal-success';
    case 'REJECTED':
      return 'ux4g-tag-tonal-error';
    case 'SUBMITTED':
      return 'ux4g-tag-tonal-info';
    case 'DEFICIENCY_RAISED':
    case 'ACTION_REQUIRED':
      return 'ux4g-tag-tonal-warning';
    case 'CITIZEN_RESPONSE':
      return 'ux4g-tag-tonal-info';
    default:
      return 'ux4g-tag-tonal-neutral';
  }
}

function itemLabel(catalogue: Catalogue | null, code: string): string {
  return catalogue?.item_codes.find((i) => i.item_code === code)?.label ?? code;
}

function reasonLabel(catalogue: Catalogue | null, code: string): string {
  return catalogue?.reasons.find((r) => r.reason_code === code)?.label ?? code;
}

export function ApplicationReview({ id }: { id: string }) {
  const [app, setApp] = useState<App | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [deficiencies, setDeficiencies] = useState<DeficiencyNotice[]>([]);
  const [slaClocks, setSlaClocks] = useState<SlaClockView[]>([]);
  const [slaMounted, setSlaMounted] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [raising, setRaising] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [itemCodes, setItemCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Sequential: app (with task) first; deficiencies/SLA only after success so an IDOR
    // 404 never leaves an unread body holding Playwright networkidle open.
    const appRes = await fetch(`/api/portal/applications/${id}`);
    const appBody = (await appRes.json().catch(() => ({}))) as {
      application?: App;
      task?: Task | null;
      message?: string;
    };
    if (!appRes.ok || !appBody.application) {
      setError(appBody.message ?? 'Application not found');
      setDeficiencies([]);
      setSlaClocks([]);
      setSlaMounted(false);
      setTask(null);
      return;
    }
    setApp(appBody.application);
    setTask(appBody.task ?? null);
    const defRes = await fetch(`/api/portal/applications/${id}/deficiencies`);
    if (!defRes.ok) {
      setDeficiencies([]);
    } else {
      const defBody = (await defRes.json().catch(() => ({}))) as {
        deficiencies?: DeficiencyNotice[];
        catalogue?: Catalogue;
      };
      setDeficiencies(defBody.deficiencies ?? []);
      if (defBody.catalogue) {
        setCatalogue(defBody.catalogue);
        setReasonCode((prev) => {
          if (prev) return prev;
          const first = defBody.catalogue?.reasons[0];
          if (first) {
            setItemCodes([...first.default_item_codes]);
            return first.reason_code;
          }
          return prev;
        });
      }
    }
    const slaRes = await fetch(`/api/portal/applications/${id}/sla`);
    if (!slaRes.ok) {
      setSlaClocks([]);
      setSlaMounted(false);
      return;
    }
    const slaBody = (await slaRes.json().catch(() => ({}))) as {
      clocks?: SlaClockView[];
      mounted?: boolean;
    };
    setSlaClocks(slaBody.clocks ?? []);
    setSlaMounted(slaBody.mounted === true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function onReasonChange(next: string) {
    setReasonCode(next);
    const reason = catalogue?.reasons.find((r) => r.reason_code === next);
    if (reason) setItemCodes([...reason.default_item_codes]);
  }

  function toggleItem(code: string) {
    setItemCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function act(action: 'APPROVE' | 'REJECT' | 'ISSUE' | 'FORWARD') {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/applications/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(task?.task_id ? { task_id: task.task_id } : {}),
        }),
      });
      const body = (await res.json()) as {
        error_code?: string;
        message?: string;
        application?: App;
        task?: Task | null;
      };
      if (!res.ok) {
        setError(body.message ?? body.error_code ?? 'The decision could not be recorded');
        return;
      }
      const next = body.application;
      if (next) setApp(next);
      setTask(body.task ?? null);
      if (action === 'FORWARD') {
        setInfo('Forwarded to the approving desk. Temporal sequences the next HUMAN_TASK by role.');
        return;
      }
      if (action === 'REJECT') {
        setInfo('Rejected. Your decision is recorded on the case as a human decision.');
        return;
      }
      const decision =
        action === 'APPROVE'
          ? 'Approved. Your decision is recorded on the case as a human decision. '
          : '';
      setInfo(
        next?.issuance_error
          ? `${decision}Issuance did not complete (${next.issuance_error.step}: ${next.issuance_error.error_code}); you can retry it.`
          : next?.digilocker?.status === 'PUBLISHED'
            ? `${decision}Certificate issued and published to DigiLocker (SIMULATED).`
            : `${decision}Certificate issued; DigiLocker publish is ${next?.digilocker?.status ?? 'pending'}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function raiseDeficiency() {
    setError('');
    setInfo('');
    if (!reasonCode || itemCodes.length < 1) {
      setError('Choose a reason and at least one document to request');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/applications/${id}/deficiencies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'RAISE',
          reason_code: reasonCode,
          item_codes: itemCodes,
        }),
      });
      const body = (await res.json()) as {
        message?: string;
        error_code?: string;
        application?: App;
        deficiency?: DeficiencyNotice;
      };
      if (!res.ok) {
        setError(body.message ?? body.error_code ?? 'Could not raise deficiency');
        return;
      }
      if (body.application) setApp(body.application);
      setRaising(false);
      setInfo(
        'Deficiency raised. The case is now DEFICIENCY_RAISED / ACTION_REQUIRED for the citizen.',
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function closeOpenDeficiency(deficiencyId: string) {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/applications/${id}/deficiencies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'CLOSE',
          deficiency_id: deficiencyId,
          close_reason_code: catalogue?.close_reason_codes[0]?.close_reason_code,
        }),
      });
      const body = (await res.json()) as {
        message?: string;
        error_code?: string;
        application?: App;
      };
      if (!res.ok) {
        setError(body.message ?? body.error_code ?? 'Could not close deficiency');
        return;
      }
      if (body.application) setApp(body.application);
      setInfo('Deficiency notice closed.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!app && !error) return <p className="ux4g-body-m-default">Loading…</p>;
  if (error && !app) {
    return (
      <Alert variant="error" title="Not found">
        {error}
      </Alert>
    );
  }
  if (!app) return null;

  const deskRole = task?.assignment.role_code;
  const actions: DeskAction[] = deskRole ? deskActionsForRole(deskRole) : ['APPROVE', 'REJECT'];
  const openNotice = deficiencies.find((d) => d.status === 'OPEN');
  const responseNotice = deficiencies.find((d) => d.status === 'RESPONSE_RECEIVED');
  const canRaise = CAN_RAISE.includes(app.platform_state) && !openNotice && !raising && catalogue;
  const canDecide =
    (app.status === 'SUBMITTED' ||
      ['SUBMITTED', 'RECEIVED', 'UNDER_SCRUTINY', 'DECISION_PENDING', 'CITIZEN_RESPONSE'].includes(
        app.platform_state,
      )) &&
    !openNotice &&
    !raising;

  return (
    <div className="sf-section">
      <Card
        title="Review application"
        subtitle="Human decision on Application/Case (CMP-015) · queue from HUMAN_TASK graph (CMP-017) · deficiency via CMP-019 · SLA via CMP-029"
        footer={
          canDecide ? (
            <div className="sf-actions">
              {actions.includes('FORWARD') ? (
                <Button disabled={busy} onClick={() => void act('FORWARD')}>
                  Forward for approval
                </Button>
              ) : null}
              {actions.includes('APPROVE') ? (
                <Button disabled={busy} onClick={() => void act('APPROVE')}>
                  Approve
                </Button>
              ) : null}
              {actions.includes('REJECT') ? (
                <Button variant="outline-danger" disabled={busy} onClick={() => void act('REJECT')}>
                  Reject
                </Button>
              ) : null}
              {canRaise ? (
                <Button variant="outline-primary" disabled={busy} onClick={() => setRaising(true)}>
                  Raise deficiency
                </Button>
              ) : null}
            </div>
          ) : AWAITING_ISSUE.includes(app.platform_state) ? (
            <div className="sf-actions">
              <Button variant="outline-primary" disabled={busy} onClick={() => void act('ISSUE')}>
                Retry issuance
              </Button>
            </div>
          ) : canRaise ? (
            <div className="sf-actions">
              <Button variant="outline-primary" disabled={busy} onClick={() => setRaising(true)}>
                Raise deficiency
              </Button>
            </div>
          ) : null
        }
      >
        <Alert variant="warning" title="Sample lab — SIMULATED issuance, G6 not issued">
          Desks follow Studio workflow HUMAN_TASK role_code assignments (never named officers).
          Raise deficiency uses CMP-019 with published SAMPLE_LAB catalogue codes only. After final
          approval, the platform signs and issues the certificate and publishes it to DigiLocker
          using SIMULATED connectors. CERTIFIED=false.
        </Alert>

        <div className="sf-meta-row">
          <span className={statusTag(app.status)}>{app.status}</span>
          <span className="ux4g-tag-tonal-neutral">{app.platform_state}</span>
          {task ? (
            <>
              <span className="ux4g-tag-tonal-primary">
                {DESK_LABELS[task.assignment.role_code] ?? task.assignment.role_code}
              </span>
              <span className="ux4g-tag-tonal-neutral">{task.task_state}</span>
              {task.workflow_node_id ? (
                <span className="ux4g-tag-outline-neutral">{task.workflow_node_id}</span>
              ) : null}
            </>
          ) : (
            <span className="ux4g-tag-tonal-neutral">No open HUMAN_TASK</span>
          )}
          {app.digilocker ? (
            <>
              <span className="ux4g-tag-tonal-neutral">DigiLocker · {app.digilocker.status}</span>
              <span className="ux4g-tag-outline-warning">{app.digilocker.mode}</span>
            </>
          ) : null}
        </div>

        <dl className="sf-dl">
          <dt>Applicant</dt>
          <dd>
            {app.applicant_name}
            {app.applicant_mobile ? ` · ${app.applicant_mobile}` : ''}
          </dd>
          <dt>Address</dt>
          <dd>
            {app.residence_address
              ? `${app.residence_address.house_no_or_name}, ${app.residence_address.locality}, ${app.residence_address.district}, ${app.residence_address.state_code} ${app.residence_address.pincode}`
              : '—'}
          </dd>
          <dt>Residence</dt>
          <dd>{app.residence_duration_months ?? '—'} months</dd>
          <dt>Evidence</dt>
          <dd>
            {app.evidence_type}
            {app.evidence_file_name ? ` · ${app.evidence_file_name}` : ''}
          </dd>
          <dt>Purpose</dt>
          <dd>{app.purpose_of_certificate ?? '—'}</dd>
          {app.credential_id ? (
            <>
              <dt>Credential</dt>
              <dd>{app.credential_id}</dd>
            </>
          ) : null}
          {app.digilocker?.provider_transaction_ref ? (
            <>
              <dt>DigiLocker ref</dt>
              <dd>{app.digilocker.provider_transaction_ref}</dd>
            </>
          ) : null}
        </dl>

        {app.rejection_reason ? (
          <Alert variant="error" title="Rejection">
            {app.rejection_reason}
          </Alert>
        ) : null}
        {info ? (
          <Alert variant="success" title="Decision recorded">
            {info}
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="error" title="Action failed">
            {error}
          </Alert>
        ) : null}
      </Card>

      {raising && catalogue ? (
        <Card
          title="Raise deficiency"
          subtitle="Request more evidence via CMP-019 (SAMPLE_LAB catalogue codes)"
          footer={
            <div className="sf-actions">
              <Button disabled={busy} onClick={() => void raiseDeficiency()}>
                Send request to citizen
              </Button>
              <Button variant="outline-neutral" disabled={busy} onClick={() => setRaising(false)}>
                Cancel
              </Button>
            </div>
          }
        >
          <Select
            label="Reason"
            value={reasonCode}
            onChange={(e) => onReasonChange(e.target.value)}
            options={catalogue.reasons.map((r) => ({
              value: r.reason_code,
              label: r.label,
            }))}
          />
          <fieldset className="sf-section">
            <legend className="ux4g-label-m-strong">Documents to request</legend>
            <div className="sf-section">
              {catalogue.item_codes.map((item) => (
                <Checkbox
                  key={item.item_code}
                  label={item.label}
                  checked={itemCodes.includes(item.item_code)}
                  onChange={() => toggleItem(item.item_code)}
                />
              ))}
            </div>
          </fieldset>
          <TextInput
            label="Instruction reference (published)"
            value={
              catalogue.reasons.find((r) => r.reason_code === reasonCode)?.instruction_ref ?? ''
            }
            readOnly
          />
        </Card>
      ) : null}

      {openNotice || responseNotice || deficiencies.length > 0 ? (
        <Card title="Deficiency notices" subtitle="CMP-019 status for this case">
          <ul className="sf-section">
            {deficiencies.map((d) => (
              <li key={d.deficiency_id} className="sf-section">
                <div className="sf-meta-row">
                  <span className={statusTag(d.status)}>{d.status}</span>
                  <span className="ux4g-tag-tonal-neutral">
                    {reasonLabel(catalogue, d.reason_code)}
                  </span>
                </div>
                <p className="ux4g-body-s-default">
                  Requested: {d.items.map((i) => itemLabel(catalogue, i.item_code)).join(', ')}
                </p>
                {d.status === 'OPEN' ? (
                  <p className="ux4g-body-s-default">
                    Waiting for the citizen to upload and resubmit.
                  </p>
                ) : null}
                {d.status === 'RESPONSE_RECEIVED' ? (
                  <div className="sf-actions">
                    <Button
                      variant="outline-primary"
                      disabled={busy}
                      onClick={() => void closeOpenDeficiency(d.deficiency_id)}
                    >
                      Close deficiency
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="SLA clock"
        subtitle="CMP-029 · SAMPLE_LAB published IND-SOC-002 overlay (10 working days) · CERTIFIED=false"
      >
        {!slaMounted ? (
          <Alert variant="info" title="SLA not mounted on this lab host">
            CMP-029 is optional (`DATABASE_URL_CMP029`). When unset, deficiency still works with an
            unbound SLA port.
          </Alert>
        ) : slaClocks.length === 0 ? (
          <p className="ux4g-body-m-default">
            No clock yet. The OVERALL clock starts after citizen SUBMIT (portal mapping{' '}
            {SAMPLE_LAB_SLA_CATALOGUE.portal_clock_start_event} →{' '}
            {SAMPLE_LAB_SLA_CATALOGUE.cmp029_start_anchor}).
          </p>
        ) : (
          <ul className="sf-section">
            {slaClocks.map((clock) => (
              <li key={clock.clock_id} className="sf-section">
                <div className="sf-meta-row">
                  <span className={slaStatusTag(clock.clock_status)}>
                    {clockStatusLabel(clock.clock_status)}
                  </span>
                  <span className="ux4g-tag-tonal-neutral">{clock.stage_code}</span>
                  {clock.pause_reason_code ? (
                    <span className="ux4g-tag-tonal-warning">
                      {pauseReasonLabel(clock.pause_reason_code)}
                    </span>
                  ) : null}
                  {clock.breach_at ? (
                    <span className="ux4g-tag-tonal-error">Breach recorded</span>
                  ) : null}
                  {clock.escalation_level > 0 ? (
                    <span className="ux4g-tag-tonal-error">
                      Escalation L{clock.escalation_level}
                    </span>
                  ) : null}
                </div>
                <dl className="sf-dl">
                  <dt>Deadline</dt>
                  <dd>{clock.deadline_at || '—'}</dd>
                  <dt>Start anchor</dt>
                  <dd>
                    {clock.portal_clock_start_event} ({clock.start_anchor})
                  </dd>
                  <dt>Completion anchor</dt>
                  <dd>{clock.completion_anchor}</dd>
                  {clock.breach_at ? (
                    <>
                      <dt>Breach at</dt>
                      <dd>{clock.breach_at}</dd>
                    </>
                  ) : null}
                  {clock.paused_at ? (
                    <>
                      <dt>Paused at</dt>
                      <dd>{clock.paused_at}</dd>
                    </>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
