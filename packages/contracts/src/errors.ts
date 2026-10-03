import { ERROR_CATALOGUE_DOCUMENT } from './schemas.js';

export interface ErrorCatalogueEntry {
  code: string;
  message: string;
  http: number[];
  source: string;
}

export const ERROR_CATALOGUE: readonly ErrorCatalogueEntry[] = ERROR_CATALOGUE_DOCUMENT.codes;

const byCode = new Map(ERROR_CATALOGUE.map((e) => [e.code, e]));

export function errorEntry(code: string): ErrorCatalogueEntry {
  const entry = byCode.get(code);
  if (!entry) throw new Error(`Error code not in catalogue: ${code}`);
  return entry;
}
