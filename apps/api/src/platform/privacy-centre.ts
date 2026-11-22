import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPrivacyCentreService,
  type PrivacyCentreService,
} from '@serviceform/cmp-061-privacy-centre';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';

/**
 * SAMPLE_LAB CMP-061 privacy centre host adapter.
 * Mounts existing createPrivacyApi via m09 + lab catalogue route.
 * Consent/purpose visibility uses CMP-030 (already mounted); retention posture is catalogue
 * visibility only (CMP-049: citizens never reach retention APIs; periods POLICY_INPUT_REQUIRED).
 * CERTIFIED=false · G6=false · no DigiLocker/SMS/Payment · no invented statute.
 */

export interface LabPrivacyRequestType {
  code: string;
  label: string;
  description: string;
}

export interface LabPrivacyScopeTemplate {
  owner_component: string;
  scope_ref: string;
  label: string;
}

export interface LabPrivacyRetentionEntry {
  owner_component: string;
  resource_kind: string;
  period_ref_status: string;
  eligibility: string;
}

export interface LabPrivacyCatalogue {
  simulation: 'SIMULATED';
  request_types: readonly LabPrivacyRequestType[];
  scope_templates: readonly LabPrivacyScopeTemplate[];
  retention: {
    visibility: string;
    invented_statutory_period_forbidden: true;
    citizen_archive_delete_forbidden: true;
    note: string;
    entries: readonly LabPrivacyRetentionEntry[];
  };
}

const DEFAULT_CATALOGUE: LabPrivacyCatalogue = {
  simulation: 'SIMULATED',
  request_types: [
    {
      code: 'ACCESS',
      label: 'Access my data',
      description: 'Ask owning components for a copy of data in scope',
    },
    {
      code: 'CONSENT_WITHDRAWAL',
      label: 'Withdraw consent',
      description: 'Request withdrawal of a granted purpose consent',
    },
  ],
  scope_templates: [
    {
      owner_component: 'CMP-030',
      scope_ref: 'consent.purpose.SAMPLE_LAB_PROFILE_PREFILL',
      label: 'Profile prefill consent (CMP-030)',
    },
  ],
  retention: {
    visibility: 'POLICY_INPUT_REQUIRED',
    invented_statutory_period_forbidden: true,
    citizen_archive_delete_forbidden: true,
    note: 'Retention periods are owner-supplied opaque refs. ARCHIVE/DELETE fail closed until bound.',
    entries: [
      {
        owner_component: 'CMP-015',
        resource_kind: 'ApplicationCase',
        period_ref_status: 'UNBOUND',
        eligibility: 'ACTIVE_ONLY_UNTIL_OWNER_PERIOD',
      },
    ],
  },
};

export function parsePrivacyCatalogue(raw: unknown): LabPrivacyCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const retentionRaw =
    obj['retention'] && typeof obj['retention'] === 'object'
      ? (obj['retention'] as Record<string, unknown>)
      : {};
  return {
    simulation: 'SIMULATED',
    request_types: Array.isArray(obj['request_types'])
      ? (obj['request_types'] as LabPrivacyRequestType[])
      : DEFAULT_CATALOGUE.request_types,
    scope_templates: Array.isArray(obj['scope_templates'])
      ? (obj['scope_templates'] as LabPrivacyScopeTemplate[])
      : DEFAULT_CATALOGUE.scope_templates,
    retention: {
      visibility:
        typeof retentionRaw['visibility'] === 'string'
          ? retentionRaw['visibility']
          : DEFAULT_CATALOGUE.retention.visibility,
      invented_statutory_period_forbidden: true,
      citizen_archive_delete_forbidden: true,
      note:
        typeof retentionRaw['note'] === 'string'
          ? retentionRaw['note']
          : DEFAULT_CATALOGUE.retention.note,
      entries: Array.isArray(retentionRaw['entries'])
        ? (retentionRaw['entries'] as LabPrivacyRetentionEntry[])
        : DEFAULT_CATALOGUE.retention.entries,
    },
  };
}

export function loadPrivacyCatalogue(dir: string): LabPrivacyCatalogue {
  return parsePrivacyCatalogue(
    JSON.parse(readFileSync(join(dir, 'privacy-catalogue.json'), 'utf8')) as unknown,
  );
}

export function composeLabPrivacyCentre(params: {
  pool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
}): { service: PrivacyCentreService } {
  const service = buildPrivacyCentreService({
    pool: params.pool,
    authorizer: params.authorizer as never,
  });
  return { service };
}

/**
 * Lab-only route (not in frozen CMP-061 OpenAPI):
 * GET /v1/lab/privacy/catalogue — published request types, scope templates, retention posture.
 */
export function registerLabPrivacyCentreRoutes(
  app: FastifyInstance,
  opts: {
    catalogue: LabPrivacyCatalogue;
    resolveContext: (request: FastifyRequest) => Promise<unknown>;
  },
): void {
  app.get('/v1/lab/privacy/catalogue', async (request, reply) => {
    const ctx = (await opts.resolveContext(request)) as {
      actor?: { type?: string };
    } | null;
    if (!ctx || ctx.actor?.type !== 'CITIZEN') {
      return reply
        .code(401)
        .header('cache-control', 'no-store')
        .send({ error_code: 'SF-AUTH-001', message: 'Citizen session required' });
    }
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      invented_statutory_policy_forbidden: true,
      cross_component_direct_mutation_forbidden: true,
      owner_task_orchestration_only: true,
      catalogue: opts.catalogue,
    });
  });
}
