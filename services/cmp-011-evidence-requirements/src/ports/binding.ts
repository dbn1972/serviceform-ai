export interface EvidencePin {
  version_ref: string;
  content_hash: string;
  binding_status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
}

/**
 * CMP-052 TenantServiceBinding pin lookup (INT-002). Consumed through this port only; CMP-011 never reads
 * the version registry schema directly.
 */
export interface BindingPinPort {
  resolveEvidencePin(input: { tenant_id: string; binding_id: string }): Promise<EvidencePin | null>;
}
