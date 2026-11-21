import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestContext } from '@serviceform/contracts';
import type pg from 'pg';

/**
 * SAMPLE_LAB CMP-029 host adapters (SF-53). Composition only:
 * seed published calendar/policy from SAMPLE_LAB catalogue, start clock after SUBMIT,
 * complete after decision, INT-009 pause/resume via SYSTEM workload (fail-closed OPA).
 * Catalogue mirrors packages/m10-sample-lab + fixtures/lab/platform/sla-catalogue.json
 * (IND-SOC-002 public-sample overlay). CERTIFIED=false. G6=false.
 */

/** Fail-closed defaults — must stay aligned with fixtures/lab/platform/sla-catalogue.json. */
export const LAB_SLA_DEFAULTS = {
  policy_code: 'SAMPLE_LAB_IND_SOC_002_SLA',
  calendar_code: 'SAMPLE_LAB_WORKING_WEEK_UTC_PLUS_330',
  publication_ref: 'sample-lab:ind-soc-002-sla-v1@0.2.0-public-sample',
  portal_clock_start_event: 'APPLICATION_SUBMITTED',
  cmp029_start_anchor: 'PUBLISHED_POLICY_ANCHOR',
  completion_anchor: 'DECISION_RECORDED',
  duration_basis: 'WORKING_MINUTES' as const,
  duration_minutes: 4800,
  warning_before_minutes: 480,
  allowed_pause_reason_codes: ['DEFICIENCY_OPEN'] as const,
  escalation_schedule: [
    { level: 1, after_deadline_minutes: 0, action_code: 'ESCALATE_SUPERVISOR' },
    { level: 2, after_deadline_minutes: 4800, action_code: 'ESCALATE_HEAD' },
  ] as const,
  calendar: {
    utc_offset_minutes: 330,
    working_weekdays: [1, 2, 3, 4, 5] as const,
    window_start_minute: 540,
    window_end_minute: 1020,
    holidays: [] as const,
  },
  workload: {
    actor_id: '0d15ba00-0029-4000-8000-0d15ba00029a',
    roles: ['SAMPLE_LAB_SLA_OPERATOR'] as const,
  },
} as const;

export type LabSlaCatalogue = {
  policy_code: string;
  calendar_code: string;
  publication_ref: string;
  portal_clock_start_event: string;
  cmp029_start_anchor: string;
  completion_anchor: string;
  duration_basis: 'WORKING_MINUTES' | 'CALENDAR_MINUTES';
  duration_minutes: number;
  warning_before_minutes: number;
  allowed_pause_reason_codes: readonly string[];
  escalation_schedule: readonly {
    level: number;
    after_deadline_minutes: number;
    action_code: string;
  }[];
  calendar: {
    utc_offset_minutes: number;
    working_weekdays: readonly number[];
    window_start_minute: number;
    window_end_minute: number;
    holidays: readonly string[];
  };
  workload: { actor_id: string; roles: readonly string[] };
};

export type SlaServiceLike = {
  createCalendar(
    ctx: unknown,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  createPolicy(
    ctx: unknown,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  start(
    ctx: unknown,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  complete(
    ctx: unknown,
    clockId: string,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  evaluate(
    ctx: unknown,
    clockId: string,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  clocksForApplication(
    ctx: unknown,
    applicationId: string,
  ): Promise<{ status: number; body: unknown }>;
  pauseForDeficiency(
    ctx: unknown,
    command: {
      application_id: string;
      stage_code?: string;
      reason_code: string;
      idempotency_key: string;
    },
  ): Promise<{
    clock_id: string;
    application_id: string;
    clock_status: 'RUNNING' | 'PAUSED';
    deadline_at: string;
    pause_reason_code: string | null;
  }>;
  resumeAfterDeficiency(
    ctx: unknown,
    command: {
      application_id: string;
      stage_code?: string;
      reason_code: string;
      idempotency_key: string;
    },
  ): Promise<{
    clock_id: string;
    application_id: string;
    clock_status: 'RUNNING' | 'PAUSED';
    deadline_at: string;
    pause_reason_code: string | null;
  }>;
};

type BuildSlaService = (opts: {
  pool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  clock?: () => Date;
}) => SlaServiceLike;

export function loadSlaCatalogue(dir: string): LabSlaCatalogue {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'sla-catalogue.json'), 'utf8')) as unknown;
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    // Fail closed when fixture drifts from known SAMPLE_LAB IND-SOC-002 values.
    if (
      obj['policy_code'] !== LAB_SLA_DEFAULTS.policy_code ||
      obj['duration_minutes'] !== LAB_SLA_DEFAULTS.duration_minutes ||
      obj['cmp029_start_anchor'] !== LAB_SLA_DEFAULTS.cmp029_start_anchor ||
      obj['portal_clock_start_event'] !== LAB_SLA_DEFAULTS.portal_clock_start_event
    ) {
      return { ...LAB_SLA_DEFAULTS };
    }
    return { ...LAB_SLA_DEFAULTS };
  } catch {
    return { ...LAB_SLA_DEFAULTS };
  }
}

export function slaWorkloadContext(
  catalogue: LabSlaCatalogue,
  cellId: string,
  tenantId: string,
): RequestContext {
  const correlation_id = randomUUID();
  return {
    tenant_id: tenantId,
    cell_id: cellId,
    actor: { type: 'SYSTEM', id: catalogue.workload.actor_id },
    roles: [...catalogue.workload.roles],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id,
    trace_id: correlation_id.replace(/-/g, ''),
  };
}

/** CMP-029 idempotency_record CHECK requires `sha256:` + 64 hex. */
function sha256Fingerprint(material: string): string {
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}

function idem(endpoint: string, key: string, fingerprintMaterial: string) {
  return { key, fingerprint: sha256Fingerprint(fingerprintMaterial), endpoint };
}

/**
 * INT-009 adapter: CMP-019 calls pause/resume after commit; lab uses SYSTEM workload
 * identity so citizen respond / officer open both succeed under fail-closed OPA.
 */
export class LabSlaClockPort {
  constructor(
    private readonly service: SlaServiceLike,
    private readonly systemCtx: () => RequestContext,
  ) {}

  pauseForDeficiency(
    _ctx: unknown,
    command: {
      application_id: string;
      stage_code?: string;
      reason_code: string;
      idempotency_key: string;
    },
  ) {
    return this.service.pauseForDeficiency(this.systemCtx(), command);
  }

  resumeAfterDeficiency(
    _ctx: unknown,
    command: {
      application_id: string;
      stage_code?: string;
      reason_code: string;
      idempotency_key: string;
    },
  ) {
    return this.service.resumeAfterDeficiency(this.systemCtx(), command);
  }
}

export class LabSlaLifecycle {
  private policyId: string | null = null;
  private seeded = false;

  constructor(
    private readonly service: SlaServiceLike,
    private readonly catalogue: LabSlaCatalogue,
    private readonly cellId: string,
    private readonly tenantId: string,
  ) {}

  systemCtx(): RequestContext {
    return slaWorkloadContext(this.catalogue, this.cellId, this.tenantId);
  }

  /** Idempotent seed of calendar + published policy from SAMPLE_LAB catalogue. */
  async ensurePublishedPolicy(): Promise<string> {
    if (this.policyId) return this.policyId;
    const ctx = this.systemCtx();
    const cal = await this.service.createCalendar(
      ctx,
      {
        calendar_code: this.catalogue.calendar_code,
        utc_offset_minutes: this.catalogue.calendar.utc_offset_minutes,
        working_weekdays: [...this.catalogue.calendar.working_weekdays],
        window_start_minute: this.catalogue.calendar.window_start_minute,
        window_end_minute: this.catalogue.calendar.window_end_minute,
        holidays: [...this.catalogue.calendar.holidays],
      },
      idem(
        'POST /v1/sla-calendars',
        'sample-lab-sla-calendar-v1',
        `cal:${this.catalogue.calendar_code}`,
      ),
    );
    const calendarId = String(
      (cal.body as { calendar_version_id?: string })?.calendar_version_id ?? '',
    );
    if (cal.status !== 201 || !calendarId) {
      throw new Error('SAMPLE_LAB SLA calendar seed failed');
    }
    const pol = await this.service.createPolicy(
      ctx,
      {
        policy_code: this.catalogue.policy_code,
        publication_ref: this.catalogue.publication_ref,
        start_anchor: this.catalogue.cmp029_start_anchor,
        completion_anchor: this.catalogue.completion_anchor,
        calendar_id: calendarId,
        duration_basis: this.catalogue.duration_basis,
        duration_minutes: this.catalogue.duration_minutes,
        warning_before_minutes: this.catalogue.warning_before_minutes,
        allowed_pause_reason_codes: [...this.catalogue.allowed_pause_reason_codes],
        escalation_schedule: this.catalogue.escalation_schedule.map((s) => ({ ...s })),
      },
      idem(
        'POST /v1/sla-policies',
        'sample-lab-sla-policy-v1',
        `pol:${this.catalogue.policy_code}:${this.catalogue.publication_ref}`,
      ),
    );
    const policyId = String(
      (pol.body as { sla_policy_version_id?: string })?.sla_policy_version_id ?? '',
    );
    if (pol.status !== 201 || !policyId) {
      throw new Error('SAMPLE_LAB SLA policy seed failed');
    }
    this.policyId = policyId;
    this.seeded = true;
    return policyId;
  }

  /**
   * After CMP-015 SUBMIT commits: start OVERALL clock. Fail-soft — never blocks the case response.
   * Uses PUBLISHED_POLICY_ANCHOR for the published APPLICATION_SUBMITTED portal mapping.
   */
  async startAfterSubmit(applicationId: string, anchorEventRef?: string): Promise<void> {
    if (!this.seeded && !this.policyId) await this.ensurePublishedPolicy();
    const policyId = this.policyId;
    if (!policyId) return;
    const ctx = this.systemCtx();
    try {
      await this.service.start(
        ctx,
        {
          application_id: applicationId,
          policy_id: policyId,
          stage_code: 'OVERALL',
          start_anchor: this.catalogue.cmp029_start_anchor,
          ...(anchorEventRef ? { anchor_event_ref: anchorEventRef } : {}),
        },
        idem(
          'POST /v1/sla-clocks',
          `sample-lab-sla-start:${applicationId}`,
          `start:${applicationId}:OVERALL`,
        ),
      );
    } catch {
      // Fail-soft: case SUBMIT already committed; SLA start retries on next lifecycle hook.
    }
  }

  /** After APPROVE/REJECT: complete RUNNING/BREACHED clock. Fail-soft. */
  async completeAfterDecision(applicationId: string): Promise<void> {
    const ctx = this.systemCtx();
    try {
      const listed = await this.service.clocksForApplication(ctx, applicationId);
      const clocks = (listed.body as { clocks?: { sla_clock?: Record<string, unknown> }[] })
        ?.clocks;
      if (!Array.isArray(clocks)) return;
      for (const entry of clocks) {
        const clock = entry.sla_clock;
        if (!clock) continue;
        const status = String(clock['clock_status'] ?? '');
        if (status === 'COMPLETED') continue;
        const clockId = String(clock['clock_id'] ?? '');
        if (!clockId) continue;
        await this.service.complete(
          ctx,
          clockId,
          { completion_anchor: this.catalogue.completion_anchor },
          idem(
            'POST /v1/sla-clocks/:id/complete',
            `sample-lab-sla-complete:${clockId}`,
            `complete:${clockId}:${this.catalogue.completion_anchor}`,
          ),
        );
      }
    } catch {
      // Fail-soft
    }
  }
}

export function composeLabSla(params: {
  pool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  buildSlaService: BuildSlaService;
  catalogue: LabSlaCatalogue;
  cellId: string;
  tenantId: string;
}): { service: SlaServiceLike; lifecycle: LabSlaLifecycle; clockPort: LabSlaClockPort } {
  const service = params.buildSlaService({
    pool: params.pool,
    authorizer: params.authorizer,
  });
  const lifecycle = new LabSlaLifecycle(service, params.catalogue, params.cellId, params.tenantId);
  const clockPort = new LabSlaClockPort(service, () => lifecycle.systemCtx());
  return { service, lifecycle, clockPort };
}

/** Case-command body shape used to detect SUBMIT / decision for SLA hooks. */
export function caseCommandName(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const cmd = (body as Record<string, unknown>)['command'];
  return typeof cmd === 'string' ? cmd : null;
}
