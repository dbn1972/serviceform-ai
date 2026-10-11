import { Cmp020Error, detail } from '../errors.js';
import type { TenantContext } from '../types.js';

/**
 * Published, immutable fee-policy version as resolved from governed metadata (CMP-033 metadata /
 * CMP-052 versioning, published through CMP-051 maker-checker). CMP-020 holds no fee schedule of
 * its own: every line, amount, currency and waiver reference originates here or in CMP-008 rules.
 * Shape: contracts/ports/published-fee-policy.schema.json (component-local).
 */
export interface PublishedFeePolicyLine {
  code: string;
  basis: 'FIXED_AMOUNT' | 'RULE_OUTPUT';
  amount_minor?: number | string;
  rule_output_key?: string;
  description_code?: string;
}

export interface PublishedFeePolicy {
  fee_policy_version_id: string;
  tenant_id: string;
  tenant_service_binding_id: string;
  publication_status: string;
  content_hash: string;
  currency: string;
  rule_version_id: string | null;
  waiver_policy_ref: string | null;
  lines: PublishedFeePolicyLine[];
}

export interface FeePolicyPort {
  /** Resolves exactly the pinned version; returns null when it does not exist for the tenant. */
  getPublishedVersion(
    ctx: TenantContext,
    feePolicyVersionId: string,
  ): Promise<PublishedFeePolicy | null>;
}

export class UnboundFeePolicyPort implements FeePolicyPort {
  getPublishedVersion(): Promise<PublishedFeePolicy | null> {
    return Promise.reject(new Cmp020Error('SF-SYS-004', detail('FEE_POLICY_PORT_NOT_BOUND')));
  }
}
