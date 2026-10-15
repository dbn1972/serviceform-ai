import { Cmp057Error } from './errors.js';
import type { TenantContext } from './types.js';

/**
 * INT-015 collaborators reached through the host (CMP-004/CMP-005 for the applicant, CMP-030 for
 * consent). CMP-057 never reads their tables; it records only the opaque references they confirm.
 * Calls happen before any CMP-057 transaction opens.
 */
export interface AssistedVerificationPort {
  /** True only if the citizen exists in the caller's tenant (the tenant comes from ctx). */
  applicantInTenant(ctx: TenantContext, citizenId: string): Promise<boolean>;
  /** True only if CMP-030 holds the referenced consent for this citizen and session. */
  consentCaptured(
    ctx: TenantContext,
    p: { citizenId: string; consentRef: string; sessionId: string },
  ): Promise<boolean>;
}

export async function verifyOrFailClosed(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await check()) === true;
  } catch (err) {
    throw new Cmp057Error('SF-INT-001', {
      details: [{ code: 'VERIFICATION_UNAVAILABLE' }],
      cause: err,
    });
  }
}
