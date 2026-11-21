/**
 * Citizen BFF helpers for CMP-019 deficiency response (SF-47). Evidence upload is
 * SIMULATED: the portal mints opaque evidence_ref UUIDs and kind codes from the
 * SAMPLE_LAB catalogue — no real document store on this path.
 */
import { randomUUID } from 'node:crypto';
import { platform, type Citizen, type PlatformResponse } from './platform';
import type { PlatformApplication } from './applications';

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

export async function listDeficiencies(
  citizen: Citizen,
  applicationId: string,
): Promise<{ ok: true; deficiencies: DeficiencyNotice[] } | { ok: false; res: PlatformResponse }> {
  const res = await platform('GET', `/v1/applications/${applicationId}/deficiencies`, {
    token: citizen.token,
  });
  if (res.status !== 200) return { ok: false, res };
  const list = res.body['deficiencies'];
  return {
    ok: true,
    deficiencies: Array.isArray(list) ? (list as DeficiencyNotice[]) : [],
  };
}

export function activeOpenNotice(deficiencies: DeficiencyNotice[]): DeficiencyNotice | undefined {
  return deficiencies.find((d) => d.status === 'OPEN');
}

/** SIMULATED evidence attachment: opaque UUID ref + catalogue kind code. */
export function simulatedEvidenceRef(kindCode = 'CITIZEN_UPLOAD'): {
  evidence_ref: string;
  kind_code: string;
} {
  return { evidence_ref: randomUUID(), kind_code: kindCode };
}

export async function respondToDeficiency(
  citizen: Citizen,
  app: PlatformApplication,
  deficiency: DeficiencyNotice,
  input: {
    narrative: string;
    provided_item_codes: string[];
    file_name?: string;
  },
): Promise<{ ok: true; notice: DeficiencyNotice } | { ok: false; res: PlatformResponse }> {
  const narrativeSlug = input.narrative
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const narrative_ref = `ref:response:${narrativeSlug || 'citizen'}:${randomUUID().slice(0, 8)}`;
  const evidence = [simulatedEvidenceRef('CITIZEN_UPLOAD')];
  if (input.file_name) {
    // File name is not stored as PII on the notice; only the SIMULATED ref is linked.
    void input.file_name;
  }
  const res = await platform('POST', `/v1/deficiencies/${deficiency.deficiency_id}/response`, {
    token: citizen.token,
    idempotent: true,
    body: {
      narrative_ref,
      provided_item_codes: input.provided_item_codes,
      evidence,
      case_expected_state: app.state,
      case_expected_version: app.aggregate_version,
    },
  });
  if (res.status !== 200) return { ok: false, res };
  return { ok: true, notice: res.body as unknown as DeficiencyNotice };
}
