import { Cmp022Error, detail } from '../errors.js';
import type { TenantContext } from '../types.js';

/**
 * Issuance inputs owned by the CMP-015 application/case aggregate (SF-CON-VERSION-PINNING pin
 * graph plus the upstream approval reference). CMP-022 never reads CMP-015 tables and never
 * accepts pins or approval references from clients. A null `approval_decision_ref` means the
 * upstream workflow/human task has not recorded an approval; CMP-022 does not decide approval.
 */
export interface CaseIssuancePins {
  application_id: string;
  tenant_service_binding_id: string;
  service_version_id: string;
  credential_template_id: string | null;
  credential_template_version: number | null;
  approval_decision_ref: string | null;
}

export interface CaseIssuancePinsPort {
  /** Returns null when the application is not visible to the tenant context. */
  getIssuancePins(ctx: TenantContext, applicationId: string): Promise<CaseIssuancePins | null>;
}

export class UnboundCaseIssuancePinsPort implements CaseIssuancePinsPort {
  getIssuancePins(): Promise<CaseIssuancePins | null> {
    return Promise.reject(new Cmp022Error('SF-SYS-004', detail('CASE_PINS_PORT_NOT_BOUND')));
  }
}
