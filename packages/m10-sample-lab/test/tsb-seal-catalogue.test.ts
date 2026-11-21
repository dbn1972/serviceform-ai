import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_TSB_SEAL_CATALOGUE,
  SAMPLE_LAB_TSB_SEAL_DEFAULTS,
  labArtifactHash,
  proveLabTsbEngSeal,
  sampleLabResidencePins,
  targetForBinding,
} from '../src/tsb-seal-catalogue.js';

describe('SAMPLE_LAB TSB eng seal catalogue (SF-60)', () => {
  it('Residence target artifact_hash matches CMP-052-shaped recomputation', () => {
    const pins = sampleLabResidencePins();
    const hash = labArtifactHash({
      binding_key: SAMPLE_LAB_TSB_SEAL_DEFAULTS.binding_key,
      offering_ref: SAMPLE_LAB_TSB_SEAL_DEFAULTS.offering_ref,
      metadata_bundle_ref: SAMPLE_LAB_TSB_SEAL_DEFAULTS.metadata_bundle_ref,
      pins,
    });
    expect(hash).toBe(SAMPLE_LAB_TSB_SEAL_DEFAULTS.artifact_hash);
    expect(SAMPLE_LAB_TSB_SEAL_CATALOGUE.targets[0]?.artifact_hash).toBe(hash);
  });

  it('proveLabTsbEngSeal seals PUBLISHED SAMPLE_LAB target without claiming G6', () => {
    const target = SAMPLE_LAB_TSB_SEAL_CATALOGUE.targets[0]!;
    const att = proveLabTsbEngSeal({
      environment: 'LOCAL',
      source: 'SAMPLE_LAB',
      now: '2026-11-21T20:00:00.000Z',
      binding: {
        binding_id: target.tenant_service_binding_id,
        catalogue_id: target.catalogue_id,
        binding_key: target.binding_key,
        offering_ref: target.offering_ref,
        metadata_bundle_ref: target.metadata_bundle_ref,
        status: target.status,
        pins: target.pins,
        artifact_hash: target.artifact_hash,
      },
    });
    expect(att.lab_eng_sealed).toBe(true);
    expect(att.hash_verified).toBe(true);
    expect(att.mutation_refused).toBe(true);
    expect(att.tsb_immutability_sealed).toBe(false);
    expect(att.certified).toBe(false);
    expect(att.g6).toBe(false);
    expect(att.production_digilocker_ready).toBe(false);
    expect(att.sealed_at).toBe('2026-11-21T20:00:00.000Z');
  });

  it('refuses DRAFT and non-lab environments', () => {
    const target = SAMPLE_LAB_TSB_SEAL_CATALOGUE.targets[0]!;
    const draft = proveLabTsbEngSeal({
      environment: 'LOCAL',
      binding: {
        binding_id: target.tenant_service_binding_id,
        binding_key: target.binding_key,
        offering_ref: target.offering_ref,
        metadata_bundle_ref: target.metadata_bundle_ref,
        status: 'DRAFT',
        pins: target.pins,
        artifact_hash: target.artifact_hash,
      },
    });
    expect(draft.lab_eng_sealed).toBe(false);
    expect(draft.reason_codes).toContain('NOT_PUBLISHED');

    const prod = proveLabTsbEngSeal({
      environment: 'PRODUCTION',
      binding: {
        binding_id: target.tenant_service_binding_id,
        binding_key: target.binding_key,
        offering_ref: target.offering_ref,
        metadata_bundle_ref: target.metadata_bundle_ref,
        status: 'PUBLISHED',
        pins: target.pins,
        artifact_hash: target.artifact_hash,
      },
    });
    expect(prod.lab_eng_sealed).toBe(false);
    expect(prod.reason_codes).toContain('ENV_NOT_LAB');
  });

  it('detects hash mismatch', () => {
    const target = SAMPLE_LAB_TSB_SEAL_CATALOGUE.targets[0]!;
    const att = proveLabTsbEngSeal({
      environment: 'CI',
      binding: {
        binding_id: target.tenant_service_binding_id,
        binding_key: target.binding_key,
        offering_ref: target.offering_ref,
        metadata_bundle_ref: target.metadata_bundle_ref,
        status: 'PUBLISHED',
        pins: target.pins,
        artifact_hash: `sha256:${'ff'.repeat(32)}`,
      },
    });
    expect(att.lab_eng_sealed).toBe(false);
    expect(att.reason_codes).toContain('HASH_MISMATCH');
  });

  it('catalogue G6 gate fields stay false', () => {
    expect(SAMPLE_LAB_TSB_SEAL_CATALOGUE.tsb_immutability_sealed).toBe(false);
    expect(SAMPLE_LAB_TSB_SEAL_CATALOGUE.g6).toBe(false);
    expect(SAMPLE_LAB_TSB_SEAL_CATALOGUE.certified).toBe(false);
    expect(
      targetForBinding(
        SAMPLE_LAB_TSB_SEAL_CATALOGUE,
        SAMPLE_LAB_TSB_SEAL_DEFAULTS.tenant_service_binding_id,
      )?.catalogue_id,
    ).toBe('IND-SOC-002');
  });
});
