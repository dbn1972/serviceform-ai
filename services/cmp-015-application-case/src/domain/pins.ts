import { Cmp015Error, detail } from '../errors.js';
import { isUuid, sha256Of } from './validate.js';

/** SF-CON-VERSION-PINNING pinGraph: exact published versions an application executes against. */
export interface PinGraph {
  tenant_service_binding_id: string;
  form_version_id: string;
  rule_version_id: string;
  workflow_version_id: string;
  evidence_policy_version_id: string;
  sla_policy_version_id: string;
  fee_policy_version_id?: string;
  credential_template_version_id?: string;
  notification_version_id?: string;
  /** TSB publication provenance only (ADR-0005); never the runtime authorization revision. */
  authorization_policy_version_id?: string;
}

export const REQUIRED_PINS = [
  'tenant_service_binding_id',
  'form_version_id',
  'rule_version_id',
  'workflow_version_id',
  'evidence_policy_version_id',
  'sla_policy_version_id',
] as const;

export const OPTIONAL_PINS = [
  'fee_policy_version_id',
  'credential_template_version_id',
  'notification_version_id',
  'authorization_policy_version_id',
] as const;

const ALL_PINS: readonly string[] = [...REQUIRED_PINS, ...OPTIONAL_PINS];

export function parsePinGraph(value: unknown): PinGraph {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Cmp015Error('SF-FORM-001', { details: detail('PIN_GRAPH_INVALID') });
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!ALL_PINS.includes(key)) {
      throw new Cmp015Error('SF-FORM-001', {
        details: detail('PIN_GRAPH_UNKNOWN_FIELD', `/${key}`),
      });
    }
  }
  for (const key of REQUIRED_PINS) {
    if (!isUuid(v[key])) {
      throw new Cmp015Error('SF-FORM-001', { details: detail('PIN_REQUIRED', `/${key}`) });
    }
  }
  const out: PinGraph = {
    tenant_service_binding_id: v['tenant_service_binding_id'] as string,
    form_version_id: v['form_version_id'] as string,
    rule_version_id: v['rule_version_id'] as string,
    workflow_version_id: v['workflow_version_id'] as string,
    evidence_policy_version_id: v['evidence_policy_version_id'] as string,
    sla_policy_version_id: v['sla_policy_version_id'] as string,
  };
  for (const key of OPTIONAL_PINS) {
    const raw = v[key];
    if (raw === undefined || raw === null) continue;
    if (!isUuid(raw))
      throw new Cmp015Error('SF-FORM-001', { details: detail('PIN_INVALID', `/${key}`) });
    out[key] = raw;
  }
  return out;
}

export function pinGraphHash(pins: PinGraph): string {
  return sha256Of(pins);
}

/**
 * Constitution #9 / #35: a pinned case never moves to other versions as a side effect. Any
 * difference is a silent repoint and is refused; repointing needs a governed migration (not a
 * CMP-015 command).
 */
export function assertSamePins(pinned: PinGraph, candidate: PinGraph): void {
  if (pinGraphHash(pinned) !== pinGraphHash(candidate)) {
    throw new Cmp015Error('SF-APP-001', { details: detail('SILENT_REPOINT_FORBIDDEN') });
  }
}

export interface VersionPinningRecord {
  contract_id: 'SF-CON-VERSION-PINNING';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  application_id: string;
  pin_graph: PinGraph;
  runtime_authz_policy_revision: string;
  runtime_authz_decision_id?: string;
  silent_repoint_forbidden: true;
}

/** ADR-0005: execution graph stays pinned; the action records the live OPA policy_revision. */
export function versionPinningRecord(params: {
  tenantId: string;
  applicationId: string;
  pins: PinGraph;
  policyRevision: string;
  decisionId?: string;
}): VersionPinningRecord {
  const record: VersionPinningRecord = {
    contract_id: 'SF-CON-VERSION-PINNING',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: params.tenantId,
    application_id: params.applicationId,
    pin_graph: { ...params.pins },
    runtime_authz_policy_revision: params.policyRevision,
    silent_repoint_forbidden: true,
  };
  if (params.decisionId) record.runtime_authz_decision_id = params.decisionId;
  return record;
}
