import type {
  ActorType,
  EventEnvelope,
  RequestContext,
  SimulationMarker,
} from '@serviceform/contracts';
import type { ConnectorMode } from '@serviceform/contracts';
import type { DocumentClassification, UploadPolicy } from '../domain/policy.js';
import type { DocumentStatus, ScanVerdict, SessionStatus } from '../domain/states.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface DocumentRow {
  tenant_id: string;
  document_id: string;
  cell_id: string;
  policy_id: string;
  classification: DocumentClassification;
  application_ref: string | null;
  owner_actor_id: string;
  owner_actor_type: ActorType;
  declared_content_type: string;
  declared_byte_size: number;
  declared_checksum_sha256: string;
  detected_content_type: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  object_ref: string;
  storage_mode: ConnectorMode;
  storage_simulation: SimulationMarker | null;
  status: DocumentStatus;
  rejection_code: string | null;
  scan_attempts: number;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export type NewDocument = Omit<
  DocumentRow,
  | 'detected_content_type'
  | 'byte_size'
  | 'checksum_sha256'
  | 'status'
  | 'rejection_code'
  | 'scan_attempts'
  | 'aggregate_version'
  | 'created_at'
  | 'updated_at'
> & { now: string };

export interface SessionRow {
  tenant_id: string;
  session_id: string;
  document_id: string;
  status: SessionStatus;
  expires_at: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

export interface DocumentPatch {
  status: DocumentStatus;
  rejection_code?: string;
  detected_content_type?: string;
  byte_size?: number;
  checksum_sha256?: string;
  scan_attempts?: number;
  now: string;
}

export interface ScanRow {
  scan_id: string;
  document_id: string;
  attempt_no: number;
  verdict: ScanVerdict;
  engine_ref: string;
  scanner_mode: ConnectorMode;
  simulation: SimulationMarker | null;
  scanned_at: string;
}

/** Operations available inside one short, tenant-bound authoritative transaction. */
export interface UploadTx {
  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'>;
  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;
  latestPolicy(policyCode: string): Promise<UploadPolicy | null>;
  policyById(policyId: string): Promise<UploadPolicy | null>;
  insertPolicy(row: UploadPolicy & { created_by: string }): Promise<void>;
  insertDocument(row: NewDocument): Promise<void>;
  insertSession(row: Omit<SessionRow, 'tenant_id' | 'closed_at' | 'status'>): Promise<void>;
  getDocument(documentId: string, forUpdate?: boolean): Promise<DocumentRow | null>;
  getSessionForDocument(documentId: string, forUpdate?: boolean): Promise<SessionRow | null>;
  updateDocument(documentId: string, patch: DocumentPatch): Promise<number>;
  closeSession(
    sessionId: string,
    status: Exclude<SessionStatus, 'OPEN'>,
    now: string,
  ): Promise<void>;
  insertScan(row: ScanRow): Promise<void>;
  recordInbox(consumerGroup: string, eventId: string): Promise<boolean>;
  inboxSeen(consumerGroup: string, eventId: string): Promise<boolean>;
  openExpiredSessions(now: string, limit: number): Promise<SessionRow[]>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface UploadRepository {
  withTx<T>(ctx: RequestContext, fn: (tx: UploadTx) => Promise<T>): Promise<T>;
  /** True when the caller's async context is inside an open authoritative transaction. */
  inTransaction(): boolean;
}
