/**
 * INT-011: Tenant isolation enforcement — policy port.
 * CMP-060 enforces tenant isolation through PostgreSQL RLS (sf_risk schema, FORCE RLS policies).
 * This port represents the OPA-backed authorization check before any risk assessment is created.
 * OPA is the authoritative decision maker for access; RLS is the hard data boundary.
 */

export interface TenantAuthzPort {
  /**
   * Verify that the actor is authorized to create/read risk assessments for the given tenant.
   * Returns true if authorized; throws or returns false if not.
   * This is an OPA check — CMP-060 never implements the policy logic itself.
   */
  canActOnRisk(params: {
    tenant_id: string;
    actor_id: string;
    actor_type: string;
    action: 'CREATE_ASSESSMENT' | 'READ_ASSESSMENT' | 'RECORD_DISPOSITION';
  }): Promise<boolean>;
}

/**
 * Deny-all stub for testing tenant isolation (negative tests).
 */
export class DenyAllTenantAuthz implements TenantAuthzPort {
  async canActOnRisk(_params: Parameters<TenantAuthzPort['canActOnRisk']>[0]): Promise<boolean> {
    return false;
  }
}

/**
 * Simulated allow-all for unit tests only.
 */
export class SimulatedAllowAllTenantAuthz implements TenantAuthzPort {
  async canActOnRisk(_params: Parameters<TenantAuthzPort['canActOnRisk']>[0]): Promise<boolean> {
    return true;
  }
}
