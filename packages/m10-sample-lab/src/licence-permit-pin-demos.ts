/**
 * SAMPLE_LAB Licence/Permit Studio → TSB pin demos.
 * Real registry catalogue IDs only. DRAFT/DUMMY · not statute / not production policy.
 * `citizen_offerable: false` means no statute claim — SAMPLE_LAB DUMMY lab placement may
 * still bind these ids for apply demos (see placement.citizen.json lab-offer expansion).
 * Aligns CMP-018 / CMP-056 pin metadata to IND-BTP-001 / IND-LAB-019 / IND-ULB-007.
 * CERTIFIED=false · G6=false. No DigiLocker/SMS/Payment REAL.
 */

import { createHash } from 'node:crypto';

const TENANT_ID = '0d15ba00-0001-4000-8000-0d15ba0000d1';

const SHARED_PINS = {
  rule_version_id: '0d15ba00-0011-4000-8000-0d15ba000011',
  evidence_policy_version_id: '0d15ba00-0013-4000-8000-0d15ba000013',
  sla_policy_version_id: '0d15ba00-0014-4000-8000-0d15ba000014',
  fee_policy_version_id: '0d15ba00-0015-4000-8000-0d15ba000015',
  credential_template_version_id: '0d15ba00-0016-4000-8000-0d15ba000016',
  notification_version_id: '0d15ba00-0017-4000-8000-0d15ba000017',
  authorization_policy_version_id: '0d15ba00-0018-4000-8000-0d15ba000018',
} as const;

function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Matches packages/service-templates stubVersionId / generator. */
export function stubFormVersionId(catalogueId: string): string {
  return deterministicUuid(`sf-stub:${catalogueId}`);
}

export type LicencePermitPinDemoPins = {
  tenant_service_binding_id: string;
  form_version_id: string;
  rule_version_id: string;
  workflow_version_id: string;
  evidence_policy_version_id: string;
  sla_policy_version_id: string;
  fee_policy_version_id: string;
  credential_template_version_id: string;
  notification_version_id: string;
  authorization_policy_version_id: string;
};

export type LicencePermitPinDemoTarget = {
  catalogue_id: string;
  name: string;
  output_type: 'Licence' | 'Permit';
  label: string;
  status: 'DRAFT';
  policy_kind: 'SAMPLE_LAB_DUMMY';
  maturity: 'SAMPLE_LAB_STUB';
  citizen_offerable: false;
  certified: false;
  g6: false;
  self_certified: false;
  digilocker_mode: 'SIMULATED';
  sms_mode: 'SIMULATED';
  payment_mode: 'SIMULATED';
  authoring_path: string;
  inspection_pin_code: string;
  appointment_type_ref: string;
  workflow_nodes: readonly string[];
  tenant_id: string;
  tenant_service_binding_id: string;
  service_id: string;
  pins: LicencePermitPinDemoPins;
  notes: readonly string[];
};

export type LicencePermitPinDemoCatalogue = {
  source: 'SAMPLE_LAB';
  policy_kind: 'SAMPLE_LAB_DUMMY';
  mode: 'SAMPLE_LAB';
  certified: false;
  g6: false;
  self_certified: false;
  citizen_offerable: false;
  digilocker_mode: 'SIMULATED';
  sms_mode: 'SIMULATED';
  payment_mode: 'SIMULATED';
  targets: readonly LicencePermitPinDemoTarget[];
};

type DemoDef = {
  catalogue_id: string;
  name: string;
  output_type: 'Licence' | 'Permit';
  label: string;
  inspection_pin_code: string;
  appointment_type_ref: string;
  workflow_nodes: readonly string[];
};

const DEMO_DEFS: readonly DemoDef[] = [
  {
    catalogue_id: 'IND-BTP-001',
    name: 'Trade Licence',
    output_type: 'Licence',
    label: 'SAMPLE_LAB pin demo · Trade Licence (IND-BTP-001)',
    inspection_pin_code: 'TRADE_LICENCE_SITE_VISIT',
    appointment_type_ref: 'meta:appointment-type:site-visit',
    workflow_nodes: ['SITE_VISIT'],
  },
  {
    catalogue_id: 'IND-LAB-019',
    name: 'Factory Registration / Licence',
    output_type: 'Licence',
    label: 'SAMPLE_LAB pin demo · Factory Licence (IND-LAB-019)',
    inspection_pin_code: 'FACTORY_LICENCE_INSPECTION',
    appointment_type_ref: 'meta:appointment-type:factory-inspection',
    workflow_nodes: ['FACTORY_INSPECTION'],
  },
  {
    catalogue_id: 'IND-ULB-007',
    name: 'Building Construction Permit',
    output_type: 'Permit',
    label: 'SAMPLE_LAB pin demo · Building Construction Permit (IND-ULB-007)',
    inspection_pin_code: 'GENERIC_VERIFICATION',
    appointment_type_ref: 'meta:appointment-type:counter-visit',
    workflow_nodes: ['SITE_VERIFY'],
  },
] as const;

function buildTarget(def: DemoDef): LicencePermitPinDemoTarget {
  const formVersionId = stubFormVersionId(def.catalogue_id);
  const tsbId = deterministicUuid(`sf-lp-pin-demo:tsb:${def.catalogue_id}`);
  const serviceId = deterministicUuid(`sf-lp-pin-demo:svc:${def.catalogue_id}`);
  const workflowVersionId = deterministicUuid(`sf-lp-pin-demo:wf:${def.catalogue_id}`);

  return {
    catalogue_id: def.catalogue_id,
    name: def.name,
    output_type: def.output_type,
    label: def.label,
    status: 'DRAFT',
    policy_kind: 'SAMPLE_LAB_DUMMY',
    maturity: 'SAMPLE_LAB_STUB',
    citizen_offerable: false,
    certified: false,
    g6: false,
    self_certified: false,
    digilocker_mode: 'SIMULATED',
    sms_mode: 'SIMULATED',
    payment_mode: 'SIMULATED',
    authoring_path: `templates/certificate-packs/${def.catalogue_id.toLowerCase()}/`,
    inspection_pin_code: def.inspection_pin_code,
    appointment_type_ref: def.appointment_type_ref,
    workflow_nodes: def.workflow_nodes,
    tenant_id: TENANT_ID,
    tenant_service_binding_id: tsbId,
    service_id: serviceId,
    pins: {
      tenant_service_binding_id: tsbId,
      form_version_id: formVersionId,
      rule_version_id: SHARED_PINS.rule_version_id,
      workflow_version_id: workflowVersionId,
      evidence_policy_version_id: SHARED_PINS.evidence_policy_version_id,
      sla_policy_version_id: SHARED_PINS.sla_policy_version_id,
      fee_policy_version_id: SHARED_PINS.fee_policy_version_id,
      credential_template_version_id: SHARED_PINS.credential_template_version_id,
      notification_version_id: SHARED_PINS.notification_version_id,
      authorization_policy_version_id: SHARED_PINS.authorization_policy_version_id,
    },
    notes: [
      'Studio authors pack metadata → CMP-051 maker-checker → CMP-052 TSB pin.',
      'DRAFT stub form_version_id matches packages/service-templates stubVersionId.',
      'Not citizen-offerable until owner statute + PUBLISHED placement.',
      'No DigiLocker/SMS/Payment REAL. CERTIFIED=false. G6=false.',
    ],
  };
}

export const SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS: LicencePermitPinDemoCatalogue = {
  source: 'SAMPLE_LAB',
  policy_kind: 'SAMPLE_LAB_DUMMY',
  mode: 'SAMPLE_LAB',
  certified: false,
  g6: false,
  self_certified: false,
  citizen_offerable: false,
  digilocker_mode: 'SIMULATED',
  sms_mode: 'SIMULATED',
  payment_mode: 'SIMULATED',
  targets: DEMO_DEFS.map(buildTarget),
};

export function pinDemoForCatalogue(catalogueId: string): LicencePermitPinDemoTarget | null {
  return (
    SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.targets.find((t) => t.catalogue_id === catalogueId) ?? null
  );
}

export function pinDemoCatalogueIds(): readonly string[] {
  return SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.targets.map((t) => t.catalogue_id);
}

export function isLicencePermitPinDemo(catalogueId: string): boolean {
  return pinDemoForCatalogue(catalogueId) !== null;
}

/** Fail-closed: pin demos are SAMPLE_LAB / LOCAL / CI only. */
export function isSampleLabPinDemoEnvironment(environment: string): boolean {
  return environment === 'LOCAL' || environment === 'CI';
}
