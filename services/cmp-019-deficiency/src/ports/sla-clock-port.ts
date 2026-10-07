import type { TenantContext } from '../types.js';

/**
 * INT-009 outbound port. CMP-019 never imports CMP-029 code or SQL. Pause on open;
 * resume on citizen response or officer closure. The port is called only after the
 * deficiency transaction commits.
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

export interface SlaClockPort {
  pauseForDeficiency(
    ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult>;
  resumeAfterDeficiency(
    ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult>;
}

export class UnboundSlaClockPort implements SlaClockPort {
  pauseForDeficiency(
    _ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult> {
    return Promise.resolve({
      clock_id: '00000000-0000-4000-8000-000000000000',
      application_id: command.application_id,
      clock_status: 'PAUSED',
      deadline_at: '1970-01-01T00:00:00.000Z',
      pause_reason_code: command.reason_code,
    });
  }
  resumeAfterDeficiency(
    _ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult> {
    return Promise.resolve({
      clock_id: '00000000-0000-4000-8000-000000000000',
      application_id: command.application_id,
      clock_status: 'RUNNING',
      deadline_at: '1970-01-01T00:00:00.000Z',
      pause_reason_code: null,
    });
  }
}
