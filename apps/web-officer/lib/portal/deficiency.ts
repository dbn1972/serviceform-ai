/**
 * Officer BFF helpers for CMP-019 deficiency (SF-47). Catalogue codes come from the
 * SAMPLE_LAB published fixture — never invent statute. Advances the case only to
 * UNDER_SCRUTINY before open (CMP-015 RAISE_DEFICIENCY requires that state).
 */
import { platform, type Officer, type PlatformResponse } from './platform';
import type { PlatformApplication } from './cases';

export interface DeficiencyItem {
  item_seq: number;
  item_code: string;
  evidence_requirement_ref: string | null;
  required: boolean;
  item_status: string;
}

export interface DeficiencyNotice {
  deficiency_id: string;
  application_id: string;
  status: string;
  reason_code: string;
  notice_code: string;
  instruction_ref: string;
  response_due_at: string | null;
  opened_at: string;
  responded_at: string | null;
  closed_at: string | null;
  close_reason_code: string | null;
  aggregate_version: number;
  items: DeficiencyItem[];
  evidence: { evidence_ref: string; kind_code: string; response_id: string | null }[];
}

/** Intake steps that reach UNDER_SCRUTINY without entering DECISION_PENDING. */
const TO_SCRUTINY: Record<string, string> = {
  SUBMITTED: 'MARK_RECEIVED',
  RECEIVED: 'ENTER_SCRUTINY',
};

export async function advanceToScrutiny(
  officer: Officer,
  start: PlatformApplication,
): Promise<{ ok: true; app: PlatformApplication } | { ok: false; res: PlatformResponse }> {
  let app = start;
  for (let guard = 0; guard < 4 && TO_SCRUTINY[app.state]; guard += 1) {
    const step = await caseCommand(officer, app, { command: TO_SCRUTINY[app.state] as string });
    if (!step.ok) return step;
    app = step.app;
  }
  if (app.state !== 'UNDER_SCRUTINY') {
    return {
      ok: false,
      res: {
        status: 409,
        body: {
          error_code: 'SF-APP-001',
          message: 'This case is not under scrutiny; a deficiency cannot be raised',
        },
      },
    };
  }
  return { ok: true, app };
}

export async function listDeficiencies(
  officer: Officer,
  applicationId: string,
): Promise<{ ok: true; deficiencies: DeficiencyNotice[] } | { ok: false; res: PlatformResponse }> {
  const res = await platform('GET', `/v1/applications/${applicationId}/deficiencies`, {
    token: officer.token,
  });
  if (res.status !== 200) return { ok: false, res };
  const list = res.body['deficiencies'];
  return {
    ok: true,
    deficiencies: Array.isArray(list) ? (list as DeficiencyNotice[]) : [],
  };
}

export async function openDeficiency(
  officer: Officer,
  app: PlatformApplication,
  input: {
    reason_code: string;
    notice_code: string;
    instruction_ref: string;
    item_codes: string[];
  },
): Promise<{ ok: true; notice: DeficiencyNotice } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', '/v1/deficiencies', {
    token: officer.token,
    idempotent: true,
    body: {
      application_id: app.application_id,
      reason_code: input.reason_code,
      notice_code: input.notice_code,
      instruction_ref: input.instruction_ref,
      case_expected_state: app.state,
      case_expected_version: app.aggregate_version,
      items: input.item_codes.map((item_code) => ({ item_code, required: true })),
      evidence: [],
    },
  });
  if (res.status !== 201) return { ok: false, res };
  return { ok: true, notice: res.body as unknown as DeficiencyNotice };
}

export async function closeDeficiency(
  officer: Officer,
  deficiencyId: string,
  close_reason_code: string,
): Promise<{ ok: true; notice: DeficiencyNotice } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', `/v1/deficiencies/${deficiencyId}/close`, {
    token: officer.token,
    idempotent: true,
    body: { close_reason_code },
  });
  if (res.status !== 200) return { ok: false, res };
  return { ok: true, notice: res.body as unknown as DeficiencyNotice };
}

async function caseCommand(
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
