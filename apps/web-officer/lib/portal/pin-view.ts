/**
 * Client-safe TSB / SF-CON-VERSION-PINNING display helpers (no Node imports).
 * CERTIFIED=false. G6=false.
 */

export interface CasePinGraph {
  tenant_service_binding_id: string;
  form_version_id: string;
  rule_version_id: string;
  workflow_version_id: string;
  evidence_policy_version_id: string;
  sla_policy_version_id: string;
  fee_policy_version_id?: string;
  credential_template_version_id?: string;
  notification_version_id?: string;
  authorization_policy_version_id?: string;
}

export const PIN_DISPLAY_ORDER = [
  'tenant_service_binding_id',
  'form_version_id',
  'rule_version_id',
  'workflow_version_id',
  'evidence_policy_version_id',
  'sla_policy_version_id',
  'fee_policy_version_id',
  'credential_template_version_id',
  'notification_version_id',
  'authorization_policy_version_id',
] as const;

export const PIN_LABELS: Record<(typeof PIN_DISPLAY_ORDER)[number], string> = {
  tenant_service_binding_id: 'TenantServiceBinding',
  form_version_id: 'Form',
  rule_version_id: 'Rules',
  workflow_version_id: 'Workflow',
  evidence_policy_version_id: 'Evidence policy',
  sla_policy_version_id: 'SLA policy',
  fee_policy_version_id: 'Fee policy',
  credential_template_version_id: 'Credential template',
  notification_version_id: 'Notification',
  authorization_policy_version_id: 'Authz policy (TSB provenance)',
};

export function orderedCasePins(
  pins: CasePinGraph | undefined,
): { key: string; label: string; version_id: string }[] {
  if (!pins) return [];
  const out: { key: string; label: string; version_id: string }[] = [];
  for (const key of PIN_DISPLAY_ORDER) {
    const version_id = pins[key];
    if (typeof version_id === 'string' && version_id.length > 0) {
      out.push({ key, label: PIN_LABELS[key], version_id });
    }
  }
  return out;
}
