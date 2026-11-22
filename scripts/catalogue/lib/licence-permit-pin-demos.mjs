/**
 * SAMPLE_LAB Licence/Permit Studio → TSB pin-demo registry (generator + fixture sync).
 * Real registry catalogue IDs only. DRAFT/DUMMY · not citizen-offerable · not statute.
 * CERTIFIED=false · G6=false.
 */

import { authoringPath, deterministicUuid, stubFormVersionId } from './pack-factory.mjs';

const TENANT_ID = '0d15ba00-0001-4000-8000-0d15ba0000d1';

/** Shared SAMPLE_LAB DUMMY pins reused across demos (same class as Residence lab fixtures). */
const SHARED_PINS = {
  rule_version_id: '0d15ba00-0011-4000-8000-0d15ba000011',
  evidence_policy_version_id: '0d15ba00-0013-4000-8000-0d15ba000013',
  sla_policy_version_id: '0d15ba00-0014-4000-8000-0d15ba000014',
  fee_policy_version_id: '0d15ba00-0015-4000-8000-0d15ba000015',
  credential_template_version_id: '0d15ba00-0016-4000-8000-0d15ba000016',
  notification_version_id: '0d15ba00-0017-4000-8000-0d15ba000017',
  authorization_policy_version_id: '0d15ba00-0018-4000-8000-0d15ba000018',
};

/**
 * Representative Licence + Permit pin-demo targets.
 * Aligns CMP-018 / CMP-056 catalogues to real registry IDs (replaces IND-LIC-* placeholders).
 */
export const LICENCE_PERMIT_PIN_DEMO_DEFS = [
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
];

export function pinDemoByCatalogueId(catalogueId) {
  return LICENCE_PERMIT_PIN_DEMO_DEFS.find((d) => d.catalogue_id === catalogueId) ?? null;
}

export function buildPinDemoTarget(def) {
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
    authoring_path: authoringPath(def.catalogue_id),
    inspection_pin_code: def.inspection_pin_code,
    appointment_type_ref: def.appointment_type_ref,
    workflow_nodes: def.workflow_nodes,
    tenant_id: TENANT_ID,
    tenant_service_binding_id: tsbId,
    service_id: serviceId,
    /** Lab-only Studio → TSB pin graph. Not on citizen placement. */
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

export function buildLicencePermitPinDemoCatalogue() {
  return {
    _note:
      'SAMPLE_LAB Studio → TSB pin demos for Licence/Permit packs. DRAFT/DUMMY only; not on citizen placement; not statute. Aligns inspection/schedule catalogues to real registry IDs. CERTIFIED=false · G6=false.',
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
    targets: LICENCE_PERMIT_PIN_DEMO_DEFS.map(buildPinDemoTarget),
  };
}
