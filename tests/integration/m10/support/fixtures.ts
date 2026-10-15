import { randomUUID } from 'node:crypto';

/**
 * Synthetic identifiers only — no real tenant, jurisdiction, service, person, or document.
 * Owner policy inputs (Finding M-04 POLICY_INPUT_REQUIRED) are explicit placeholders;
 * any harness path that requires them must fail closed, not invent values.
 */

// ── Tenant identifiers ────────────────────────────────────────────────────────
export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CANARY = '00000000-0000-4000-8000-000000000099';

// ── Actor identifiers ─────────────────────────────────────────────────────────
export const CITIZEN_ACTOR = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
export const OFFICER_ACTOR = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
export const SYSTEM_ACTOR = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';

// ── Application / form identifiers ───────────────────────────────────────────
export const APP_1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
export const APP_2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';

// ── Service catalogue reference (IND-SOC-002 residence certificate) ───────────
/** Catalogue ID from M10-PLAN.yaml; no statute invented — POLICY_INPUT_REQUIRED. */
export const CATALOGUE_ID = 'IND-SOC-002';

/**
 * Owner-supplied policy inputs.  Any test that needs these to be populated
 * must skip/fail-closed rather than fabricating values.
 * Set SF_M10_OWNER_INPUTS_READY=1 in the environment to treat them as available.
 */
export const OWNER_INPUTS_READY = process.env['SF_M10_OWNER_INPUTS_READY'] === '1';

export const POLICY_PLACEHOLDER = {
  pilot_tenant: null as string | null,
  legal_basis_ref: null as string | null,
  eligibility_rule_ref: null as string | null,
  evidence_types: null as string[] | null,
  fee_schedule_ref: null as string | null,
  sla_ref: null as string | null,
  credential_template_ref: null as string | null,
} as const;

// ── Connector modes ───────────────────────────────────────────────────────────
export type ConnectorMode = 'REAL' | 'SANDBOX' | 'SIMULATED';
export type DeploymentEnvironment =
  'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'PERFORMANCE' | 'UAT' | 'PREPROD' | 'PRODUCTION';

export const SIMULATION_ENVS: readonly DeploymentEnvironment[] = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
];
export const NON_SIMULATION_ENVS: readonly DeploymentEnvironment[] = [
  'UAT',
  'PREPROD',
  'PRODUCTION',
];

// ── Request context helpers ───────────────────────────────────────────────────
export type ActorType = 'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION';

export interface Ctx {
  tenant_id: string;
  cell_id: string;
  actor: { type: ActorType; id: string };
  roles: string[];
  jurisdiction_ids: string[];
  auth_assurance: 'NONE' | 'OTP' | 'PASSWORD' | 'MFA' | 'WORKLOAD_IDENTITY';
  correlation_id: string;
  trace_id: string;
}

export function ctxFor(tenantId: string, actorType: ActorType = 'SYSTEM', actorId?: string): Ctx {
  const id =
    actorId ??
    (actorType === 'OFFICER'
      ? OFFICER_ACTOR
      : actorType === 'CITIZEN'
        ? CITIZEN_ACTOR
        : SYSTEM_ACTOR);
  const workload = actorType === 'SYSTEM' || actorType === 'INTEGRATION';
  return {
    tenant_id: tenantId,
    cell_id: 'cell-m10-int',
    actor: { type: actorType, id },
    roles: workload ? [] : actorType === 'CITIZEN' ? ['CITIZEN'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: workload ? 'WORKLOAD_IDENTITY' : actorType === 'CITIZEN' ? 'OTP' : 'MFA',
    correlation_id: randomUUID(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  };
}

// ── PDP double ────────────────────────────────────────────────────────────────
export class RecordingAuthorizer {
  readonly calls: Array<{ action: string; subject: { tenant_id: string | null } }> = [];
  denyActions = new Set<string>();

  decide(input: { action: string; subject: { tenant_id: string | null } }): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(structuredClone(input));
    const allow = !this.denyActions.has(input.action);
    return Promise.resolve({
      allow,
      reason_code: allow ? 'ALLOW' : 'DENY',
      policy_revision: 'rev-m10-int',
      decision_id: randomUUID(),
    });
  }
}

// ── Leakage detector ─────────────────────────────────────────────────────────
/** Returns number of foreign identifiers found in the serialised response body. */
export function leaks(body: unknown, foreign: readonly string[]): number {
  const text = JSON.stringify(body ?? null);
  return foreign.filter((id) => id.length > 0 && text.includes(id)).length;
}

// ── In-memory tenant-partitioned application store (scaffold) ─────────────────
export interface ApplicationRecord {
  application_id: string;
  tenant_id: string;
  catalogue_id: string;
  status: string;
  submitted_at: string;
}

export class InMemoryApplicationRepo {
  private readonly byTenant = new Map<string, Map<string, ApplicationRecord>>();

  tenant(tenantId: string): Map<string, ApplicationRecord> {
    if (!this.byTenant.has(tenantId)) {
      this.byTenant.set(tenantId, new Map());
    }
    return this.byTenant.get(tenantId)!;
  }

  put(record: ApplicationRecord): void {
    this.tenant(record.tenant_id).set(record.application_id, record);
  }

  get(tenantId: string, applicationId: string): ApplicationRecord | undefined {
    return this.tenant(tenantId).get(applicationId);
  }
}

// ── Harness fail-closed guard ─────────────────────────────────────────────────
/**
 * Throws a descriptive error when owner-policy inputs are required but not yet
 * supplied. Harness scaffolding invokes this before any path that would otherwise
 * fabricate eligibility/fee/SLA/statute values.
 */
export function assertOwnerInputsReady(context: string): void {
  if (!OWNER_INPUTS_READY) {
    throw new Error(
      `POLICY_INPUT_REQUIRED: owner inputs not yet supplied. ` +
        `Set SF_M10_OWNER_INPUTS_READY=1 once pilot tenant, legal basis, eligibility, ` +
        `fee, SLA, and credential template have been provided. Context: ${context}`,
    );
  }
}
