import { Cmp020Error, detail } from '../errors.js';
import type { TenantContext } from '../types.js';

/**
 * Subset of the SF-CON-VERSION-PINNING pin graph that CMP-020 consumes. Supplied by the CMP-015
 * application/case owner; CMP-020 never reads CMP-015 tables and never accepts pins from clients.
 */
export interface ApplicationFeePins {
  application_id: string;
  tenant_service_binding_id: string;
  rule_version_id: string;
  fee_policy_version_id: string | null;
}

export interface ApplicationPinsPort {
  /** Returns null when the application is not visible to the tenant context. */
  getFeePins(ctx: TenantContext, applicationId: string): Promise<ApplicationFeePins | null>;
}

export class UnboundApplicationPinsPort implements ApplicationPinsPort {
  getFeePins(): Promise<ApplicationFeePins | null> {
    return Promise.reject(new Cmp020Error('SF-SYS-004', detail('APPLICATION_PINS_PORT_NOT_BOUND')));
  }
}
