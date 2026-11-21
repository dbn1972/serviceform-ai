import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AuthzDecisionInput,
  AuthzDecisionOutput,
  DeploymentEnvironment,
  EventEnvelope,
  RequestContext,
} from '@serviceform/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { assertSimulatorEnvironment } from './simulators.js';

/**
 * SAMPLE_LAB CMP-013 host adapters (SF-49). Composition only: SIMULATED storage/scanner,
 * upload-policy seed, citizen owner enrichment for session create, and lab put/scan routes.
 * Technical acceptance only — never business verification. CERTIFIED=false. G6=false.
 */

export const SAMPLE_LAB_UPLOAD_POLICY_CODE = 'SAMPLE_LAB_EVIDENCE';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

interface Cmp013Module {
  SimulatedDocumentStorage: new (opts: {
    environment: string;
    testRunId: string;
    connectorBindingId: string;
    secrets: { getHmacKey: (name: string) => Promise<Uint8Array> };
    secretName: string;
    scenario?: string;
  }) => LabStorage;
  SimulatedMalwareScanner: new (opts: {
    environment: string;
    testRunId: string;
    connectorBindingId: string;
    read: (tenantId: string, objectKey: string) => Promise<Uint8Array | null>;
  }) => unknown;
  buildUploadService: (opts: Record<string, unknown>) => LabUploadService;
  UploadService: unknown;
}

export interface LabStorage {
  mode: 'SIMULATED';
  connectorBindingId: string;
  simulation: unknown;
  simulateClientPut: (
    url: string,
    bytes: Uint8Array,
    headers: { 'content-type': string },
    now?: Date,
  ) => Promise<void>;
  readForScan: (tenantId: string, objectKey: string) => Promise<Uint8Array | null>;
  issueUploadTarget: (...args: never[]) => Promise<unknown>;
  inspectObject: (...args: never[]) => Promise<unknown>;
  releaseFromQuarantine: (...args: never[]) => Promise<unknown>;
  discard: (...args: never[]) => Promise<unknown>;
  issueDownloadAccess: (...args: never[]) => Promise<unknown>;
}

export interface LabUploadService {
  createPolicyVersion: (
    ctx: RequestContext,
    input: Record<string, unknown>,
    idem: { key: string; endpoint: string; fingerprint: string },
  ) => Promise<{ status: number; body: unknown }>;
  processScanRequest: (envelope: EventEnvelope<object>) => Promise<string>;
  getDocument: (ctx: RequestContext, documentId: string) => Promise<{ status: string }>;
}

export interface UploadPolicyFixture {
  simulation: string;
  policy_code: string;
  allowed_content_types: string[];
  max_bytes: number;
  session_ttl_seconds: number;
  max_scan_attempts: number;
  classification: 'CITIZEN_PRIVATE' | 'TENANT_SCOPED';
}

interface LabSecrets {
  getHmacKey: (name: string) => Promise<Uint8Array>;
}

/** Stable lab HMAC secret (LOCAL/CI only). Not a production credential. */
export class LabUploadSecrets implements LabSecrets {
  constructor(private readonly key: Uint8Array) {}
  async getHmacKey(): Promise<Uint8Array> {
    return this.key;
  }
}

export function parseUploadPolicyFixture(raw: unknown, environment: string): UploadPolicyFixture {
  assertSimulatorEnvironment(environment);
  if (!raw || typeof raw !== 'object') throw new Error('SF-49: upload policy fixture required');
  const doc = raw as Record<string, unknown>;
  if (doc['simulation'] !== 'SIMULATED') {
    throw new Error('SF-49: upload policy fixture must be SIMULATED');
  }
  const policy_code = String(doc['policy_code'] ?? '');
  if (policy_code !== SAMPLE_LAB_UPLOAD_POLICY_CODE) {
    throw new Error('SF-49: unexpected upload policy_code');
  }
  const allowed = doc['allowed_content_types'];
  if (!Array.isArray(allowed) || allowed.length < 1) {
    throw new Error('SF-49: allowed_content_types required');
  }
  return {
    simulation: 'SIMULATED',
    policy_code,
    allowed_content_types: allowed.map(String),
    max_bytes: Number(doc['max_bytes']),
    session_ttl_seconds: Number(doc['session_ttl_seconds']),
    max_scan_attempts: Number(doc['max_scan_attempts']),
    classification: doc['classification'] === 'TENANT_SCOPED' ? 'TENANT_SCOPED' : 'CITIZEN_PRIVATE',
  };
}

export function loadUploadPolicyFixture(dir: string, environment: string): UploadPolicyFixture {
  return parseUploadPolicyFixture(
    JSON.parse(readFileSync(join(dir, 'upload-policy.json'), 'utf8')) as unknown,
    environment,
  );
}

/**
 * Citizen DOCUMENT_UPLOAD_SESSION_CREATE has no owner yet; inject self as owner_id
 * (same pattern as APPLICATION_CREATE_DRAFT / FORM_EXECUTION_EXECUTE).
 */
export function documentOwnerEnrichingAuthorizer(pdp: AuthorizationPort): AuthorizationPort {
  return {
    async decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
      const resource = input.resource;
      const subject = input.subject;
      if (
        subject.actor_type === 'CITIZEN' &&
        resource.resource_type === 'Document' &&
        input.action === 'DOCUMENT_UPLOAD_SESSION_CREATE' &&
        !resource.owner_id
      ) {
        return pdp.decide({
          ...input,
          resource: { ...resource, owner_id: subject.user_id },
        });
      }
      return pdp.decide(input);
    },
  };
}

export async function composeLabDocumentUpload(opts: {
  environment: DeploymentEnvironment;
  pool: Pool;
  resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  authorizer: AuthorizationPort;
  portalId: string;
  workerActorId: string;
  cmp013: Cmp013Module;
  hmacKeyHex?: string;
}): Promise<{
  mounts: {
    environment: DeploymentEnvironment;
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    storage: LabStorage;
    scanner: unknown;
    workerActorId: string;
  };
  storage: LabStorage;
  service: LabUploadService;
}> {
  assertSimulatorEnvironment(opts.environment);
  const testRunId = `platform-lab-upload-${opts.portalId}`;
  const storageBinding = '01301301-3013-4013-8013-013013013013';
  const scannerBinding = '01301301-3013-4013-8013-013013013014';
  const key = Buffer.from(
    opts.hmacKeyHex ?? createHash('sha256').update(`sf-lab-upload-${opts.portalId}`).digest('hex'),
    'utf8',
  );
  const secrets = new LabUploadSecrets(key);
  const storage = new opts.cmp013.SimulatedDocumentStorage({
    environment: opts.environment,
    testRunId,
    connectorBindingId: storageBinding,
    secrets,
    secretName: 'sf-lab-upload-hmac',
    scenario: 'sample_lab_document_upload',
  });
  const scanner = new opts.cmp013.SimulatedMalwareScanner({
    environment: opts.environment,
    testRunId,
    connectorBindingId: scannerBinding,
    read: (tenantId, objectKey) => storage.readForScan(tenantId, objectKey),
  });
  const authorizer = documentOwnerEnrichingAuthorizer(opts.authorizer);
  const service = opts.cmp013.buildUploadService({
    environment: opts.environment,
    pool: opts.pool,
    resolveContext: opts.resolveContext,
    authorizer,
    storage,
    scanner,
    workerActorId: opts.workerActorId,
  });
  return {
    mounts: {
      environment: opts.environment,
      pool: opts.pool,
      resolveContext: opts.resolveContext,
      authorizer: authorizer as { decide: (input: unknown) => Promise<unknown> },
      storage,
      scanner,
      workerActorId: opts.workerActorId,
    },
    storage,
    service,
  };
}

export async function seedLabUploadPolicy(opts: {
  service: LabUploadService;
  fixture: UploadPolicyFixture;
  ctx: RequestContext;
}): Promise<void> {
  const policyBody = {
    policy_code: opts.fixture.policy_code,
    allowed_content_types: opts.fixture.allowed_content_types,
    max_bytes: opts.fixture.max_bytes,
    session_ttl_seconds: opts.fixture.session_ttl_seconds,
    max_scan_attempts: opts.fixture.max_scan_attempts,
    classification: opts.fixture.classification,
    status: 'ACTIVE' as const,
  };
  // CMP-013 idempotency CHECK requires `sha256:` + 64 hex (same shape as requestFingerprint).
  const fingerprint = `sha256:${createHash('sha256')
    .update(`POST /v1/upload-policies\n${JSON.stringify(policyBody)}`)
    .digest('hex')}`;
  const result = await opts.service.createPolicyVersion(opts.ctx, policyBody, {
    key: `lab-seed-${opts.fixture.policy_code}`,
    endpoint: 'POST /v1/upload-policies',
    fingerprint,
  });
  if (result.status >= 400) {
    throw new Error(
      `SF-49: upload policy seed refused (${result.status}): ${JSON.stringify(result.body)}`,
    );
  }
}

function errorBody(code: string, message: string, correlationId: string) {
  return { error_code: code, message, correlation_id: correlationId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LAB_PUT = 2 * 1024 * 1024;

/**
 * Lab-only SIMULATED object PUT + synchronous scan drain. Never mounts outside LOCAL/CI.
 * Bytes go client → BFF → this route → SimulatedDocumentStorage (never through CMP-013 proxy).
 */
export async function registerLabDocumentUploadSimulators(
  app: FastifyInstance,
  opts: {
    environment: string;
    storage: LabStorage;
    service: LabUploadService;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    placement: { tenant_id: string; cell_id: string };
    workerActorId: string;
  },
): Promise<void> {
  assertSimulatorEnvironment(opts.environment);

  app.post<{ Body: unknown }>('/v1/simulated/document-puts', async (request, reply) => {
    const ctx = await opts.resolveContext(request);
    if (!ctx || ctx.actor.type !== 'CITIZEN') {
      return reply.code(401).send(errorBody('SF-AUTH-001', 'Authentication required', request.id));
    }
    const body = request.body as {
      upload_url?: unknown;
      content_type?: unknown;
      content_base64?: unknown;
    } | null;
    const url = typeof body?.upload_url === 'string' ? body.upload_url : '';
    const contentType = typeof body?.content_type === 'string' ? body.content_type : '';
    const b64 = typeof body?.content_base64 === 'string' ? body.content_base64 : '';
    if (!url.startsWith('sim://upload/') || !contentType || !b64) {
      return reply
        .code(400)
        .send(errorBody('SF-SYS-003', 'SIMULATED put requires upload_url and content', request.id));
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, 'base64');
    } catch {
      return reply.code(400).send(errorBody('SF-SYS-003', 'Invalid content_base64', request.id));
    }
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_LAB_PUT) {
      return reply.code(400).send(errorBody('SF-SYS-003', 'Content size not allowed', request.id));
    }
    try {
      await opts.storage.simulateClientPut(url, bytes, { 'content-type': contentType });
    } catch {
      return reply
        .code(422)
        .send(errorBody('SF-APP-001', 'SIMULATED upload target refused', request.id));
    }
    return reply
      .header('cache-control', 'no-store')
      .send({ simulation: true, accepted: true, byte_size: bytes.byteLength });
  });

  app.post<{ Params: { documentId: string } }>(
    '/v1/simulated/document-scans/:documentId',
    async (request, reply) => {
      const ctx = await opts.resolveContext(request);
      if (!ctx || ctx.actor.type !== 'CITIZEN') {
        return reply
          .code(401)
          .send(errorBody('SF-AUTH-001', 'Authentication required', request.id));
      }
      const documentId = request.params.documentId;
      if (!UUID.test(documentId)) {
        return reply.code(404).send(errorBody('SF-SYS-002', 'Document not found', request.id));
      }
      const doc = await opts.service.getDocument(ctx, documentId).catch(() => null);
      if (!doc) {
        return reply.code(404).send(errorBody('SF-SYS-002', 'Document not found', request.id));
      }
      if (doc.status === 'AVAILABLE' || doc.status === 'REJECTED') {
        return reply
          .header('cache-control', 'no-store')
          .send({ simulation: true, status: doc.status, scan_result: 'SKIPPED' });
      }
      if (doc.status !== 'SCAN_PENDING') {
        return reply
          .code(422)
          .send(errorBody('SF-EVD-002', 'Document is not ready to scan', request.id));
      }
      const envelope: EventEnvelope<object> = {
        event_id: randomUUID(),
        event_type: 'DocumentScanRequested',
        schema_version: 1,
        tenant_id: opts.placement.tenant_id,
        cell_id: opts.placement.cell_id,
        aggregate_type: 'Document',
        aggregate_id: documentId,
        aggregate_version: 1,
        occurred_at: new Date().toISOString(),
        correlation_id: ctx.correlation_id,
        actor: { type: 'SYSTEM', id: opts.workerActorId },
        data: { document_id: documentId, attempt_no: 1 },
      };
      const scan_result = await opts.service.processScanRequest(envelope);
      const after = await opts.service.getDocument(ctx, documentId);
      return reply
        .header('cache-control', 'no-store')
        .send({ simulation: true, status: after.status, scan_result });
    },
  );
}

export function policySeedContext(opts: {
  tenantId: string;
  cellId: string;
  officerId: string;
  roles: string[];
}): RequestContext {
  return {
    tenant_id: opts.tenantId,
    cell_id: opts.cellId,
    actor: { type: 'OFFICER', id: opts.officerId },
    roles: opts.roles,
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: randomUUID().replace(/-/g, ''),
  };
}

export type { Cmp013Module };
