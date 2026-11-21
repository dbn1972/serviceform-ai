import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LAB_TSB_SEAL_CATALOGUE,
  LAB_TSB_SEAL_DEFAULTS,
  createLabTsbSealStore,
  labArtifactHash,
  parseTsbSealCatalogue,
  proveLabTsbEngSeal,
  registerLabTsbSealRoutes,
  sampleLabResidencePins,
} from '../src/platform/tsb-seal.js';

const ROOT = join(import.meta.dirname, '../../..');
const FIXTURE = join(ROOT, 'fixtures/lab/platform/tsb-seal-catalogue.json');
const PACKAGE_SRC = join(ROOT, 'packages/m10-sample-lab/src/tsb-seal-catalogue.ts');

describe('SAMPLE_LAB TSB eng seal (SF-60)', () => {
  it('fixture and built-in catalogue share Residence artifact_hash', () => {
    const fromFile = parseTsbSealCatalogue(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    expect(fromFile.targets[0]?.artifact_hash).toBe(LAB_TSB_SEAL_DEFAULTS.artifact_hash);
    expect(fromFile.tsb_immutability_sealed).toBe(false);
    expect(fromFile.g6).toBe(false);
    const recomputed = labArtifactHash({
      binding_key: LAB_TSB_SEAL_DEFAULTS.binding_key,
      offering_ref: LAB_TSB_SEAL_DEFAULTS.offering_ref,
      metadata_bundle_ref: LAB_TSB_SEAL_DEFAULTS.metadata_bundle_ref,
      pins: sampleLabResidencePins(),
    });
    expect(recomputed).toBe(LAB_TSB_SEAL_DEFAULTS.artifact_hash);
  });

  it('package source declares lab eng seal without G6 claim', () => {
    const src = readFileSync(PACKAGE_SRC, 'utf8');
    expect(src).toContain('lab_eng_sealed');
    expect(src).toContain('tsb_immutability_sealed: false');
    expect(src).toContain('CERTIFIED=false');
  });

  it('proveLabTsbEngSeal succeeds for PUBLISHED SAMPLE_LAB target', () => {
    const target = LAB_TSB_SEAL_CATALOGUE.targets[0]!;
    const att = proveLabTsbEngSeal({
      environment: 'LOCAL',
      now: '2026-11-21T21:00:00.000Z',
      binding: {
        binding_id: target.tenant_service_binding_id,
        catalogue_id: target.catalogue_id,
        binding_key: target.binding_key,
        offering_ref: target.offering_ref,
        metadata_bundle_ref: target.metadata_bundle_ref,
        status: 'PUBLISHED',
        pins: target.pins,
        artifact_hash: target.artifact_hash,
      },
    });
    expect(att.lab_eng_sealed).toBe(true);
    expect(att.hash_verified).toBe(true);
    expect(att.mutation_refused).toBe(true);
    expect(att.tsb_immutability_sealed).toBe(false);
    expect(att.g6).toBe(false);
    expect(att.certified).toBe(false);
  });

  it('proveLabTsbEngSeal refuses PRODUCTION and DRAFT', () => {
    const target = LAB_TSB_SEAL_CATALOGUE.targets[0]!;
    expect(
      proveLabTsbEngSeal({
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
      }).lab_eng_sealed,
    ).toBe(false);
    expect(
      proveLabTsbEngSeal({
        environment: 'CI',
        binding: {
          binding_id: target.tenant_service_binding_id,
          binding_key: target.binding_key,
          offering_ref: target.offering_ref,
          metadata_bundle_ref: target.metadata_bundle_ref,
          status: 'DRAFT',
          pins: target.pins,
          artifact_hash: target.artifact_hash,
        },
      }).reason_codes,
    ).toContain('NOT_PUBLISHED');
  });
});

describe('SAMPLE_LAB TSB eng seal HTTP routes', () => {
  const app = Fastify({ logger: false });
  const store = createLabTsbSealStore();
  const bindingId = LAB_TSB_SEAL_DEFAULTS.tenant_service_binding_id;

  beforeAll(async () => {
    registerLabTsbSealRoutes(app, {
      environment: 'LOCAL',
      catalogue: LAB_TSB_SEAL_CATALOGUE,
      store,
      defaultTenantId: LAB_TSB_SEAL_DEFAULTS.tenant_id,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET catalogue exposes lab eng seal without G6 claim', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/lab/tsb-seal/catalogue' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      lab_eng_seal_available: boolean;
      tsb_immutability_sealed: boolean;
      g6_issued: boolean;
      certified: boolean;
    };
    expect(body.lab_eng_seal_available).toBe(true);
    expect(body.tsb_immutability_sealed).toBe(false);
    expect(body.g6_issued).toBe(false);
    expect(body.certified).toBe(false);
  });

  it('POST prove seals Residence binding and GET returns attestation', async () => {
    const prove = await app.inject({
      method: 'POST',
      url: `/v1/lab/tsb-seal/${bindingId}/prove`,
      payload: { catalogue_id: 'IND-SOC-002' },
    });
    expect(prove.statusCode).toBe(200);
    const att = prove.json() as {
      lab_eng_sealed: boolean;
      tsb_immutability_sealed: boolean;
      g6: boolean;
      certified: boolean;
      hash_verified: boolean;
    };
    expect(att.lab_eng_sealed).toBe(true);
    expect(att.hash_verified).toBe(true);
    expect(att.tsb_immutability_sealed).toBe(false);
    expect(att.g6).toBe(false);
    expect(att.certified).toBe(false);

    const get = await app.inject({ method: 'GET', url: `/v1/lab/tsb-seal/${bindingId}` });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { lab_eng_sealed: boolean }).lab_eng_sealed).toBe(true);
  });
});
