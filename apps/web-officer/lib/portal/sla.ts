/**
 * Officer BFF helpers for CMP-029 SLA visibility (SF-53).
 * Read + evaluate only — never invent anchors or durations. CERTIFIED=false.
 */
import { SAMPLE_LAB_SLA_CATALOGUE } from '@serviceform/m10-sample-lab/sla-catalogue';
import { platform, type Officer, type PlatformResponse } from './platform';

export interface SlaClockView {
  clock_id: string;
  application_id: string;
  stage_code: string;
  clock_status: string;
  deadline_at: string;
  pause_reason_code: string | null;
  breach_at: string | null;
  escalation_level: number;
  start_anchor: string;
  completion_anchor: string;
  portal_clock_start_event: string;
  warning_emitted_at: string | null;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
}

export interface SlaCaseProjection {
  application_id: string;
  clocks: SlaClockView[];
  catalogue: typeof SAMPLE_LAB_SLA_CATALOGUE;
  mounted: boolean;
  certified: false;
  g6_issued: false;
}

type ClockEntry = {
  sla_clock?: Record<string, unknown>;
  detail?: Record<string, unknown>;
};

function asClock(entry: ClockEntry, applicationId: string): SlaClockView | null {
  const c = entry.sla_clock;
  if (!c || typeof c['clock_id'] !== 'string') return null;
  const detail = entry.detail ?? {};
  return {
    clock_id: c['clock_id'] as string,
    application_id: (c['application_id'] as string) ?? applicationId,
    stage_code: typeof detail['stage_code'] === 'string' ? detail['stage_code'] : 'OVERALL',
    clock_status: String(c['clock_status'] ?? 'UNKNOWN'),
    deadline_at: String(c['deadline_at'] ?? ''),
    pause_reason_code:
      typeof c['pause_reason_code'] === 'string' ? (c['pause_reason_code'] as string) : null,
    breach_at: typeof c['breach_at'] === 'string' ? (c['breach_at'] as string) : null,
    escalation_level: typeof c['escalation_level'] === 'number' ? c['escalation_level'] : 0,
    start_anchor: String(c['start_anchor'] ?? ''),
    completion_anchor: String(c['completion_anchor'] ?? ''),
    portal_clock_start_event: SAMPLE_LAB_SLA_CATALOGUE.portal_clock_start_event,
    warning_emitted_at:
      typeof detail['warning_emitted_at'] === 'string'
        ? (detail['warning_emitted_at'] as string)
        : null,
    started_at: typeof detail['started_at'] === 'string' ? (detail['started_at'] as string) : null,
    paused_at: typeof detail['paused_at'] === 'string' ? (detail['paused_at'] as string) : null,
    completed_at:
      typeof detail['completed_at'] === 'string' ? (detail['completed_at'] as string) : null,
  };
}

/** Best-effort evaluate then list clocks for the case (server-authoritative breach/escalation). */
export async function loadCaseSla(
  officer: Officer,
  applicationId: string,
): Promise<{ ok: true; projection: SlaCaseProjection } | { ok: false; res: PlatformResponse }> {
  const listed = await platform('GET', `/v1/applications/${applicationId}/sla-clocks`, {
    token: officer.token,
  });
  if (listed.status === 404) {
    return {
      ok: true,
      projection: {
        application_id: applicationId,
        clocks: [],
        catalogue: SAMPLE_LAB_SLA_CATALOGUE,
        mounted: false,
        certified: false,
        g6_issued: false,
      },
    };
  }
  if (listed.status !== 200) return { ok: false, res: listed };

  const raw = listed.body['clocks'];
  const entries = Array.isArray(raw) ? (raw as ClockEntry[]) : [];

  // Evaluate RUNNING clocks so breach/escalation indicators are server-computed.
  for (const entry of entries) {
    const clockId = entry.sla_clock?.['clock_id'];
    const status = entry.sla_clock?.['clock_status'];
    if (typeof clockId !== 'string') continue;
    if (status !== 'RUNNING' && status !== 'BREACHED') continue;
    await platform('POST', `/v1/sla-clocks/${clockId}/evaluate`, {
      token: officer.token,
      body: {},
      idempotent: true,
    });
  }

  const refreshed = await platform('GET', `/v1/applications/${applicationId}/sla-clocks`, {
    token: officer.token,
  });
  if (refreshed.status !== 200) return { ok: false, res: refreshed };
  const refreshedRaw = refreshed.body['clocks'];
  const refreshedEntries = Array.isArray(refreshedRaw) ? (refreshedRaw as ClockEntry[]) : [];
  const clocks = refreshedEntries
    .map((e) => asClock(e, applicationId))
    .filter((c): c is SlaClockView => c !== null);

  return {
    ok: true,
    projection: {
      application_id: applicationId,
      clocks,
      catalogue: SAMPLE_LAB_SLA_CATALOGUE,
      mounted: true,
      certified: false,
      g6_issued: false,
    },
  };
}

export function slaStatusTag(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'ux4g-tag-tonal-info';
    case 'PAUSED':
      return 'ux4g-tag-tonal-warning';
    case 'BREACHED':
      return 'ux4g-tag-tonal-error';
    case 'COMPLETED':
      return 'ux4g-tag-tonal-success';
    default:
      return 'ux4g-tag-tonal-neutral';
  }
}
