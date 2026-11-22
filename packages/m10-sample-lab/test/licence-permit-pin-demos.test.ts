import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_APPOINTMENT_TYPES,
  SAMPLE_LAB_INSPECTION_PINS,
  SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS,
  isLicencePermitPinDemo,
  isSampleLabPinDemoEnvironment,
  pinDemoCatalogueIds,
  pinDemoForCatalogue,
  stubFormVersionId,
} from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('SAMPLE_LAB Licence/Permit Studio→TSB pin demos', () => {
  it('exposes three DRAFT/DUMMY targets with no statute/production offer claim', () => {
    // citizen_offerable=false = no statute claim; SAMPLE_LAB DUMMY lab placement may still bind.
    expect(SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.citizen_offerable).toBe(false);
    expect(SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.certified).toBe(false);
    expect(SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.g6).toBe(false);
    expect(SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.digilocker_mode).toBe('SIMULATED');
    expect(SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.sms_mode).toBe('SIMULATED');
    expect(SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.payment_mode).toBe('SIMULATED');
    expect(pinDemoCatalogueIds()).toEqual(['IND-BTP-001', 'IND-LAB-019', 'IND-ULB-007']);
    for (const t of SAMPLE_LAB_LICENCE_PERMIT_PIN_DEMOS.targets) {
      expect(t.status).toBe('DRAFT');
      expect(t.policy_kind).toBe('SAMPLE_LAB_DUMMY');
      expect(t.citizen_offerable).toBe(false);
      expect(t.pins.form_version_id).toBe(stubFormVersionId(t.catalogue_id));
      expect(t.authoring_path).toBe(`templates/certificate-packs/${t.catalogue_id.toLowerCase()}/`);
    }
  });

  it('aligns inspection and appointment catalogues to real registry ids', () => {
    expect(
      SAMPLE_LAB_INSPECTION_PINS.find((p) => p.pin_code === 'TRADE_LICENCE_SITE_VISIT')
        ?.catalogue_id,
    ).toBe('IND-BTP-001');
    expect(
      SAMPLE_LAB_INSPECTION_PINS.find((p) => p.pin_code === 'FACTORY_LICENCE_INSPECTION')
        ?.catalogue_id,
    ).toBe('IND-LAB-019');
    expect(
      SAMPLE_LAB_APPOINTMENT_TYPES.find(
        (t) => t.appointment_type_ref === 'meta:appointment-type:site-visit',
      )?.catalogue_id,
    ).toBe('IND-BTP-001');
    expect(
      SAMPLE_LAB_APPOINTMENT_TYPES.find(
        (t) => t.appointment_type_ref === 'meta:appointment-type:factory-inspection',
      )?.catalogue_id,
    ).toBe('IND-LAB-019');
  });

  it('fixture mirrors the TypeScript catalogue; SAMPLE_LAB DUMMY lab placement may bind demos', () => {
    const fixture = JSON.parse(
      readFileSync(join(ROOT, 'fixtures/lab/platform/licence-permit-pin-demos.json'), 'utf8'),
    ) as {
      citizen_offerable: boolean;
      targets: { catalogue_id: string; pins: { form_version_id: string } }[];
    };
    expect(fixture.citizen_offerable).toBe(false);
    expect(fixture.targets.map((t) => t.catalogue_id)).toEqual([...pinDemoCatalogueIds()]);
    for (const t of fixture.targets) {
      expect(t.pins.form_version_id).toBe(stubFormVersionId(t.catalogue_id));
      expect(pinDemoForCatalogue(t.catalogue_id)?.pins.form_version_id).toBe(
        t.pins.form_version_id,
      );
    }

    // Lab-offer expansion places these DRAFT stubs on SAMPLE_LAB placement (DUMMY only).
    const placement = JSON.parse(
      readFileSync(join(ROOT, 'fixtures/lab/platform/placement.citizen.json'), 'utf8'),
    ) as { offerings: { catalogue_id: string }[]; environment_label?: string };
    expect(placement.environment_label).toBe('SAMPLE_LAB');
    for (const id of pinDemoCatalogueIds()) {
      expect(placement.offerings.some((o) => o.catalogue_id === id)).toBe(true);
      expect(isLicencePermitPinDemo(id)).toBe(true);
    }
  });

  it('fail-closes outside SAMPLE_LAB LOCAL/CI', () => {
    expect(isSampleLabPinDemoEnvironment('LOCAL')).toBe(true);
    expect(isSampleLabPinDemoEnvironment('CI')).toBe(true);
    expect(isSampleLabPinDemoEnvironment('PRODUCTION')).toBe(false);
    expect(isSampleLabPinDemoEnvironment('UAT')).toBe(false);
  });
});
