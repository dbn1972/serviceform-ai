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

/** True when CMP-029 recorded a breach (status or breach_at). */
export function hasSlaBreach(clocks: readonly SlaClockView[]): boolean {
  return clocks.some((c) => c.clock_status === 'BREACHED' || Boolean(c.breach_at));
}

export function breachedSlaClocks(clocks: readonly SlaClockView[]): SlaClockView[] {
  return clocks.filter((c) => c.clock_status === 'BREACHED' || Boolean(c.breach_at));
}

export function slaBreachSummary(clocks: readonly SlaClockView[]): string | null {
  const breached = breachedSlaClocks(clocks);
  if (breached.length === 0) return null;
  const first = breached[0];
  const when = first?.breach_at ?? 'recorded';
  if (breached.length === 1) {
    return `OVERALL / ${first?.stage_code ?? 'clock'} breached at ${when}`;
  }
  return `${breached.length} SLA clocks breached (first at ${when})`;
}

export function hasSlaWarning(clocks: readonly SlaClockView[]): boolean {
  return clocks.some((c) => Boolean(c.warning_emitted_at) && c.clock_status !== 'COMPLETED');
}
