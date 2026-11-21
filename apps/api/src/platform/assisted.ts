import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAssistedSessionService,
  type AssistedSessionService,
  type AssistedVerificationPort,
} from '@serviceform/cmp-057-assisted-service';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';

/**
 * SAMPLE_LAB CMP-057 host adapter (assisted / CSC apply shell).
 * Constitution #36: applied_by (operator) ≠ applied_for (citizen); never impersonate.
 * Consent fail-closed. CERTIFIED=false · G6=false.
 */

export interface LabAssistedChannel {
  code: string;
  label: string;
  description: string;
  requires_representation_authority: boolean;
}

export interface LabAssistedCatalogue {
  default_channel: string;
  channels: readonly LabAssistedChannel[];
  consent: {
    purpose_code: string;
    consent_ref_prefix: string;
    label: string;
    read_back_required: true;
  };
  assurance: { default_ref: string; label: string };
  default_offering_catalogue_id: string;
}

const DEFAULT_CATALOGUE: LabAssistedCatalogue = {
  default_channel: 'CSC',
  channels: [
    {
      code: 'CSC',
      label: 'CSC / common service centre',
      description: 'Operator assists; never impersonates.',
      requires_representation_authority: false,
    },
  ],
  consent: {
    purpose_code: 'SAMPLE_LAB_ASSISTED_APPLY',
    consent_ref_prefix: 'consent:assisted-readback',
    label: 'SAMPLE_LAB assisted apply consent',
    read_back_required: true,
  },
  assurance: {
    default_ref: 'assurance:sample-lab/citizen-present',
    label: 'Citizen present at assisted channel',
  },
  default_offering_catalogue_id: 'IND-SOC-002',
};

export function parseAssistedCatalogue(raw: unknown): LabAssistedCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const channels = Array.isArray(obj['channels'])
    ? (obj['channels'] as LabAssistedChannel[])
    : DEFAULT_CATALOGUE.channels;
  const consentRaw =
    obj['consent'] && typeof obj['consent'] === 'object'
      ? (obj['consent'] as Record<string, unknown>)
      : {};
  const assuranceRaw =
    obj['assurance'] && typeof obj['assurance'] === 'object'
      ? (obj['assurance'] as Record<string, unknown>)
      : {};
  return {
    default_channel:
      typeof obj['default_channel'] === 'string'
        ? obj['default_channel']
        : DEFAULT_CATALOGUE.default_channel,
    channels,
    consent: {
      purpose_code:
        typeof consentRaw['purpose_code'] === 'string'
          ? consentRaw['purpose_code']
          : DEFAULT_CATALOGUE.consent.purpose_code,
      consent_ref_prefix:
        typeof consentRaw['consent_ref_prefix'] === 'string'
          ? consentRaw['consent_ref_prefix']
          : DEFAULT_CATALOGUE.consent.consent_ref_prefix,
      label:
        typeof consentRaw['label'] === 'string'
          ? consentRaw['label']
          : DEFAULT_CATALOGUE.consent.label,
      read_back_required: true,
    },
    assurance: {
      default_ref:
        typeof assuranceRaw['default_ref'] === 'string'
          ? assuranceRaw['default_ref']
          : DEFAULT_CATALOGUE.assurance.default_ref,
      label:
        typeof assuranceRaw['label'] === 'string'
          ? assuranceRaw['label']
          : DEFAULT_CATALOGUE.assurance.label,
    },
    default_offering_catalogue_id:
      typeof obj['default_offering_catalogue_id'] === 'string'
        ? obj['default_offering_catalogue_id']
        : DEFAULT_CATALOGUE.default_offering_catalogue_id,
  };
}

export function loadAssistedCatalogue(dir: string): LabAssistedCatalogue {
  return parseAssistedCatalogue(
    JSON.parse(readFileSync(join(dir, 'assisted-catalogue.json'), 'utf8')) as unknown,
  );
}

/** Fail-closed consent ledger: verifyRepresentation refuses until a lab capture is recorded. */
export class LabAssistedConsentLedger {
  private readonly keys = new Set<string>();

  private key(tenantId: string, citizenId: string, consentRef: string, sessionId: string): string {
    return `${tenantId}:${citizenId.toLowerCase()}:${consentRef}:${sessionId.toLowerCase()}`;
  }

  capture(input: {
    tenant_id: string;
    citizen_id: string;
    consent_ref: string;
    session_id: string;
    read_back_acknowledged: unknown;
  }): { ok: true } | { ok: false; code: string; message: string } {
    if (input.read_back_acknowledged !== true) {
      return {
        ok: false,
        code: 'READ_BACK_ACKNOWLEDGEMENT_REQUIRED',
        message: 'Consent is fail-closed: read-back must be acknowledged before capture',
      };
    }
    if (!input.consent_ref || typeof input.consent_ref !== 'string') {
      return { ok: false, code: 'CONSENT_REF_REQUIRED', message: 'consent_ref is required' };
    }
    this.keys.add(this.key(input.tenant_id, input.citizen_id, input.consent_ref, input.session_id));
    return { ok: true };
  }

  has(tenantId: string, citizenId: string, consentRef: string, sessionId: string): boolean {
    return this.keys.has(this.key(tenantId, citizenId, consentRef, sessionId));
  }
}

export class LabAssistedVerificationPort implements AssistedVerificationPort {
  constructor(
    private readonly applicants: {
      exists: (input: { tenant_id: string; subject_id: string }) => Promise<boolean>;
    },
    private readonly ledger: LabAssistedConsentLedger,
  ) {}

  async applicantInTenant(ctx: { tenant_id: string }, citizenId: string): Promise<boolean> {
    return this.applicants.exists({ tenant_id: ctx.tenant_id, subject_id: citizenId });
  }

  async consentCaptured(
    ctx: { tenant_id: string },
    p: { citizenId: string; consentRef: string; sessionId: string },
  ): Promise<boolean> {
    return this.ledger.has(ctx.tenant_id, p.citizenId, p.consentRef, p.sessionId);
  }
}

type ContextResolver = (request: FastifyRequest) => Promise<unknown>;

interface CaseDraftService {
  createDraft(
    ctx: unknown,
    body: unknown,
    idempotencyKey: unknown,
  ): Promise<{ status: number; body: unknown; replayed?: boolean }>;
}

interface AssistedSessionLike {
  readSession(ctx: unknown, sessionId: string): Promise<{ status: number; body: unknown }>;
  submit(
    ctx: unknown,
    sessionId: string,
    input: { expected_version: number; application_id: string },
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function citizenFilingContext(
  officerCtx: Record<string, unknown>,
  appliedForCitizenId: string,
): Record<string, unknown> {
  // Server-mediated filing: case applicant is applied_for. Operator session cookie is never
  // swapped — applied_by stays on the CMP-057 session (Constitution #36, no impersonation).
  return {
    tenant_id: officerCtx['tenant_id'],
    cell_id: officerCtx['cell_id'],
    actor: { type: 'CITIZEN', id: appliedForCitizenId },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: 'OTP',
    correlation_id: officerCtx['correlation_id'] ?? randomUUID(),
    trace_id: officerCtx['trace_id'] ?? randomUUID().replace(/-/g, ''),
  };
}

export function composeLabAssisted(params: {
  pool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  applicants: {
    exists: (input: { tenant_id: string; subject_id: string }) => Promise<boolean>;
  };
  ledger?: LabAssistedConsentLedger;
}): {
  service: AssistedSessionService;
  ledger: LabAssistedConsentLedger;
  verification: LabAssistedVerificationPort;
} {
  const ledger = params.ledger ?? new LabAssistedConsentLedger();
  const verification = new LabAssistedVerificationPort(params.applicants, ledger);
  const service = buildAssistedSessionService({
    pool: params.pool,
    authorizer: params.authorizer as never,
    verification,
  });
  return { service, ledger, verification };
}

/**
 * Lab-only routes (not in frozen CMP-057 OpenAPI):
 * GET  /v1/lab/assisted/catalogue
 * POST /v1/lab/assisted/sessions/:id/consent — fail-closed capture before VERIFY_REPRESENTATION
 * POST /v1/lab/assisted/sessions/:id/apply — create draft as applied_for + CMP-057 submit link
 */
export function registerLabAssistedRoutes(
  app: FastifyInstance,
  opts: {
    service: AssistedSessionLike;
    resolveContext: ContextResolver;
    catalogue: LabAssistedCatalogue;
    ledger: LabAssistedConsentLedger;
    applicationCase: CaseDraftService;
    offerings: readonly { catalogue_id: string; tenant_service_binding_id: string }[];
  },
): void {
  app.get('/v1/lab/assisted/catalogue', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      constitution: 36,
      impersonation_forbidden: true,
      catalogue: opts.catalogue,
    });
  });

  app.post('/v1/lab/assisted/sessions/:session_id/consent', async (request, reply) => {
    const ctx = (await opts.resolveContext(request)) as Record<string, unknown> | null;
    if (!ctx || (ctx['actor'] as { type?: string } | undefined)?.type !== 'OFFICER') {
      return reply
        .code(401)
        .header('cache-control', 'no-store')
        .send({ error_code: 'SF-AUTH-001', message: 'Officer session required' });
    }
    const sessionId = String((request.params as { session_id?: string }).session_id ?? '');
    const read = await opts.service.readSession(ctx, sessionId);
    if (read.status !== 200) {
      return reply.code(read.status).header('cache-control', 'no-store').send(read.body);
    }
    const view = asRecord(read.body);
    const session = asRecord(view['assisted_session']);
    const appliedFor = String(session['applied_for_citizen_id'] ?? '');
    const appliedBy = String(session['applied_by_actor_id'] ?? '');
    const actorId = String((ctx['actor'] as { id?: string }).id ?? '');
    if (appliedBy.toLowerCase() !== actorId.toLowerCase()) {
      return reply.code(403).header('cache-control', 'no-store').send({
        error_code: 'SF-AUTH-002',
        message: 'Only the session operator (applied_by) may capture consent',
      });
    }
    if (appliedBy.toLowerCase() === appliedFor.toLowerCase()) {
      return reply.code(403).header('cache-control', 'no-store').send({
        error_code: 'SF-AUTH-002',
        message: 'applied_by must be distinct from applied_for (Constitution #36)',
      });
    }
    const body = asRecord(request.body);
    const consentRef =
      typeof body['consent_ref'] === 'string'
        ? body['consent_ref']
        : `${opts.catalogue.consent.consent_ref_prefix}/${sessionId.slice(0, 8)}`;
    const captured = opts.ledger.capture({
      tenant_id: String(ctx['tenant_id']),
      citizen_id: appliedFor,
      consent_ref: consentRef,
      session_id: sessionId,
      read_back_acknowledged: body['read_back_acknowledged'],
    });
    if (!captured.ok) {
      return reply
        .code(400)
        .header('cache-control', 'no-store')
        .send({
          error_code: 'SF-SYS-003',
          message: captured.message,
          details: [{ code: captured.code }],
          certified: false,
          g6_issued: false,
        });
    }
    return reply.header('cache-control', 'no-store').send({
      captured: true,
      consent_ref: consentRef,
      applied_for_citizen_id: appliedFor,
      applied_by_actor_id: appliedBy,
      applied_by_distinct_from_applied_for: true,
      certified: false,
      g6_issued: false,
    });
  });

  app.post('/v1/lab/assisted/sessions/:session_id/apply', async (request, reply) => {
    const ctx = (await opts.resolveContext(request)) as Record<string, unknown> | null;
    if (!ctx || (ctx['actor'] as { type?: string } | undefined)?.type !== 'OFFICER') {
      return reply
        .code(401)
        .header('cache-control', 'no-store')
        .send({ error_code: 'SF-AUTH-001', message: 'Officer session required' });
    }
    const sessionId = String((request.params as { session_id?: string }).session_id ?? '');
    const read = await opts.service.readSession(ctx, sessionId);
    if (read.status !== 200) {
      return reply.code(read.status).header('cache-control', 'no-store').send(read.body);
    }
    const view = asRecord(read.body);
    const session = asRecord(view['assisted_session']);
    const status = String(session['lifecycle_status'] ?? '');
    if (status !== 'REPRESENTATION_VERIFIED') {
      return reply
        .code(409)
        .header('cache-control', 'no-store')
        .send({
          error_code: 'SF-APP-001',
          message: 'Consent and representation must be verified before assisted apply',
          details: [{ code: 'CONSENT_OR_REPRESENTATION_REQUIRED' }],
          certified: false,
          g6_issued: false,
        });
    }
    const appliedFor = String(session['applied_for_citizen_id'] ?? '');
    const appliedBy = String(session['applied_by_actor_id'] ?? '');
    const actorId = String((ctx['actor'] as { id?: string }).id ?? '');
    if (appliedBy.toLowerCase() !== actorId.toLowerCase()) {
      return reply.code(403).header('cache-control', 'no-store').send({
        error_code: 'SF-AUTH-002',
        message: 'Only the session operator (applied_by) may file assisted apply',
      });
    }
    if (appliedBy.toLowerCase() === appliedFor.toLowerCase()) {
      return reply.code(403).header('cache-control', 'no-store').send({
        error_code: 'SF-AUTH-002',
        message: 'applied_by must be distinct from applied_for (Constitution #36)',
      });
    }

    const body = asRecord(request.body);
    const catalogueId =
      typeof body['catalogue_id'] === 'string'
        ? body['catalogue_id']
        : opts.catalogue.default_offering_catalogue_id;
    const offering = opts.offerings.find((o) => o.catalogue_id === catalogueId);
    if (!offering) {
      return reply.code(404).header('cache-control', 'no-store').send({
        error_code: 'SF-SYS-002',
        message: 'Service not offered in SAMPLE_LAB placement',
      });
    }

    const citizenCtx = citizenFilingContext(ctx, appliedFor);
    const draftKey = `lab-assisted-draft-${sessionId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    const draft = await opts.applicationCase.createDraft(
      citizenCtx,
      { tenant_service_binding_id: offering.tenant_service_binding_id },
      draftKey,
    );
    const draftBody = asRecord(draft.body);
    const application = asRecord(draftBody['application']);
    const applicationId = String(application['application_id'] ?? '');
    if (draft.status !== 201 || !applicationId) {
      return reply
        .code(draft.status >= 400 ? draft.status : 502)
        .header('cache-control', 'no-store')
        .send({
          error_code: 'SF-SYS-001',
          message: 'Assisted draft create refused',
          upstream: draftBody,
          certified: false,
          g6_issued: false,
        });
    }

    const expectedVersion =
      typeof view['session_version'] === 'number' ? view['session_version'] : 0;
    const submit = await opts.service.submit(
      ctx,
      sessionId,
      { expected_version: expectedVersion, application_id: applicationId },
      {
        key: `lab-assisted-submit-${sessionId.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
        fingerprint: `submit:${sessionId}:${applicationId}`,
        endpoint: 'POST /v1/assisted/sessions/:session_id/submit',
      },
    );
    if (submit.status !== 200) {
      return reply.code(submit.status).header('cache-control', 'no-store').send(submit.body);
    }

    return reply
      .code(201)
      .header('cache-control', 'no-store')
      .send({
        application_id: applicationId,
        catalogue_id: catalogueId,
        assisted_session: asRecord(submit.body)['assisted_session'],
        proof: {
          applied_by_actor_id: appliedBy,
          applied_for_citizen_id: appliedFor,
          applied_by_distinct_from_applied_for: true,
          channel: session['channel'],
          impersonation: false,
          constitution: 36,
        },
        source: 'SAMPLE_LAB',
        certified: false,
        g6_issued: false,
      });
  });
}
