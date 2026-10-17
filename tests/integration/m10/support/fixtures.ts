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
 * Owner-supplied policy inputs from Odisha e-District public Resident Certificate
 * (https://edistrict.odisha.gov.in/). Set SF_M10_OWNER_INPUTS_READY=1 to activate.
 * DigiLocker/DLT remain SAMPLE_LAB — not production registrations.
 */
export const OWNER_INPUTS_READY = process.env['SF_M10_OWNER_INPUTS_READY'] === '1';

/** Odisha public-portal sample (active only when OWNER_INPUTS_READY). */
export const ODISHA_PUBLIC_SAMPLE = {
  pilot_tenant: '0d15ba00-0001-4000-8000-0d15ba0000d1',
  legal_basis_ref:
    'ORTPSA/ORTPS notified Resident Certificate — Revenue & Disaster Management Department (edistrict.odisha.gov.in)',
  eligibility_rule_ref: 'templates/residence-certificate/rules.gorules.yaml',
  evidence_types: [
    'ELECTRICITY_BILL',
    'ROR_COPY',
    'EPIC_OR_AADHAAR',
    'LANDLINE_TELEPHONE_BILL',
    'WATER_CONNECTION_BILL',
    'RATION_CARD',
    'HOLDING_TAX_RECEIPT',
    'LEASE_AGREEMENT',
    'EMPLOYER_CERTIFICATE',
    'BANK_PASSBOOK_FIRST_PAGE',
    'VOTER_LIST_EXTRACT',
    'NREGA_JOB_CARD',
    'OTHER_RELEVANT',
  ],
  fee_schedule_ref: 'templates/residence-certificate/fee-policy.yaml',
  fee_amount_paisa: 0,
  min_residence_months: 12,
  sla_ref: 'templates/residence-certificate/sla-policy.yaml',
  sla_working_days: 10,
  credential_template_ref: 'SAMPLE_LAB_IND_SOC_002_OD_RESIDENT_V1',
  policy_source_url: 'https://edistrict.odisha.gov.in/',
} as const;

export const POLICY_PLACEHOLDER = OWNER_INPUTS_READY
  ? {
      pilot_tenant: ODISHA_PUBLIC_SAMPLE.pilot_tenant,
      legal_basis_ref: ODISHA_PUBLIC_SAMPLE.legal_basis_ref,
      eligibility_rule_ref: ODISHA_PUBLIC_SAMPLE.eligibility_rule_ref,
      evidence_types: [...ODISHA_PUBLIC_SAMPLE.evidence_types],
      fee_schedule_ref: ODISHA_PUBLIC_SAMPLE.fee_schedule_ref,
      sla_ref: ODISHA_PUBLIC_SAMPLE.sla_ref,
      credential_template_ref: ODISHA_PUBLIC_SAMPLE.credential_template_ref,
    }
  : {
      pilot_tenant: null as string | null,
      legal_basis_ref: null as string | null,
      eligibility_rule_ref: null as string | null,
      evidence_types: null as string[] | null,
      fee_schedule_ref: null as string | null,
      sla_ref: null as string | null,
      credential_template_ref: null as string | null,
    };

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
    let map = this.byTenant.get(tenantId);
    if (!map) {
      map = new Map();
      this.byTenant.set(tenantId, map);
    }
    return map;
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
