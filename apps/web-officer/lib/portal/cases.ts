import { platform, type Officer, type PlatformResponse } from './platform';

export interface PlatformApplication {
  application_id: string;
  state: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export type DecisionAction = 'APPROVE' | 'REJECT';

/** Officer-visible status derived from the CMP-015 state (no state is invented here). */
export function workbenchStatus(state: string): string {
  if (['DRAFT', 'READY_TO_SUBMIT'].includes(state)) return 'DRAFT';
  if (['APPROVED', 'SIGNING_PENDING'].includes(state)) return 'APPROVED';
  if (state === 'REJECTED') return 'REJECTED';
  if (['WITHDRAWN', 'CANCELLED', 'DEFICIENCY_RAISED', 'CITIZEN_RESPONSE'].includes(state))
    return state;
  if (['ISSUED', 'CLOSED'].includes(state)) return state;
  return 'SUBMITTED';
}

export function toWorkbenchApplication(
  app: PlatformApplication,
  data: Record<string, unknown> | null,
) {
  return {
    ...(data ?? {}),
    id: app.application_id,
    status: workbenchStatus(app.state),
    platform_state: app.state,
    aggregate_version: app.aggregate_version,
    created_at: app.created_at,
    submitted_at: app.submitted_at,
    source: 'PLATFORM',
    eligibility: 'NOT_EVALUATED',
  };
}

export async function readWorkingData(officer: Officer, id: string) {
  const res = await platform('GET', `/v1/applications/${id}/working-data`, {
    token: officer.token,
  });
  const wd = res.body['working_data'] as { data?: Record<string, unknown> } | undefined;
  return res.status === 200 && wd?.data ? wd.data : null;
}

/**
 * Until CMP-016 sequences the case (Phase B slice B-2c), the officer's decision drives the
 * intake transitions itself. Every step is a separate CMP-015 command, OPA-authorized and
 * audited as this officer; the final decision is attested HUMAN (Constitution #20).
 */
const INTAKE: Record<string, string> = {
  SUBMITTED: 'MARK_RECEIVED',
  RECEIVED: 'ENTER_SCRUTINY',
  UNDER_SCRUTINY: 'ENTER_DECISION_PENDING',
};

export async function decide(
  officer: Officer,
  start: PlatformApplication,
  action: DecisionAction,
): Promise<{ ok: true; app: PlatformApplication } | { ok: false; res: PlatformResponse }> {
  let app = start;
  for (let guard = 0; guard < 4 && INTAKE[app.state]; guard += 1) {
    const step = await command(officer, app, { command: INTAKE[app.state] as string });
    if (!step.ok) return step;
    app = step.app;
  }
  if (app.state !== 'DECISION_PENDING') {
    return {
      ok: false,
      res: {
        status: 409,
        body: { error_code: 'SF-APP-001', message: 'This case is not awaiting a decision' },
      },
    };
  }
  return command(officer, app, {
    command: action === 'APPROVE' ? 'RECORD_APPROVED' : 'RECORD_REJECTED',
    decision: { decision_maker: 'HUMAN' },
    ...(action === 'REJECT' ? { reason_code: 'OFFICER_REJECTED' } : {}),
  });
}

async function command(
  officer: Officer,
  app: PlatformApplication,
  body: Record<string, unknown>,
): Promise<{ ok: true; app: PlatformApplication } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', `/v1/applications/${app.application_id}/commands`, {
    token: officer.token,
    idempotent: true,
    body: { ...body, expected_state: app.state, expected_version: app.aggregate_version },
  });
  const next = res.body['application'] as PlatformApplication | undefined;
  return res.status === 200 && next ? { ok: true, app: next } : { ok: false, res };
}
