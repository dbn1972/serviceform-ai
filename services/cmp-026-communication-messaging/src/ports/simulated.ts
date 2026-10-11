import type { TenantRequestContext } from '../domain/validate.js';
import type {
  AttachmentAccessGrant,
  AttachmentObjectDescriptor,
  AttachmentStoragePort,
  CaseParticipationPort,
} from './external.js';

/**
 * SIMULATED adapters (INT-013). Allowed only in LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE; the
 * service constructor refuses them in every other environment (fail closed in PRODUCTION).
 */
export class SimulatedAttachmentStorage implements AttachmentStoragePort {
  readonly simulation = 'SIMULATED' as const;
  private readonly objects = new Map<string, AttachmentObjectDescriptor>();

  register(tenantId: string, storageKey: string, descriptor: AttachmentObjectDescriptor): void {
    this.objects.set(`${tenantId}\u0000${storageKey}`, descriptor);
  }

  async describeObject(input: {
    tenantId: string;
    storageKey: string;
  }): Promise<AttachmentObjectDescriptor | null> {
    return this.objects.get(`${input.tenantId}\u0000${input.storageKey}`) ?? null;
  }

  async issueDownloadAccess(input: {
    tenantId: string;
    storageKey: string;
    expiresAt: Date;
  }): Promise<AttachmentAccessGrant> {
    return {
      method: 'GET',
      url: `https://simulated-storage.invalid/${encodeURIComponent(input.storageKey)}`,
      expires_at: input.expiresAt.toISOString(),
      simulation: 'SIMULATED',
    };
  }
}

export class SimulatedCaseParticipation implements CaseParticipationPort {
  readonly simulation = 'SIMULATED' as const;
  async canOpenThread(_ctx: TenantRequestContext): Promise<boolean> {
    return true;
  }
  async isEligibleParticipant(): Promise<boolean> {
    return true;
  }
}
