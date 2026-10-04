import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectorBinding } from '@serviceform/contracts';

const EXAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts/shared/examples/valid/connector-binding.local.json',
);

/** Frozen SF-CON-CONNECTOR-BINDING LOCAL example, typed for CMP-034 tests. */
export function localSimulatedBinding(overrides: Partial<ConnectorBinding> = {}): ConnectorBinding {
  const base = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ConnectorBinding;
  return { ...base, connector_type: 'DEPARTMENT_API', ...overrides };
}
