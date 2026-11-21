/**
 * Client-safe SLA view helpers (no Node imports). Used by ApplicationReview.
 * CERTIFIED=false. G6=false.
 */

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
