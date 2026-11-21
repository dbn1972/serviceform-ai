/**
 * SAMPLE_LAB published SLA catalogue (SF-53 / CMP-029).
 * Mirrors fixtures/lab/platform/sla-catalogue.json. Anchors and duration come from the
 * public Odisha IND-SOC-002 overlay (POLICY_INPUT_REQUIRED) — not invented statute.
 * CMP-029 FROZEN start_anchor enum uses PUBLISHED_POLICY_ANCHOR as the carrier for the
 * portal mapping APPLICATION_SUBMITTED. CERTIFIED=false. G6=false.
 */

export interface SlaEscalationStep {
  level: number;
  after_deadline_minutes: number;
  action_code: string;
}

export interface SampleLabSlaCatalogue {
  source: 'SAMPLE_LAB';
  catalogue_id: string;
  publication_ref: string;
  policy_code: string;
  calendar_code: string;
  portal_clock_start_event: 'APPLICATION_SUBMITTED';
  cmp029_start_anchor: 'PUBLISHED_POLICY_ANCHOR';
  completion_anchor: 'DECISION_RECORDED';
  duration_basis: 'WORKING_MINUTES';
  processing_days_working: number;
  minutes_per_working_day: number;
  duration_minutes: number;
  warning_before_minutes: number;
  escalation_days_after_deadline: number;
  allowed_pause_reason_codes: readonly string[];
  escalation_schedule: readonly SlaEscalationStep[];
  calendar: {
    utc_offset_minutes: number;
    working_weekdays: readonly number[];
    window_start_minute: number;
    window_end_minute: number;
    holidays: readonly string[];
  };
  workload: { actor_id: string; roles: readonly string[] };
  labels: Record<string, string>;
}

export const SAMPLE_LAB_SLA_CATALOGUE: SampleLabSlaCatalogue = {
  source: 'SAMPLE_LAB',
  catalogue_id: 'IND-SOC-002',
  publication_ref: 'sample-lab:ind-soc-002-sla-v1@0.2.0-odisha-sample',
  policy_code: 'SAMPLE_LAB_IND_SOC_002_SLA',
  calendar_code: 'SAMPLE_LAB_WORKING_WEEK_IST',
  portal_clock_start_event: 'APPLICATION_SUBMITTED',
  cmp029_start_anchor: 'PUBLISHED_POLICY_ANCHOR',
  completion_anchor: 'DECISION_RECORDED',
  duration_basis: 'WORKING_MINUTES',
  processing_days_working: 10,
  minutes_per_working_day: 480,
  duration_minutes: 4800,
  warning_before_minutes: 480,
  escalation_days_after_deadline: 10,
  allowed_pause_reason_codes: ['DEFICIENCY_OPEN'],
  escalation_schedule: [
    { level: 1, after_deadline_minutes: 0, action_code: 'ESCALATE_SUPERVISOR' },
    { level: 2, after_deadline_minutes: 4800, action_code: 'ESCALATE_HEAD' },
  ],
  calendar: {
    utc_offset_minutes: 330,
    working_weekdays: [1, 2, 3, 4, 5],
    window_start_minute: 540,
    window_end_minute: 1020,
    holidays: [],
  },
  workload: {
    actor_id: '0d15ba00-0029-4000-8000-0d15ba00029a',
    roles: ['SAMPLE_LAB_SLA_OPERATOR'],
  },
  labels: {
    RUNNING: 'Clock running',
    PAUSED: 'Clock paused',
    BREACHED: 'SLA breached',
    COMPLETED: 'Clock completed',
    DEFICIENCY_OPEN: 'Paused — deficiency open',
    breach: 'Breach recorded',
    escalation: 'Escalation level',
  },
};

export function pauseReasonLabel(code: string | null | undefined): string {
  if (!code) return '';
  return SAMPLE_LAB_SLA_CATALOGUE.labels[code] ?? code;
}

export function clockStatusLabel(status: string): string {
  return SAMPLE_LAB_SLA_CATALOGUE.labels[status] ?? status;
}
