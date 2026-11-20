import universe from './certificate-universe.json';
import {
  buildGenericCertificateStub,
  CERTIFICATE_OUTPUT_TYPE,
  HANDCRAFTED_CERTIFICATE_IDS,
  type RegistryCertificateEntry,
} from './generic-stub';
import type { CertificateTemplate } from '../types';

/**
 * Filter (documented): Service / Output Type == "Certificate" from
 * docs/catalogue/India_Gov_Normalized_Service_Registry.json (v1.0).
 * Hand-crafted Certificate templates (Residence, Income, Domicile) are excluded here.
 * Birth (IND-CIV-001) is Registration and lives in stubs.ts — not in this filter.
 */

export const CERTIFICATE_UNIVERSE_FILTER = {
  source: universe.source,
  catalogue_version: universe.catalogue_version,
  field: universe.filter.field,
  equals: universe.filter.equals,
  registry_certificate_count: universe.count,
} as const;

const entries = universe.entries as RegistryCertificateEntry[];

if (universe.filter.equals !== CERTIFICATE_OUTPUT_TYPE) {
  throw new Error('certificate-universe.json filter must equal Certificate');
}

/** Every Certificate-type registry id (158), including hand-crafted ones. */
export function certificateUniverseIds(): readonly string[] {
  return entries.map((e) => e['Canonical Service ID']);
}

/** Generic DRAFT stubs for Certificate entries not covered by hand-crafted templates. */
export const GENERATED_CERTIFICATE_STUBS: readonly CertificateTemplate[] = entries
  .filter((e) => !HANDCRAFTED_CERTIFICATE_IDS.has(e['Canonical Service ID']))
  .map(buildGenericCertificateStub);
