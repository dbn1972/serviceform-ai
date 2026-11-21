import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  InspectionService,
  PgInspectionRepository,
  noopCaseCommand,
  type CaseCommandPort,
  type InspectionServiceDeps,
} from '@serviceform/cmp-018-inspection-verification';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

/**
 * SAMPLE_LAB CMP-018 host adapter (inspection / verification desk).
 * Mounts existing createInspectionHandler via m05 + lab catalogue route.
 * Metadata-driven pins only — no named-service forks. CERTIFIED=false · G6=false.
 */

const NODE_ID = /^[A-Z][A-Z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LabInspectionChecklistItem {
  code: string;
  label: string;
  required: boolean;
}

export interface LabInspectionPin {
  pin_code: string;
  catalogue_id: string | null;
  label: string;
  description: string;
  workflow_node_id: string;
  checklist_items: readonly LabInspectionChecklistItem[];
}

export interface LabInspectionCatalogue {
  assignment_defaults: {
    role_code: string;
    organisation_id: string;
    jurisdiction_id: string;
    office_id: string | null;
  };
  verification_results: readonly { code: string; label: string; description: string }[];
  pins: readonly LabInspectionPin[];
}

const DEFAULT_ASSIGNMENT = {
  role_code: 'SAMPLE_LAB_INSPECTION_OFFICER',
  organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
  jurisdiction_id: '0d15ba00-0b01-4000-8000-0d15ba000b01',
  office_id: null as string | null,
};

const DEFAULT_RESULTS = [
  {
    code: 'VERIFIED',
    label: 'Verified',
    description: 'Non-statutory site/evidence verification passed',
  },
  {
    code: 'NOT_VERIFIED',
    label: 'Not verified',
    description: 'Non-statutory verification failed',
  },
  {
    code: 'INCONCLUSIVE',
    label: 'Inconclusive',
    description: 'Verification could not be completed',
  },
  {
    code: 'DEFICIENCY_NOTED',
    label: 'Deficiency noted',
    description: 'Verification recorded a deficiency for follow-up (not statutory reject)',
  },
] as const;

export function parseInspectionCatalogue(raw: unknown): LabInspectionCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const assignmentRaw =
    obj['assignment_defaults'] && typeof obj['assignment_defaults'] === 'object'
      ? (obj['assignment_defaults'] as Record<string, unknown>)
      : {};
  const organisation_id =
    typeof assignmentRaw['organisation_id'] === 'string' &&
    UUID.test(assignmentRaw['organisation_id'])
      ? assignmentRaw['organisation_id']
      : DEFAULT_ASSIGNMENT.organisation_id;
  const jurisdiction_id =
    typeof assignmentRaw['jurisdiction_id'] === 'string' &&
    UUID.test(assignmentRaw['jurisdiction_id'])
      ? assignmentRaw['jurisdiction_id']
      : DEFAULT_ASSIGNMENT.jurisdiction_id;
  const role_code =
    typeof assignmentRaw['role_code'] === 'string' && assignmentRaw['role_code'].length > 0
      ? assignmentRaw['role_code']
      : DEFAULT_ASSIGNMENT.role_code;
  const office_id =
    typeof assignmentRaw['office_id'] === 'string' && UUID.test(assignmentRaw['office_id'])
      ? assignmentRaw['office_id']
      : null;

  const pinsRaw = Array.isArray(obj['pins']) ? obj['pins'] : [];
  const pins: LabInspectionPin[] = [];
  for (const entry of pinsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string, unknown>;
    const pin_code = typeof p['pin_code'] === 'string' ? p['pin_code'] : '';
    const workflow_node_id = typeof p['workflow_node_id'] === 'string' ? p['workflow_node_id'] : '';
    if (!pin_code || !NODE_ID.test(workflow_node_id)) continue;
    const checklist_items = Array.isArray(p['checklist_items'])
      ? (p['checklist_items'] as LabInspectionChecklistItem[]).filter(
          (i) => i && typeof i.code === 'string' && typeof i.label === 'string',
        )
      : [];
    pins.push({
      pin_code,
      catalogue_id: typeof p['catalogue_id'] === 'string' ? p['catalogue_id'] : null,
      label: typeof p['label'] === 'string' ? p['label'] : pin_code,
      description: typeof p['description'] === 'string' ? p['description'] : '',
      workflow_node_id,
      checklist_items,
    });
  }

  const verification_results = Array.isArray(obj['verification_results'])
    ? (obj['verification_results'] as LabInspectionCatalogue['verification_results'])
    : DEFAULT_RESULTS;

  return {
    assignment_defaults: { role_code, organisation_id, jurisdiction_id, office_id },
    verification_results,
    pins,
  };
}

export function loadInspectionCatalogue(dir: string): LabInspectionCatalogue {
  return parseInspectionCatalogue(
    JSON.parse(readFileSync(join(dir, 'inspection-catalogue.json'), 'utf8')) as unknown,
  );
}

export function pinByCode(
  catalogue: LabInspectionCatalogue,
  pinCode: string,
): LabInspectionPin | null {
  return catalogue.pins.find((p) => p.pin_code === pinCode) ?? null;
}

/** Assignment from published catalogue defaults — never named officers. */
export function assignmentFromCatalogue(
  catalogue: LabInspectionCatalogue,
  overrides?: { service_scope_id?: string | null },
): {
  role_code: string;
  organisation_id: string;
  office_id: string | null;
  jurisdiction_id: string;
  service_scope_id: string | null;
} {
  return {
    role_code: catalogue.assignment_defaults.role_code,
    organisation_id: catalogue.assignment_defaults.organisation_id,
    office_id: catalogue.assignment_defaults.office_id,
    jurisdiction_id: catalogue.assignment_defaults.jurisdiction_id,
    service_scope_id: overrides?.service_scope_id ?? null,
  };
}

/**
 * Widens TENANT_WIDE inspection desk officers to the lab org/jurisdiction used on
 * catalogue assignment pins (same pattern as SF-46 HUMAN_TASK scope).
 */
export function labInspectionScopePort(catalogue: LabInspectionCatalogue): {
  extend(ctx: {
    actor: { type: string };
    roles: readonly string[];
  }): Promise<{ organisation_ids?: string[]; jurisdiction_ids?: string[] }>;
} {
  const org = catalogue.assignment_defaults.organisation_id;
  const jur = catalogue.assignment_defaults.jurisdiction_id;
  const role = catalogue.assignment_defaults.role_code;
  return {
    async extend(ctx) {
      if (ctx.actor.type !== 'OFFICER') return {};
      if (!ctx.roles.includes(role) && !ctx.roles.includes('SAMPLE_LAB_CASE_OFFICER')) {
        return {};
      }
      return { organisation_ids: [org], jurisdiction_ids: [jur] };
    },
  };
}

export function composeLabInspection(params: {
  pool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  catalogue: LabInspectionCatalogue;
  caseCommands?: CaseCommandPort;
}): InspectionService {
  const deps: InspectionServiceDeps = {
    repo: new PgInspectionRepository(params.pool),
    authz: params.authorizer as InspectionServiceDeps['authz'],
    scopes: labInspectionScopePort(params.catalogue),
    caseCommands: params.caseCommands ?? noopCaseCommand,
  };
  return new InspectionService(deps);
}

/**
 * Lab-only catalogue endpoint (not in frozen CMP-018 OpenAPI — no CCR).
 * GET /v1/lab/inspections/catalogue — published pins + result codes
 */
export function registerLabInspectionRoutes(
  app: FastifyInstance,
  opts: { catalogue: LabInspectionCatalogue },
): void {
  app.get('/v1/lab/inspections/catalogue', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      catalogue: opts.catalogue,
    });
  });
}

export { noopCaseCommand };
