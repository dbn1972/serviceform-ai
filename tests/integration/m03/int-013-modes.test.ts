import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate, type ConnectorBinding } from '@serviceform/contracts';
import { assertConnectorImportSafe } from '../../../services/cmp-034-master-data/src/domain/import-binding.js';
import { assertSchemaRegistryModeAllowed } from '../../../services/cmp-033-metadata/src/config.js';
import { assertConnectorModeAllowed as assert051Mode } from '../../../services/cmp-051-maker-checker/src/config.js';
import { assertConnectorModeAllowed as assert052Mode } from '../../../services/cmp-052-versioning/src/config.js';
import { assertAssistBindingSafe } from '../../../services/cmp-053-localization/src/ports/assist.js';

const EXAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/shared/examples/valid/connector-binding.local.json',
);

function binding(overrides: Partial<ConnectorBinding> = {}): ConnectorBinding {
  const base = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ConnectorBinding;
  return {
    ...base,
    connector_type: 'DEPARTMENT_API',
    ...overrides,
  };
}

describe('INT-013 M03 connector modes (independent; REAL/SANDBOX/SIMULATED)', () => {
  it('SIMULATED DEPARTMENT_API import is allowed in LOCAL/CI and emits a frozen marker shape', () => {
    const local = assertConnectorImportSafe(
      binding({ environment: 'LOCAL', mode: 'SIMULATED' }),
      'LOCAL',
    );
    expect(local.mode).toBe('SIMULATED');
    const ci = assertConnectorImportSafe(binding({ environment: 'CI', mode: 'SIMULATED' }), 'CI');
    expect(ci.mode).toBe('SIMULATED');
    expect(validate('connector-binding', local).valid).toBe(true);
  });

  it('REAL and SANDBOX import adapters fail closed (adapter not shipped)', () => {
    expect(() =>
      assertConnectorImportSafe(binding({ environment: 'LOCAL', mode: 'REAL' }), 'LOCAL'),
    ).toThrow();
    expect(() =>
      assertConnectorImportSafe(binding({ environment: 'LOCAL', mode: 'SANDBOX' }), 'LOCAL'),
    ).toThrow();
  });

  it('PRODUCTION refuses SIMULATED import; PRODUCTION REAL still fail-closed until adapter exists', () => {
    expect(() =>
      assertConnectorImportSafe(
        binding({ environment: 'PRODUCTION', mode: 'SIMULATED', critical: true }),
        'PRODUCTION',
      ),
    ).toThrow();
    expect(() =>
      assertConnectorImportSafe(binding({ environment: 'PRODUCTION', mode: 'REAL' }), 'PRODUCTION'),
    ).toThrow();
  });

  it('CMP-033/051/052 refuse REAL/SANDBOX and PRODUCTION SIMULATED ports', () => {
    expect(() => assertSchemaRegistryModeAllowed('REAL', 'LOCAL')).toThrow();
    expect(() => assertSchemaRegistryModeAllowed('SANDBOX', 'CI')).toThrow();
    expect(() => assertSchemaRegistryModeAllowed('SIMULATED', 'PRODUCTION')).toThrow();
    expect(() => assert051Mode('REAL', 'LOCAL', 'METADATA')).toThrow();
    expect(() => assert051Mode('SANDBOX', 'CI', 'VERSIONING')).toThrow();
    expect(() => assert051Mode('SIMULATED', 'PRODUCTION', 'AI')).toThrow();
    expect(() => assert052Mode('REAL', 'LOCAL', 'APPROVAL')).toThrow();
    expect(() => assert052Mode('SANDBOX', 'SIT', 'APPROVAL')).toThrow();
    expect(() => assert052Mode('SIMULATED', 'PRODUCTION', 'APPROVAL')).toThrow();
  });

  it('CMP-053 assist refuses SIMULATED when deployment is PRODUCTION and env mismatches', () => {
    const simLocal = binding({
      connector_type: 'DEPARTMENT_API',
      environment: 'LOCAL',
      mode: 'SIMULATED',
      critical: false,
    });
    expect(() => assertAssistBindingSafe('LOCAL', simLocal)).not.toThrow();
    expect(() => assertAssistBindingSafe('PRODUCTION', simLocal)).toThrow();
    expect(() => assertAssistBindingSafe('CI', simLocal)).toThrow();
  });
});
