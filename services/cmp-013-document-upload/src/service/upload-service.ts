import { randomBytes, randomUUID } from 'node:crypto';
import {
  validate,
  type AuthzDecisionInput,
  type EventEnvelope,
  type RequestContext,
  type SimulationMarker,
} from '@serviceform/contracts';
import { appendAudit } from '../audit.js';
import { authorize, subjectOf, type AuthorizationPort } from '../authz.js';
import { documentObjectKey } from '../domain/object-key.js';
import {
  assertDeclarationAllowed,
  assertPolicyDefinition,
  assertPolicyUsable,
  evaluateObserved,
  type DocumentClassification,
  type UploadPolicy,
} from '../domain/policy.js';
import { isUsableAsEvidence, type ScanVerdict } from '../domain/states.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp013Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { MalwareScanPort } from '../ports/scan-port.js';
import type { DocumentStoragePort, DownloadAccess, UploadTarget } from '../ports/storage-port.js';
import type { DocumentRow, SessionRow, UploadRepository, UploadTx } from '../repo/types.js';

export const SCAN_CONSUMER_GROUP = 'cmp-013-scan';
const ENGINE_REF = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export type TenantContext = RequestContext & { tenant_id: string };

export interface UploadServiceDeps {
  repo: UploadRepository;
  storage: DocumentStoragePort;
  scanner: MalwareScanPort;
  authorizer: AuthorizationPort;
  clock: () => Date;
  downloadTtlSeconds: number;
  /** Workload identity used for scan-worker audit/outbox rows. */
  workerActorId: string;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface PolicyInput {
  policy_code: string;
  allowed_content_types: string[];
  max_bytes: number;
  session_ttl_seconds: number;
  max_scan_attempts: number;
  classification: DocumentClassification;
  status?: 'ACTIVE' | 'RETIRED';
}

export interface SessionInput {
  policy_code: string;
  content_type: string;
  byte_size: number;
  checksum_sha256: string;
  application_ref?: string;
}

export interface DocumentView {
  document_id: string;
  status: DocumentRow['status'];
  technically_accepted: boolean;
  classification: DocumentClassification;
  application_ref: string | null;
  policy_id: string;
  declared_content_type: string;
  content_type: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  rejection_code: string | null;
  scan_attempts: number;
  storage_mode: DocumentRow['storage_mode'];
  created_at: string;
  updated_at: string;
  simulation?: SimulationMarker;
}

export type ScanResult = 'AVAILABLE' | 'REJECTED' | 'RETRY' | 'DUPLICATE' | 'SKIPPED';

interface ScanAttempt {
  verdict: ScanVerdict;
  engine_ref: string;
  simulation: SimulationMarker | null;
}

export function documentView(doc: DocumentRow): DocumentView {
  const view: DocumentView = {
    document_id: doc.document_id,
    status: doc.status,
    technically_accepted: isUsableAsEvidence(doc.status),
    classification: doc.classification,
    application_ref: doc.application_ref,
    policy_id: doc.policy_id,
    declared_content_type: doc.declared_content_type,
    content_type: doc.detected_content_type,
    byte_size: doc.byte_size,
    checksum_sha256: doc.checksum_sha256,
    rejection_code: doc.rejection_code,
    scan_attempts: doc.scan_attempts,
    storage_mode: doc.storage_mode,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
  if (doc.storage_simulation) view.simulation = doc.storage_simulation;
  return view;
}

function policyView(p: UploadPolicy): UploadPolicy {
  return {
    policy_id: p.policy_id,
    policy_code: p.policy_code,
    version_no: p.version_no,
    status: p.status,
    allowed_content_types: [...p.allowed_content_types],
    max_bytes: p.max_bytes,
    session_ttl_seconds: p.session_ttl_seconds,
    max_scan_attempts: p.max_scan_attempts,
    classification: p.classification,
  };
}

export class UploadService {
  constructor(private readonly d: UploadServiceDeps) {}

  /** Every port/PDP call goes through here: refused inside an open authoritative transaction. */
  private async external<T>(code: string, fn: () => Promise<T>): Promise<T> {
    if (this.d.repo.inTransaction()) {
      throw new Cmp013Error('SF-SYS-001', detail('EXTERNAL_CALL_IN_TRANSACTION'));
    }
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Cmp013Error) throw err;
      throw new Cmp013Error('SF-INT-001', { details: [{ code }], cause: err });
    }
  }

  /** Cleanup that must never undo a committed decision; a quarantined object is never usable. */
  private async bestEffort(fn: () => Promise<void>): Promise<void> {
    try {
      await this.external('STORAGE_UNAVAILABLE', fn);
    } catch {
      /* object remains quarantined and unreachable through CMP-013 */
    }
  }

  private async decide(
    ctx: TenantContext,
    action: string,
    resource: Omit<AuthzDecisionInput['resource'], 'tenant_id'>,
  ): Promise<void> {
    await this.external('PDP_UNAVAILABLE', () =>
      authorize(this.d.authorizer, {
        subject: subjectOf(ctx),
        resource: { ...resource, tenant_id: ctx.tenant_id },
        action,
      }),
    );
  }

  private documentResource(doc: DocumentRow): Omit<AuthzDecisionInput['resource'], 'tenant_id'> {
    return {
      resource_type: 'Document',
      classification: doc.classification,
      owner_id: doc.owner_actor_id,
      ...(doc.application_ref ? { application_id: doc.application_ref } : {}),
    };
  }

  private async emit(
    tx: UploadTx,
    ctx: TenantContext,
    eventType: DomainEventType,
    documentId: string,
    version: number,
    data: object,
  ): Promise<void> {
    const env = envelopeOf({
      eventType,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'Document',
      aggregateId: documentId,
      aggregateVersion: version,
      occurredAt: this.d.clock().toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data,
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
  }

  private async load(
    ctx: TenantContext,
    documentId: string,
  ): Promise<{ doc: DocumentRow; session: SessionRow | null; policy: UploadPolicy | null }> {
    if (!isUuid(documentId)) throw new Cmp013Error('SF-SYS-003', detail('DOCUMENT_ID'));
    const found = await this.d.repo.withTx(ctx, async (tx) => {
      const doc = await tx.getDocument(documentId);
      if (!doc) return null;
      return {
        doc,
        session: await tx.getSessionForDocument(documentId),
        policy: await tx.policyById(doc.policy_id),
      };
    });
    if (!found) throw new Cmp013Error('SF-SYS-002');
    return found;
  }

  async createPolicyVersion(
    ctx: TenantContext,
    input: PolicyInput,
    idem: Idempotency,
  ): Promise<{ status: number; body: unknown }> {
    await this.decide(ctx, 'UPLOAD_POLICY_WRITE', {
      resource_type: 'UploadPolicy',
      classification: 'TENANT_SCOPED',
    });
    assertPolicyDefinition(input);
    return this.d.repo.withTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now: this.d.clock(),
      });
      if (claim !== 'claimed') return claim;
      const latest = await tx.latestPolicy(input.policy_code);
      const policy: UploadPolicy = {
        policy_id: randomUUID(),
        policy_code: input.policy_code,
        version_no: (latest?.version_no ?? 0) + 1,
        status: input.status ?? 'ACTIVE',
        allowed_content_types: [...new Set(input.allowed_content_types)],
        max_bytes: input.max_bytes,
        session_ttl_seconds: input.session_ttl_seconds,
        max_scan_attempts: input.max_scan_attempts,
        classification: input.classification,
      };
      await tx.insertPolicy({ ...policy, created_by: ctx.actor.id });
      await appendAudit(tx, ctx, {
        action: 'UPLOAD_POLICY_WRITE',
        actionClass: 'WRITE',
        resourceType: 'UploadPolicy',
        resourceId: policy.policy_id,
        result: 'SUCCESS',
        now: this.d.clock(),
      });
      const result = { status: 201, body: policyView(policy) };
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        ...result,
      });
      return result;
    });
  }

  async getActivePolicy(ctx: TenantContext, policyCode: string): Promise<UploadPolicy> {
    await this.decide(ctx, 'UPLOAD_POLICY_READ', {
      resource_type: 'UploadPolicy',
      classification: 'TENANT_SCOPED',
    });
    const policy = await this.d.repo.withTx(ctx, (tx) => tx.latestPolicy(policyCode));
    if (!policy) throw new Cmp013Error('SF-SYS-002');
    return policyView(policy);
  }

  async createUploadSession(
    ctx: TenantContext,
    input: SessionInput,
    idem: Idempotency,
  ): Promise<{ status: number; body: Record<string, unknown> & { upload: UploadTarget | null } }> {
    await this.decide(ctx, 'DOCUMENT_UPLOAD_SESSION_CREATE', {
      resource_type: 'Document',
      ...(input.application_ref ? { application_id: input.application_ref } : {}),
    });
    if (this.d.storage.mode === 'SIMULATED' && !this.d.storage.simulation) {
      throw new Cmp013Error('SF-INT-001', detail('SIMULATION_MARKER_REQUIRED'));
    }
    const stored = await this.d.repo.withTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now: this.d.clock(),
      });
      if (claim !== 'claimed') return claim;
      const policy = assertPolicyUsable(await tx.latestPolicy(input.policy_code));
      assertDeclarationAllowed(policy, input);
      const now = this.d.clock();
      const documentId = randomUUID();
      const sessionId = randomUUID();
      const expiresAt = new Date(now.getTime() + policy.session_ttl_seconds * 1000);
      const objectRef = documentObjectKey({
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        documentId,
        checksumSha256: input.checksum_sha256,
      });
      await tx.insertDocument({
        tenant_id: ctx.tenant_id,
        document_id: documentId,
        cell_id: ctx.cell_id,
        policy_id: policy.policy_id,
        classification: policy.classification,
        application_ref: input.application_ref ?? null,
        owner_actor_id: ctx.actor.id,
        owner_actor_type: ctx.actor.type,
        declared_content_type: input.content_type,
        declared_byte_size: input.byte_size,
        declared_checksum_sha256: input.checksum_sha256,
        object_ref: objectRef,
        storage_mode: this.d.storage.mode,
        storage_simulation: this.d.storage.simulation ?? null,
        now: now.toISOString(),
      });
      await tx.insertSession({
        session_id: sessionId,
        document_id: documentId,
        expires_at: expiresAt.toISOString(),
        created_by: ctx.actor.id,
        created_at: now.toISOString(),
      });
      await appendAudit(tx, ctx, {
        action: 'DOCUMENT_UPLOAD_SESSION_CREATE',
        actionClass: 'WRITE',
        resourceType: 'Document',
        resourceId: documentId,
        result: 'SUCCESS',
        now,
      });
      const result = {
        status: 201,
        body: {
          session_id: sessionId,
          document_id: documentId,
          session_status: 'OPEN',
          document_status: 'PENDING_UPLOAD',
          policy_id: policy.policy_id,
          policy_version: policy.version_no,
          expires_at: expiresAt.toISOString(),
          storage_mode: this.d.storage.mode,
        },
      };
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        ...result,
      });
      return result;
    });
    const body = stored.body as Record<string, unknown> & { document_id: string };
    const current = await this.load(ctx, body.document_id);
    const now = this.d.clock();
    let upload: UploadTarget | null = null;
    if (
      current.session?.status === 'OPEN' &&
      current.doc.status === 'PENDING_UPLOAD' &&
      now.getTime() < Date.parse(current.session.expires_at)
    ) {
      const doc = current.doc;
      const expiresAt = new Date(current.session.expires_at);
      upload = await this.external('STORAGE_UNAVAILABLE', () =>
        this.d.storage.issueUploadTarget({
          tenantId: ctx.tenant_id,
          objectKey: doc.object_ref,
          contentType: doc.declared_content_type,
          byteSize: doc.declared_byte_size,
          checksumSha256: doc.declared_checksum_sha256,
          expiresAt,
        }),
      );
    }
    return { status: stored.status, body: { ...body, upload } };
  }

  private async rejectPending(
    ctx: TenantContext,
    documentId: string,
    code: string,
    sessionStatus: 'EXPIRED' | 'REJECTED',
    observed?: { byte_size: number; checksum_sha256: string },
  ): Promise<DocumentRow | null> {
    return this.d.repo.withTx(ctx, async (tx) => {
      const doc = await tx.getDocument(documentId, true);
      const session = await tx.getSessionForDocument(documentId, true);
      if (!doc || !session || doc.status !== 'PENDING_UPLOAD' || session.status !== 'OPEN') {
        return doc;
      }
      const now = this.d.clock();
      const version = await tx.updateDocument(documentId, {
        status: 'REJECTED',
        rejection_code: code,
        ...(observed ?? {}),
        now: now.toISOString(),
      });
      await tx.closeSession(session.session_id, sessionStatus, now.toISOString());
      await this.emit(tx, ctx, 'DocumentRejected', documentId, version, {
        document_id: documentId,
        rejection_code: code,
      });
      await appendAudit(tx, ctx, {
        action: 'DOCUMENT_UPLOAD_COMPLETE',
        actionClass: 'WRITE',
        resourceType: 'Document',
        resourceId: documentId,
        result: 'FAILED',
        reason: code,
        now,
      });
      return tx.getDocument(documentId);
    });
  }

  async completeUpload(ctx: TenantContext, documentId: string): Promise<DocumentView> {
    const { doc, session, policy } = await this.load(ctx, documentId);
    await this.decide(ctx, 'DOCUMENT_UPLOAD_COMPLETE', this.documentResource(doc));
    if (doc.status === 'SCAN_PENDING' || doc.status === 'AVAILABLE') return documentView(doc);
    if (doc.status === 'REJECTED') {
      throw new Cmp013Error('SF-EVD-002', detail(doc.rejection_code ?? 'REJECTED'));
    }
    if (!session || session.status !== 'OPEN' || !policy) {
      throw new Cmp013Error('SF-APP-001', detail('UPLOAD_SESSION_CLOSED'));
    }
    if (this.d.clock().getTime() >= Date.parse(session.expires_at)) {
      await this.rejectPending(ctx, documentId, 'UPLOAD_ABANDONED', 'EXPIRED');
      await this.bestEffort(() =>
        this.d.storage.discard({ tenantId: ctx.tenant_id, objectKey: doc.object_ref }),
      );
      throw new Cmp013Error('SF-APP-001', detail('UPLOAD_SESSION_EXPIRED'));
    }
    const inspection = await this.external('STORAGE_UNAVAILABLE', () =>
      this.d.storage.inspectObject({ tenantId: ctx.tenant_id, objectKey: doc.object_ref }),
    );
    if (!inspection) throw new Cmp013Error('SF-APP-001', detail('OBJECT_NOT_UPLOADED'));
    const verdict = evaluateObserved(
      policy,
      {
        content_type: doc.declared_content_type,
        byte_size: doc.declared_byte_size,
        checksum_sha256: doc.declared_checksum_sha256,
      },
      inspection,
    );
    const observed = {
      byte_size: inspection.byte_size,
      checksum_sha256: inspection.checksum_sha256.toLowerCase(),
    };
    if (!verdict.ok) {
      const after = await this.rejectPending(ctx, documentId, verdict.code, 'REJECTED', observed);
      await this.bestEffort(() =>
        this.d.storage.discard({ tenantId: ctx.tenant_id, objectKey: doc.object_ref }),
      );
      if (after && after.status !== 'REJECTED') return documentView(after);
      throw new Cmp013Error('SF-EVD-002', detail(verdict.code));
    }
    const after = await this.d.repo.withTx(ctx, async (tx) => {
      const locked = await tx.getDocument(documentId, true);
      const lockedSession = await tx.getSessionForDocument(documentId, true);
      if (
        !locked ||
        !lockedSession ||
        locked.status !== 'PENDING_UPLOAD' ||
        lockedSession.status !== 'OPEN'
      ) {
        return locked;
      }
      const now = this.d.clock();
      const version = await tx.updateDocument(documentId, {
        status: 'SCAN_PENDING',
        detected_content_type: verdict.detected_content_type,
        ...observed,
        now: now.toISOString(),
      });
      await tx.closeSession(lockedSession.session_id, 'COMPLETED', now.toISOString());
      await this.emit(tx, ctx, 'DocumentUploaded', documentId, version, {
        document_id: documentId,
        policy_id: locked.policy_id,
        content_type: verdict.detected_content_type,
        byte_size: observed.byte_size,
        checksum_sha256: observed.checksum_sha256,
        classification: locked.classification,
        ...(locked.application_ref ? { application_ref: locked.application_ref } : {}),
      });
      await this.emit(tx, ctx, 'DocumentScanRequested', documentId, version, {
        document_id: documentId,
        attempt_no: 1,
      });
      await appendAudit(tx, ctx, {
        action: 'DOCUMENT_UPLOAD_COMPLETE',
        actionClass: 'WRITE',
        resourceType: 'Document',
        resourceId: documentId,
        result: 'SUCCESS',
        now,
      });
      return tx.getDocument(documentId);
    });
    if (!after) throw new Cmp013Error('SF-SYS-002');
    if (after.status === 'REJECTED') {
      throw new Cmp013Error('SF-EVD-002', detail(after.rejection_code ?? 'REJECTED'));
    }
    return documentView(after);
  }

  async getDocument(ctx: TenantContext, documentId: string): Promise<DocumentView> {
    const { doc } = await this.load(ctx, documentId);
    await this.decide(ctx, 'DOCUMENT_READ', this.documentResource(doc));
    return documentView(doc);
  }

  /** Short-lived download only for technically accepted (CLEAN-scanned) documents. */
  async issueAccess(
    ctx: TenantContext,
    documentId: string,
  ): Promise<{ document_id: string; access: DownloadAccess }> {
    const { doc } = await this.load(ctx, documentId);
    await this.decide(ctx, 'DOCUMENT_ACCESS', this.documentResource(doc));
    const usable = isUsableAsEvidence(doc.status);
    await this.d.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action: 'DOCUMENT_ACCESS',
        actionClass: 'READ',
        resourceType: 'Document',
        resourceId: documentId,
        result: usable ? 'SUCCESS' : 'DENIED',
        ...(usable ? {} : { reason: `DOCUMENT_${doc.status}` }),
        now: this.d.clock(),
      }),
    );
    if (!usable) throw new Cmp013Error('SF-EVD-002', detail('DOCUMENT_NOT_AVAILABLE'));
    const expiresAt = new Date(this.d.clock().getTime() + this.d.downloadTtlSeconds * 1000);
    const access = await this.external('STORAGE_UNAVAILABLE', () =>
      this.d.storage.issueDownloadAccess({
        tenantId: ctx.tenant_id,
        objectKey: doc.object_ref,
        expiresAt,
      }),
    );
    return { document_id: documentId, access };
  }

  /** Abandoned-upload sweeper; run per tenant by a scheduler with a SYSTEM context. */
  async expireAbandonedSessions(ctx: TenantContext, limit = 100): Promise<number> {
    const now = this.d.clock();
    const expired = await this.d.repo.withTx(ctx, async (tx) => {
      const keys: string[] = [];
      for (const session of await tx.openExpiredSessions(now.toISOString(), limit)) {
        const doc = await tx.getDocument(session.document_id, true);
        if (!doc || doc.status !== 'PENDING_UPLOAD') continue;
        const version = await tx.updateDocument(doc.document_id, {
          status: 'REJECTED',
          rejection_code: 'UPLOAD_ABANDONED',
          now: now.toISOString(),
        });
        await tx.closeSession(session.session_id, 'EXPIRED', now.toISOString());
        await this.emit(tx, ctx, 'DocumentRejected', doc.document_id, version, {
          document_id: doc.document_id,
          rejection_code: 'UPLOAD_ABANDONED',
        });
        await appendAudit(tx, ctx, {
          action: 'DOCUMENT_UPLOAD_ABANDON',
          actionClass: 'WRITE',
          resourceType: 'Document',
          resourceId: doc.document_id,
          result: 'SUCCESS',
          now,
        });
        keys.push(doc.object_ref);
      }
      return keys;
    });
    for (const objectKey of expired) {
      await this.bestEffort(() => this.d.storage.discard({ tenantId: ctx.tenant_id, objectKey }));
    }
    return expired.length;
  }

  workerContext(envelope: EventEnvelope<object>): TenantContext {
    const ctx: RequestContext = {
      tenant_id: envelope.tenant_id,
      cell_id: envelope.cell_id,
      actor: { type: 'SYSTEM', id: this.d.workerActorId },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY',
      correlation_id: envelope.correlation_id,
      trace_id: randomBytes(16).toString('hex'),
    };
    if (ctx.tenant_id === null || !validate('request-context', ctx).valid) {
      throw new Cmp013Error('SF-TEN-001');
    }
    return ctx as TenantContext;
  }

  private async runScan(ctx: TenantContext, doc: DocumentRow): Promise<ScanAttempt> {
    const fallback = this.d.scanner.simulation ?? null;
    let outcome: ScanAttempt;
    try {
      const r = await this.external('SCANNER_UNAVAILABLE', () =>
        this.d.scanner.scan({
          tenantId: ctx.tenant_id,
          objectKey: doc.object_ref,
          checksumSha256: doc.checksum_sha256 ?? '',
        }),
      );
      const verdict: ScanVerdict =
        r.verdict === 'CLEAN' || r.verdict === 'INFECTED' ? r.verdict : 'ERROR';
      outcome = {
        verdict,
        engine_ref: ENGINE_REF.test(r.engine_ref) ? r.engine_ref : 'unrecognised-engine',
        simulation: r.simulation ?? fallback,
      };
    } catch {
      outcome = { verdict: 'ERROR', engine_ref: 'scanner-unavailable', simulation: fallback };
    }
    if (outcome.verdict === 'CLEAN') {
      try {
        await this.external('STORAGE_UNAVAILABLE', () =>
          this.d.storage.releaseFromQuarantine({
            tenantId: ctx.tenant_id,
            objectKey: doc.object_ref,
          }),
        );
      } catch {
        outcome = { ...outcome, verdict: 'ERROR', engine_ref: 'quarantine-release-failed' };
      }
    }
    return outcome;
  }

  /**
   * Consumer for DocumentScanRequested (inbox-deduplicated). The scan runs between two short
   * transactions; a CLEAN verdict is the only path to AVAILABLE.
   */
  async processScanRequest(envelope: EventEnvelope<object>): Promise<ScanResult> {
    if (
      !validate('event-envelope', envelope).valid ||
      envelope.event_type !== 'DocumentScanRequested'
    ) {
      throw new Cmp013Error('SF-SYS-003', detail('SCAN_REQUEST_INVALID'));
    }
    const documentId = (envelope.data as { document_id?: unknown }).document_id;
    if (typeof documentId !== 'string' || !isUuid(documentId)) {
      throw new Cmp013Error('SF-SYS-003', detail('SCAN_REQUEST_INVALID'));
    }
    const ctx = this.workerContext(envelope);
    const pre = await this.d.repo.withTx(ctx, async (tx) => {
      if (await tx.inboxSeen(SCAN_CONSUMER_GROUP, envelope.event_id)) return 'DUPLICATE' as const;
      const doc = await tx.getDocument(documentId);
      if (!doc || doc.status !== 'SCAN_PENDING') {
        await tx.recordInbox(SCAN_CONSUMER_GROUP, envelope.event_id);
        return 'SKIPPED' as const;
      }
      return doc;
    });
    if (pre === 'DUPLICATE' || pre === 'SKIPPED') return pre;
    const attempt = await this.runScan(ctx, pre);
    const result = await this.d.repo.withTx(ctx, async (tx): Promise<ScanResult> => {
      if (!(await tx.recordInbox(SCAN_CONSUMER_GROUP, envelope.event_id))) return 'DUPLICATE';
      const doc = await tx.getDocument(documentId, true);
      if (!doc || doc.status !== 'SCAN_PENDING') return 'SKIPPED';
      const policy = await tx.policyById(doc.policy_id);
      const attemptNo = doc.scan_attempts + 1;
      const now = this.d.clock();
      await tx.insertScan({
        scan_id: randomUUID(),
        document_id: documentId,
        attempt_no: attemptNo,
        verdict: attempt.verdict,
        engine_ref: attempt.engine_ref,
        scanner_mode: this.d.scanner.mode,
        simulation: attempt.simulation,
        scanned_at: now.toISOString(),
      });
      const exhausted = attemptNo >= (policy?.max_scan_attempts ?? 1);
      let outcome: ScanResult;
      let rejection: string | null = null;
      if (attempt.verdict === 'CLEAN') outcome = 'AVAILABLE';
      else if (attempt.verdict === 'INFECTED') {
        outcome = 'REJECTED';
        rejection = 'MALWARE_DETECTED';
      } else if (exhausted) {
        outcome = 'REJECTED';
        rejection = 'SCAN_FAILED';
      } else outcome = 'RETRY';
      const version = await tx.updateDocument(documentId, {
        status:
          outcome === 'AVAILABLE'
            ? 'AVAILABLE'
            : outcome === 'REJECTED'
              ? 'REJECTED'
              : 'SCAN_PENDING',
        scan_attempts: attemptNo,
        ...(rejection ? { rejection_code: rejection } : {}),
        now: now.toISOString(),
      });
      await this.emit(tx, ctx, 'DocumentScanned', documentId, version, {
        document_id: documentId,
        attempt_no: attemptNo,
        verdict: attempt.verdict,
        scanner_mode: this.d.scanner.mode,
        ...(attempt.simulation ? { simulation: attempt.simulation } : {}),
      });
      if (outcome === 'AVAILABLE') {
        await this.emit(tx, ctx, 'DocumentAvailable', documentId, version, {
          document_id: documentId,
          content_type: doc.detected_content_type,
          byte_size: doc.byte_size,
          checksum_sha256: doc.checksum_sha256,
          classification: doc.classification,
          ...(doc.application_ref ? { application_ref: doc.application_ref } : {}),
        });
      } else if (outcome === 'REJECTED' && rejection) {
        await this.emit(tx, ctx, 'DocumentRejected', documentId, version, {
          document_id: documentId,
          rejection_code: rejection,
        });
      } else {
        await this.emit(tx, ctx, 'DocumentScanRequested', documentId, version, {
          document_id: documentId,
          attempt_no: attemptNo + 1,
        });
      }
      await appendAudit(tx, ctx, {
        action: 'DOCUMENT_SCAN_RECORD',
        actionClass: 'WRITE',
        resourceType: 'Document',
        resourceId: documentId,
        result: attempt.verdict === 'ERROR' ? 'FAILED' : 'SUCCESS',
        reason: `SCAN_${attempt.verdict}`,
        now,
      });
      return outcome;
    });
    if (result === 'REJECTED') {
      await this.bestEffort(() =>
        this.d.storage.discard({ tenantId: ctx.tenant_id, objectKey: pre.object_ref }),
      );
    }
    return result;
  }
}
