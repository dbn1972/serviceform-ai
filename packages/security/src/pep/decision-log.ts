import { redactDeep } from '@serviceform/observability';

export interface DecisionLogEntry {
  decision_id: string;
  opa_decision_id?: string;
  trace_id: string;
  correlation_id: string;
  policy_revision: string;
  path: 'sf/authz/decision';
  allow: boolean;
  reason_code: string;
  latency_ms: number;
  action: string;
  resource_type: string;
  resource_tenant_id: string | null;
  classification?: string;
  subject_actor_type: string;
  roles: string[];
  assurance?: string;
  delegation_present: boolean;
}

const ALLOWED = new Set([
  'decision_id',
  'opa_decision_id',
  'trace_id',
  'correlation_id',
  'policy_revision',
  'path',
  'allow',
  'reason_code',
  'latency_ms',
  'action',
  'resource_type',
  'resource_tenant_id',
  'classification',
  'subject_actor_type',
  'roles',
  'assurance',
  'delegation_present',
]);

export function sanitizeDecisionLog(entry: DecisionLogEntry): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (ALLOWED.has(k)) picked[k] = v;
  }
  return redactDeep(picked);
}
