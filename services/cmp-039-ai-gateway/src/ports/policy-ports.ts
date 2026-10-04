import type { DataClassification } from '../domain/classification.js';

/** CMP-030 purpose/consent check for PERSONAL and SENSITIVE data. Default: deny. */
export interface PurposeConsentPort {
  permits(input: {
    tenantId: string;
    actorId: string;
    purpose: string;
    classification: DataClassification;
  }): Promise<boolean>;
}

/** Tenant/source ACL for retrieval context (AI-GOVERNANCE.md). Default: deny. */
export interface SourceAclPort {
  canRead(input: { tenantId: string; actorId: string; sourceId: string }): Promise<boolean>;
}

export function denyAllPurposeConsent(): PurposeConsentPort {
  return { permits: async () => false };
}

export function denyAllSourceAcl(): SourceAclPort {
  return { canRead: async () => false };
}

/** SIMULATED consent adapter for LOCAL/CI only; never wired by default. */
export class SimulatedPurposeConsentPort implements PurposeConsentPort {
  readonly denied = new Set<string>();
  async permits(input: { purpose: string }): Promise<boolean> {
    return !this.denied.has(input.purpose);
  }
}

/** SIMULATED source ACL: sources are readable only inside their registered tenant. */
export class SimulatedSourceAclPort implements SourceAclPort {
  private readonly grants = new Map<string, Set<string>>();

  allow(tenantId: string, sourceId: string): void {
    const set = this.grants.get(tenantId) ?? new Set<string>();
    set.add(sourceId);
    this.grants.set(tenantId, set);
  }

  async canRead(input: { tenantId: string; sourceId: string }): Promise<boolean> {
    return this.grants.get(input.tenantId)?.has(input.sourceId) ?? false;
  }
}
