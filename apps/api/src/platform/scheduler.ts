import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSchedulerService,
  PgSchedulerRepository,
  type AppointmentSchedulerService,
  type NotificationPort,
} from '@serviceform/cmp-056-scheduler';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

/** CMP-056 service methods require tenant_id: string (TenantContext). */
type TenantCtx = RequestContext & { tenant_id: string };

/**
 * SAMPLE_LAB CMP-056 host adapter (appointment / scheduling shell).
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

export interface LabAppointmentCatalogue {
  workload: { actor_id: string; roles: readonly string[] };
  appointment_types: readonly LabAppointmentType[];
  slot_templates: readonly LabSlotTemplate[];
}

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

  return {
    workload: { actor_id, roles: roles.length > 0 ? roles : [...DEFAULT_WORKLOAD.roles] },
    appointment_types: appointment_types.length > 0 ? appointment_types : DEFAULT_TYPES,
    slot_templates: slot_templates.length > 0 ? slot_templates : DEFAULT_SLOTS,
  };
}

export function loadAppointmentCatalogue(dir: string): LabAppointmentCatalogue {
  return parseAppointmentCatalogue(
    JSON.parse(readFileSync(join(dir, 'appointment-catalogue.json'), 'utf8')) as unknown,
  );
}

/** SIMULATED notify — booking stays committed even if this fails (contract invariant). */
export class LabAppointmentNotifier implements NotificationPort {
  readonly calls: unknown[] = [];
  async notifyAppointment(req: unknown): Promise<void> {
    this.calls.push(req);
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
  notifier?: NotificationPort;
  clock?: () => Date;
}): {
  service: AppointmentSchedulerService;
  seeder: LabAppointmentSeeder;
  notifier: NotificationPort;
  repo: PgSchedulerRepository;
} {
  const notifier = params.notifier ?? new LabAppointmentNotifier();
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
  return { service, seeder, notifier, repo };
}

/**
 * Lab-only routes (not in frozen CMP-056 OpenAPI — no CCR):
 * GET  /v1/lab/appointments/catalogue
 * POST /v1/lab/appointments/ensure — SYSTEM seed types+slots from catalogue
 */
export function registerLabSchedulerRoutes(
  app: FastifyInstance,
  opts: {
    catalogue: LabAppointmentCatalogue;
    seeder: LabAppointmentSeeder;
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
      catalogue: opts.catalogue,
    });
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
