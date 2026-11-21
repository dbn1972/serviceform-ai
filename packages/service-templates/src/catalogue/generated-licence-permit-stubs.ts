import universe from './licence-permit-universe.json';
import { buildGenericCertificateStub, type RegistryCertificateEntry } from './generic-stub';
import type { CertificateTemplate } from '../types';

/**
 * Filter: Service / Output Type ∈ {Licence, Permit} from
 * docs/catalogue/India_Gov_Normalized_Service_Registry.json (v1.0).
 * Same SAMPLE_LAB DUMMY + tenant jurisdiction scope pattern as Certificate stubs.
 */

export const LICENCE_PERMIT_UNIVERSE_FILTER = {
  source: universe.source,
  catalogue_version: universe.catalogue_version,
  field: universe.filter.field,
  equals_any: universe.filter.equals_any,
  registry_count: universe.count,
} as const;

const entries = universe.entries as RegistryCertificateEntry[];

const ALLOWED = new Set(['Licence', 'Permit']);
for (const t of universe.filter.equals_any) {
  if (!ALLOWED.has(t)) throw new Error(`licence-permit-universe filter includes unknown type ${t}`);
}

export function licencePermitUniverseIds(): readonly string[] {
  return entries.map((e) => e['Canonical Service ID']);
}

/** Generic DRAFT stubs for Licence and Permit registry entries. */
export const GENERATED_LICENCE_PERMIT_STUBS: readonly CertificateTemplate[] = entries.map(
  buildGenericCertificateStub,
);
