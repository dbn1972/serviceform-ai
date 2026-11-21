import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AllowLinkagePolicyPort,
  GrievanceFeedbackService,
  NoopHumanTaskPort,
  OutboxOnlyWorkflowAdvance,
  PgGrievanceStore,
  loadConfig,
  type Assignment,
  type RoutingPolicyPort,
} from '@serviceform/cmp-027-grievance-feedback';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';

/**
 * SAMPLE_LAB CMP-027 host adapter (grievance / helpdesk).
 * Mounts existing registerGrievanceRoutes via m05 + lab-only list routes (frozen OpenAPI
 * has no list yet — no CCR). CERTIFIED=false · G6=false.
 */

const LAB_CATEGORIES = new Set(['CASE', 'DOCUMENT', 'PAYMENT', 'FULFILLMENT', 'OTHER']);

export interface LabGrievanceCatalogue {
  categories: readonly { code: string; label: string; description: string }[];
  escalation: readonly { level: number; role_code: string; label: string }[];
  routing: {
    organisation_id: string;
    jurisdiction_id: string;
    office_id: string | null;
    max_escalation_level: number;
    citizen_may_request_escalation: boolean;
  };
}

const DEFAULT_ROUTING = {
  organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
  jurisdiction_id: '0d15ba00-0j01-4000-8000-0d15ba000j01',
  office_id: null as string | null,
  max_escalation_level: 3,
  citizen_may_request_escalation: true,
};

const DEFAULT_ESCALATION = [
  { level: 1, role_code: 'SAMPLE_LAB_HELPDESK_L1', label: 'Helpdesk L1' },
  { level: 2, role_code: 'SAMPLE_LAB_HELPDESK_L2', label: 'Supervisor L2' },
  { level: 3, role_code: 'SAMPLE_LAB_HELPDESK_L3', label: 'Appellate desk L3' },
] as const;

export function parseGrievanceCatalogue(raw: unknown): LabGrievanceCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const categories = Array.isArray(obj['categories'])
    ? (obj['categories'] as LabGrievanceCatalogue['categories'])
    : [];
  const escalation = Array.isArray(obj['escalation'])
    ? (obj['escalation'] as LabGrievanceCatalogue['escalation'])
    : DEFAULT_ESCALATION;
  const routingRaw =
    obj['routing'] && typeof obj['routing'] === 'object'
      ? (obj['routing'] as Record<string, unknown>)
      : {};
  return {
    categories,
    escalation,
    routing: {
      organisation_id:
        typeof routingRaw['organisation_id'] === 'string'
          ? routingRaw['organisation_id']
          : DEFAULT_ROUTING.organisation_id,
      jurisdiction_id:
        typeof routingRaw['jurisdiction_id'] === 'string'
          ? routingRaw['jurisdiction_id']
          : DEFAULT_ROUTING.jurisdiction_id,
      office_id: typeof routingRaw['office_id'] === 'string' ? routingRaw['office_id'] : null,
      max_escalation_level:
        typeof routingRaw['max_escalation_level'] === 'number'
          ? routingRaw['max_escalation_level']
          : DEFAULT_ROUTING.max_escalation_level,
      citizen_may_request_escalation:
        routingRaw['citizen_may_request_escalation'] === false ? false : true,
    },
  };
}

export function loadGrievanceCatalogue(dir: string): LabGrievanceCatalogue {
  return parseGrievanceCatalogue(
    JSON.parse(readFileSync(join(dir, 'grievance-catalogue.json'), 'utf8')) as unknown,
  );
}

/** Published-metadata routing — category → L1 desk; never named officers. */
export class LabGrievanceRoutingPort implements RoutingPolicyPort {
  readonly simulation = 'SIMULATED' as const;
  constructor(private readonly catalogue: LabGrievanceCatalogue) {}

  async resolve(
    _ctx: unknown,
    input: {
      category_code: string;
      kind: string;
      organisation_id: string | null;
      jurisdiction_id: string | null;
      service_scope_id: string | null;
    },
  ): Promise<Assignment> {
    if (!LAB_CATEGORIES.has(input.category_code)) {
      throw Object.assign(new Error('CATEGORY_NOT_IN_PUBLISHED_CATALOGUE'), {
        code: 'SF-SYS-003',
      });
    }
    const l1 = this.catalogue.escalation.find((e) => e.level === 1) ?? DEFAULT_ESCALATION[0];
    return {
      role_code: l1.role_code,
      organisation_id: input.organisation_id ?? this.catalogue.routing.organisation_id,
      office_id: this.catalogue.routing.office_id,
      jurisdiction_id: input.jurisdiction_id ?? this.catalogue.routing.jurisdiction_id,
      service_scope_id: input.service_scope_id,
    };
  }
}

const labNotificationPort = {
  async requestNotification(params: {
    tenant_id: string;
    grievance_id: string;
    template_ref: string;
    idempotency_key: string;
  }): Promise<{ notification_ref: string }> {
    return { notification_ref: `lab-notify:${params.grievance_id}:${params.template_ref}` };
  },
};

export function composeLabGrievance(params: {
  pool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  environment: string;
  catalogue: LabGrievanceCatalogue;
}): GrievanceFeedbackService {
  return new GrievanceFeedbackService({
    store: new PgGrievanceStore(params.pool),
    authorizer: params.authorizer as ConstructorParameters<
      typeof GrievanceFeedbackService
    >[0]['authorizer'],
    linkage: new AllowLinkagePolicyPort(),
    routing: new LabGrievanceRoutingPort(params.catalogue),
    workflow: new OutboxOnlyWorkflowAdvance(),
    tasks: new NoopHumanTaskPort(),
    notification: labNotificationPort,
    config: loadConfig({ SF_ENVIRONMENT: params.environment }),
  });
}

type ContextResolver = (request: FastifyRequest) => Promise<unknown>;

/**
 * Lab-only list endpoints (not in frozen CMP-027 OpenAPI). Fail-closed via service OPA.
 * GET /v1/lab/grievances/mine — citizen filer list
 * GET /v1/lab/grievances/queue — officer/helpdesk queue
 * GET /v1/lab/grievances/catalogue — published category/escalation metadata
 */
export function registerLabGrievanceRoutes(
  app: FastifyInstance,
  opts: {
    service: GrievanceFeedbackService;
    resolveContext: ContextResolver;
    catalogue: LabGrievanceCatalogue;
  },
): void {
  app.get('/v1/lab/grievances/catalogue', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      catalogue: opts.catalogue,
    });
  });

  app.get('/v1/lab/grievances/mine', async (request, reply) => {
    const ctx = await opts.resolveContext(request);
    const limit = (request.query as { limit?: string })?.limit;
    const result = await opts.service.listMine(ctx, limit);
    return reply.code(result.status).header('cache-control', 'no-store').send(result.body);
  });

  app.get('/v1/lab/grievances/queue', async (request, reply) => {
    const ctx = await opts.resolveContext(request);
    const q = request.query as { limit?: string; role_code?: string };
    const result = await opts.service.listQueue(ctx, q);
    return reply.code(result.status).header('cache-control', 'no-store').send(result.body);
  });
}

export function assignmentForLevel(
  catalogue: LabGrievanceCatalogue,
  level: number,
  overrides?: Partial<Assignment>,
): Assignment | null {
  const step = catalogue.escalation.find((e) => e.level === level);
  if (!step) return null;
  return {
    role_code: step.role_code,
    organisation_id: overrides?.organisation_id ?? catalogue.routing.organisation_id,
    office_id: overrides?.office_id ?? catalogue.routing.office_id,
    jurisdiction_id: overrides?.jurisdiction_id ?? catalogue.routing.jurisdiction_id,
    service_scope_id: overrides?.service_scope_id ?? null,
  };
}
