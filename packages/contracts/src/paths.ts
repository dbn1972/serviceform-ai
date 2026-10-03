import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-tree location of the governed contracts (CODEOWNERS: Architecture & Contract Guardian).
 * For scripts and tests only; runtime code uses the static imports in schemas.ts.
 */
export const CONTRACTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'contracts',
  'shared',
);
