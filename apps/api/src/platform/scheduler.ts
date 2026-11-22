import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSchedulerService,
  PgSchedulerRepository,
  type AppointmentNotifyRequest,
  type AppointmentSchedulerService,
  type NotificationPort,
} from '@serviceform/cmp-056-scheduler';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { CaseServiceLike } from './issuance.js';

/** CMP-056 service methods require tenant_id: string (TenantContext). */
type TenantCtx = RequestContext & { tenant_id: string };

/**
 * SAMPLE_LAB CMP-056 host adapter (appointment / scheduling shell + wait deepen).
 * Constitution #37: reusable platform metadata — no service-specific calendar code,
 * no invented statutory hearing/inspection calendars. CERTIFIED=false · G6=false.
 */

export interface LabAppointmentType {
  appointment_type_ref: string;
  resource_calendar_ref: string | null;
  label: string;
  description: string;
  related_inspection_pin: string | null;
  catalogue_id: string | null;
}

export interface LabSlotTemplate {
  appointment_type_ref: string;
  slot_ref: string;
  capacity: number;
  opens_offset_hours: number;
  duration_hours: number;
  label: string;
}

/** Metadata binding: appointment lifecycle → CMP-015 command releasing a WAIT node. */
export interface LabAppointmentWaitBinding {
  binding_id: string;
  appointment_type_ref: string;
  on_lifecycle_status: string;
  case_expected_state: string;
  case_command: string;
  workflow_wait_node_id: string;
  label: string;
}

export interface LabAppointmentCatalogue {
  workload: { actor_id: string; roles: readonly string[] };
  appointment_types: readonly LabAppointmentType[];
  slot_templates: readonly LabSlotTemplate[];
  wait_bindings: readonly LabAppointmentWaitBinding[];
}

const LIFECYCLE_STATUSES = new Set(['BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']);

const APP_PARTICIPANT_RE =
  /^participant:application:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const DEFAULT_WORKLOAD = {
  actor_id: '05605605-0000-4000-8000-056056056056',
  roles: ['SAMPLE_LAB_SCHEDULER_ADMIN'] as const,
};

const DEFAULT_TYPES: readonly LabAppointmentType[] = [
  {
    appointment_type_ref: 'meta:appointment-type:site-visit',
    resource_calendar_ref: 'meta:calendar:sample-lab-working-week',
    label: 'Site visit appointment',
    description: 'SAMPLE_LAB opaque booking type beside CMP-018 SITE_VISIT',
    related_inspection_pin: 'TRADE_LICENCE_SITE_VISIT',
    catalogue_id: 'IND-BTP-001',
  },
];

const DEFAULT_SLOTS: readonly LabSlotTemplate[] = [
  {
    appointment_type_ref: 'meta:appointment-type:site-visit',
    slot_ref: 'slot:sample-lab:site-visit:morning-1',
    capacity: 1,
    opens_offset_hours: 24,
    duration_hours: 2,
    label: 'Site visit · morning',
  },
];

export function parseAppointmentCatalogue(raw: unknown): LabAppointmentCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const workloadRaw =
    obj['workload'] && typeof obj['workload'] === 'object'
      ? (obj['workload'] as Record<string, unknown>)
      : {};
  const actor_id =
    typeof workloadRaw['actor_id'] === 'string' && workloadRaw['actor_id'].length > 0
      ? workloadRaw['actor_id']
      : DEFAULT_WORKLOAD.actor_id;
  const roles = Array.isArray(workloadRaw['roles'])
    ? (workloadRaw['roles'] as string[]).filter((r) => typeof r === 'string' && r.length > 0)
    : [...DEFAULT_WORKLOAD.roles];

  const typesRaw = Array.isArray(obj['appointment_types']) ? obj['appointment_types'] : [];
  const appointment_types: LabAppointmentType[] = [];
  for (const entry of typesRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Record<string, unknown>;
    const appointment_type_ref =
      typeof t['appointment_type_ref'] === 'string' ? t['appointment_type_ref'] : '';
    if (!appointment_type_ref) continue;
    appointment_types.push({
      appointment_type_ref,
      resource_calendar_ref:
        typeof t['resource_calendar_ref'] === 'string' ? t['resource_calendar_ref'] : null,
      label: typeof t['label'] === 'string' ? t['label'] : appointment_type_ref,
      description: typeof t['description'] === 'string' ? t['description'] : '',
      related_inspection_pin:
        typeof t['related_inspection_pin'] === 'string' ? t['related_inspection_pin'] : null,
      catalogue_id: typeof t['catalogue_id'] === 'string' ? t['catalogue_id'] : null,
    });
  }

  const slotsRaw = Array.isArray(obj['slot_templates']) ? obj['slot_templates'] : [];
  const slot_templates: LabSlotTemplate[] = [];
  for (const entry of slotsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const appointment_type_ref =
      typeof s['appointment_type_ref'] === 'string' ? s['appointment_type_ref'] : '';
    const slot_ref = typeof s['slot_ref'] === 'string' ? s['slot_ref'] : '';
    const capacity = typeof s['capacity'] === 'number' ? s['capacity'] : 0;
    if (!appointment_type_ref || !slot_ref || !Number.isInteger(capacity) || capacity < 1) continue;
    slot_templates.push({
      appointment_type_ref,
      slot_ref,
      capacity,
      opens_offset_hours:
        typeof s['opens_offset_hours'] === 'number' ? s['opens_offset_hours'] : 24,
      duration_hours: typeof s['duration_hours'] === 'number' ? s['duration_hours'] : 1,
      label: typeof s['label'] === 'string' ? s['label'] : slot_ref,
    });
  }

  const waitsRaw = Array.isArray(obj['wait_bindings']) ? obj['wait_bindings'] : [];
  const wait_bindings: LabAppointmentWaitBinding[] = [];
  for (const entry of waitsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const w = entry as Record<string, unknown>;
    const binding_id = typeof w['binding_id'] === 'string' ? w['binding_id'] : '';
    const appointment_type_ref =
      typeof w['appointment_type_ref'] === 'string' ? w['appointment_type_ref'] : '';
    const on_lifecycle_status =
      typeof w['on_lifecycle_status'] === 'string' ? w['on_lifecycle_status'] : '';
    const case_expected_state =
      typeof w['case_expected_state'] === 'string' ? w['case_expected_state'] : '';
    const case_command = typeof w['case_command'] === 'string' ? w['case_command'] : '';
    const workflow_wait_node_id =
      typeof w['workflow_wait_node_id'] === 'string' ? w['workflow_wait_node_id'] : '';
    if (
      !binding_id ||
      !appointment_type_ref ||
      !LIFECYCLE_STATUSES.has(on_lifecycle_status) ||
      !case_expected_state ||
      !case_command ||
      !workflow_wait_node_id
    ) {
      continue;
    }
    wait_bindings.push({
      binding_id,
      appointment_type_ref,
      on_lifecycle_status,
      case_expected_state,
      case_command,
      workflow_wait_node_id,
      label: typeof w['label'] === 'string' ? w['label'] : binding_id,
    });
  }

  return {
    workload: { actor_id, roles: roles.length > 0 ? roles : [...DEFAULT_WORKLOAD.roles] },
    appointment_types: appointment_types.length > 0 ? appointment_types : DEFAULT_TYPES,
    slot_templates: slot_templates.length > 0 ? slot_templates : DEFAULT_SLOTS,
    wait_bindings,
  };
}

export function parseApplicationParticipantRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = APP_PARTICIPANT_RE.exec(ref);
  return m?.[1] ?? null;
}

export function loadAppointmentCatalogue(dir: string): LabAppointmentCatalogue {
  return parseAppointmentCatalogue(
    JSON.parse(readFileSync(join(dir, 'appointment-catalogue.json'), 'utf8')) as unknown,
  );
}

/**
 * Post-commit INT-014 → CMP-015: appointment lifecycle releases a WAIT node when
 * participant_ref correlates to an application and catalogue wait_bindings match.
 * Fail-soft: signal errors never invalidate the booking (notify ≠ cancel).
 */
export class LabAppointmentWorkflowSignalPort {
  readonly signals: unknown[] = [];

  constructor(
    private readonly cases: CaseServiceLike | null,
    private readonly catalogue: LabAppointmentCatalogue,
    private readonly systemCtx: () => TenantCtx,
  ) {}

  async onAppointmentLifecycle(req: AppointmentNotifyRequest): Promise<void> {
    if (!this.cases) return;
    const applicationId = parseApplicationParticipantRef(req.participant_ref);
    if (!applicationId) return;
    const bindings = this.catalogue.wait_bindings.filter(
      (b) =>
        b.appointment_type_ref === req.appointment_type_ref &&
        b.on_lifecycle_status === req.lifecycle_status,
    );
    if (bindings.length === 0) return;

    const ctx = this.systemCtx();
    if (ctx.tenant_id !== req.tenant_id) return;
    const appRes = await this.cases.getApplication(ctx, applicationId);
    if (appRes.status !== 200) return;
    const app = (appRes.body as { application?: Record<string, unknown> })?.application;
    if (!app) return;
    const state = String(app['state'] ?? '');

    for (const binding of bindings) {
      if (state !== binding.case_expected_state) continue;
      this.signals.push({
        binding_id: binding.binding_id,
        appointment_id: req.appointment_id,
        application_id: applicationId,
        command: binding.case_command,
        workflow_wait_node_id: binding.workflow_wait_node_id,
      });
      await this.cases.executeCommand(
        ctx,
        applicationId,
        {
          command: binding.case_command,
          expected_state: binding.case_expected_state,
          expected_version: Number(app['aggregate_version'] ?? 0),
        },
        `lab-appt-wait:${req.appointment_id}:${binding.binding_id}`,
      );
      return;
    }
  }
}

/** SIMULATED notify — booking stays committed even if this fails (contract invariant). */
export class LabAppointmentNotifier implements NotificationPort {
  readonly calls: AppointmentNotifyRequest[] = [];

  constructor(private readonly workflowSignal?: LabAppointmentWorkflowSignalPort) {}

  async notifyAppointment(req: AppointmentNotifyRequest): Promise<void> {
    this.calls.push(req);
    if (this.workflowSignal) {
      try {
        await this.workflowSignal.onAppointmentLifecycle(req);
      } catch {
        // notify ≠ cancel: wait-signal failure must not bubble into booking notify FAILED path
        // beyond the caller's catch — swallow here so booking notify still marks SENT.
      }
    }
  }
}

export function schedulerWorkloadContext(
  catalogue: LabAppointmentCatalogue,
  cellId: string,
  tenantId: string,
): TenantCtx {
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

function sha256Fingerprint(material: string): string {
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}

function idem(endpoint: string, key: string, fingerprintMaterial: string) {
  return { key, fingerprint: sha256Fingerprint(fingerprintMaterial), endpoint };
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: unknown }).code);
  }
  return '';
}

export class LabAppointmentSeeder {
  private seeded = false;

  constructor(
    private readonly service: AppointmentSchedulerService,
    private readonly repo: PgSchedulerRepository,
    private readonly catalogue: LabAppointmentCatalogue,
    private readonly cellId: string,
    private readonly tenantId: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Registers opaque types + publishes capacity slots from catalogue metadata.
   * Idempotent across lab restarts (TYPE_REF_EXISTS / SLOT_REF_EXISTS → success).
   */
  async ensureCatalogueSeeded(): Promise<{
    types: Record<string, string>;
    slots_published: number;
  }> {
    const ctx = schedulerWorkloadContext(this.catalogue, this.cellId, this.tenantId);
    const typeIds: Record<string, string> = {};
    const now = this.clock();

    for (const t of this.catalogue.appointment_types) {
      const existing = await this.repo.withTx(ctx, (tx) => tx.getTypeByRef(t.appointment_type_ref));
      if (existing) {
        typeIds[t.appointment_type_ref] = existing.appointment_type_id;
        continue;
      }
      try {
        const key = `lab-type-${t.appointment_type_ref}`.slice(0, 128);
        const result = await this.service.registerType(
          ctx,
          {
            appointment_type_ref: t.appointment_type_ref,
            resource_calendar_ref: t.resource_calendar_ref,
          },
          idem('POST /v1/appointments/types', key, t.appointment_type_ref),
        );
        if (result.status === 201) {
          const body = result.body as { appointment_type_id?: string };
          if (body.appointment_type_id) {
            typeIds[t.appointment_type_ref] = body.appointment_type_id;
          }
        }
      } catch (err) {
        if (errorCode(err) !== 'SF-APP-002') throw err;
        const again = await this.repo.withTx(ctx, (tx) => tx.getTypeByRef(t.appointment_type_ref));
        if (again) typeIds[t.appointment_type_ref] = again.appointment_type_id;
      }
    }

    let slots_published = 0;
    for (const template of this.catalogue.slot_templates) {
      const typeId = typeIds[template.appointment_type_ref];
      if (!typeId) continue;

      const existingSlot = await this.repo.withTx(ctx, (tx) => tx.getSlotByRef(template.slot_ref));
      if (existingSlot) continue;

      const opens = new Date(now.getTime() + template.opens_offset_hours * 3_600_000);
      const closes = new Date(opens.getTime() + template.duration_hours * 3_600_000);
      const key = `lab-slot-${template.slot_ref}`.slice(0, 128);
      try {
        const result = await this.service.publishSlot(
          ctx,
          {
            appointment_type_id: typeId,
            slot_ref: template.slot_ref,
            capacity: template.capacity,
            opens_at: opens.toISOString(),
            closes_at: closes.toISOString(),
          },
          idem('POST /v1/appointments/slots', key, template.slot_ref),
        );
        if (result.status === 201) slots_published += 1;
      } catch (err) {
        if (errorCode(err) !== 'SF-APP-002') throw err;
      }
    }

    this.seeded = true;
    return { types: typeIds, slots_published };
  }

  get isSeeded(): boolean {
    return this.seeded;
  }
}

export function composeLabScheduler(params: {
  pool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  catalogue: LabAppointmentCatalogue;
  cellId: string;
  tenantId: string;
  cases?: CaseServiceLike | null;
  notifier?: NotificationPort;
  clock?: () => Date;
}): {
  service: AppointmentSchedulerService;
  seeder: LabAppointmentSeeder;
  notifier: LabAppointmentNotifier;
  workflowSignal: LabAppointmentWorkflowSignalPort;
  repo: PgSchedulerRepository;
} {
  const systemCtx = () =>
    schedulerWorkloadContext(params.catalogue, params.cellId, params.tenantId);
  const workflowSignal = new LabAppointmentWorkflowSignalPort(
    params.cases ?? null,
    params.catalogue,
    systemCtx,
  );
  const notifier =
    (params.notifier as LabAppointmentNotifier | undefined) ??
    new LabAppointmentNotifier(workflowSignal);
  const repo = new PgSchedulerRepository(params.pool);
  const clock = params.clock ?? (() => new Date());
  const service = buildSchedulerService({
    repository: repo,
    authorizer: params.authorizer as never,
    notifier,
    clock,
  });
  const seeder = new LabAppointmentSeeder(
    service,
    repo,
    params.catalogue,
    params.cellId,
    params.tenantId,
    clock,
  );
  return { service, seeder, notifier, workflowSignal, repo };
}

type ContextResolver = (request: FastifyRequest) => Promise<unknown>;

/**
 * Lab-only routes (not in frozen CMP-056 OpenAPI — no CCR):
 * GET  /v1/lab/appointments/catalogue
 * GET  /v1/lab/appointments/wait-bindings
 * GET  /v1/lab/appointments/mine — citizen/officer list by participant_ref
 * POST /v1/lab/appointments/ensure — SYSTEM seed types+slots from catalogue
 */
export function registerLabSchedulerRoutes(
  app: FastifyInstance,
  opts: {
    catalogue: LabAppointmentCatalogue;
    seeder: LabAppointmentSeeder;
    service: AppointmentSchedulerService;
    resolveContext: ContextResolver;
  },
): void {
  app.get('/v1/lab/appointments/catalogue', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      constitution: 37,
      invented_statutory_policy_forbidden: true,
      capacity_atomic: true,
      notification_failure_invalidates_booking: false,
      wait_on_appointment_without_polling: true,
      catalogue: opts.catalogue,
    });
  });

  app.get('/v1/lab/appointments/wait-bindings', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      invented_statutory_policy_forbidden: true,
      wait_on_appointment_without_polling: true,
      wait_bindings: opts.catalogue.wait_bindings,
    });
  });

  app.get('/v1/lab/appointments/mine', async (request, reply) => {
    const ctx = (await opts.resolveContext(request)) as TenantCtx;
    const q = request.query as { participant_ref?: string; limit?: string };
    let participantRef =
      typeof q.participant_ref === 'string' && q.participant_ref.length > 0
        ? q.participant_ref
        : '';
    if (!participantRef && ctx.actor?.type === 'CITIZEN' && typeof ctx.actor.id === 'string') {
      participantRef = `participant:citizen:${ctx.actor.id}`;
    }
    if (!participantRef) {
      return reply
        .code(400)
        .header('cache-control', 'no-store')
        .send({ error_code: 'SF-SYS-003', message: 'participant_ref required' });
    }
    const result = await opts.service.listByParticipantRef(ctx, participantRef);
    return reply.code(result.status).header('cache-control', 'no-store').send(result.body);
  });

  app.post('/v1/lab/appointments/ensure', async (_req, reply) => {
    try {
      const result = await opts.seeder.ensureCatalogueSeeded();
      return reply.header('cache-control', 'no-store').send({
        source: 'SAMPLE_LAB',
        g6_issued: false,
        certified: false,
        ...result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Seed refused';
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error_code: 'SF-SYS-004', message });
    }
  });
}
