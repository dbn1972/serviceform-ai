import type { TenantContext } from '../types.js';

/**
 * INT-009 inbound port: Deficiency (CMP-019, Wave B) -> SLA pause/resume. CMP-019 depends on
 * this interface through a published API/port, never by importing CMP-029 code or SQL.
 * Pause is honoured only when the clock's published SLA policy lists the reason code; resume is
 * honoured only for a PAUSED clock. CMP-029 never mutates case state on either call.
 */
export interface DeficiencyClockCommand {
  application_id: string;
  stage_code?: string;
  reason_code: string;
  idempotency_key: string;
}

export interface DeficiencyClockResult {
  clock_id: string;
  application_id: string;
  clock_status: 'RUNNING' | 'PAUSED';
  deadline_at: string;
  pause_reason_code: string | null;
}

export interface DeficiencyClockPort {
  pauseForDeficiency(
    ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult>;
  resumeAfterDeficiency(
    ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult>;
}
