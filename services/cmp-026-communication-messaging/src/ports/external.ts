import type { TenantRequestContext } from '../domain/validate.js';
import { Cmp026Error, detail } from '../errors.js';

/**
 * CMP-004 / CMP-015 view: participants are derived from the case and authorization context.
 * CMP-026 never reads case or identity tables (no cross-component SQL).
 */
export interface CaseParticipationPort {
  /** May this actor open a thread against the opaque application (case) reference? */
  canOpenThread(ctx: TenantRequestContext, input: { application_id: string }): Promise<boolean>;
  /** Is the named principal an eligible participant for the case in the given role? */
  isEligibleParticipant(
    ctx: TenantRequestContext,
    input: { application_id: string; actor_id: string; role_code: string },
  ): Promise<boolean>;
}

export class DenyCaseParticipationPort implements CaseParticipationPort {
  async canOpenThread(): Promise<boolean> {
    return false;
  }
  async isEligibleParticipant(): Promise<boolean> {
    return false;
  }
}

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'PENDING';

export interface AttachmentObjectDescriptor {
  byte_size: number;
  checksum_sha256: string;
  scan_verdict: ScanVerdict;
}

export interface AttachmentAccessGrant {
  method: 'GET';
  url: string;
  expires_at: string;
  simulation?: 'SIMULATED';
}

/**
 * CMP-032 Storage port. CMP-026 holds only storage-key references; it owns no object store,
 * holds no provider credentials, and never proxies bytes. Implementations must refuse keys that
 * are not owned by `tenantId`. Called only outside the domain database transaction.
 */
export interface AttachmentStoragePort {
  readonly simulation?: 'SIMULATED';
  describeObject(input: {
    tenantId: string;
    storageKey: string;
  }): Promise<AttachmentObjectDescriptor | null>;
  issueDownloadAccess(input: {
    tenantId: string;
    storageKey: string;
    expiresAt: Date;
  }): Promise<AttachmentAccessGrant>;
}

export const unconfiguredAttachmentStorage: AttachmentStoragePort = {
  async describeObject() {
    throw new Cmp026Error('SF-SYS-004', { details: detail('STORAGE_PORT_NOT_CONFIGURED') });
  },
  async issueDownloadAccess() {
    throw new Cmp026Error('SF-SYS-004', { details: detail('STORAGE_PORT_NOT_CONFIGURED') });
  },
};

/** CMP-016 workflow signal for official notices that require acknowledgement (post-commit). */
export interface NoticeSignal {
  tenant_id: string;
  application_id: string;
  thread_id: string;
  message_id: string;
  ack_due_at: string | null;
  idempotency_key: string;
  correlation_id: string;
}

export interface WorkflowSignalPort {
  signalNotice(signal: NoticeSignal): Promise<void>;
}

export class OutboxOnlyWorkflowSignal implements WorkflowSignalPort {
  async signalNotice(): Promise<void> {
    return undefined;
  }
}
