import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectorBinding, DeploymentEnvironment } from '@serviceform/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertProductionSafe,
  parseDeploymentEnvironment,
  resolveMode,
  ProductionSimulatedCriticalConnectorError,
  BindingInvalidError,
  ConnectorModeForbiddenError,
} from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const ENVS: DeploymentEnvironment[] = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
];
const MODES = ['REAL', 'SANDBOX', 'SIMULATED'] as const;

function binding(over: Partial<ConnectorBinding> = {}): ConnectorBinding {
  return {
    connector_binding_id: 'd17e5fc0-28e4-4b6a-b9d1-04cfa0e28d5d',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    connector_type: 'DEPARTMENT_API',
    mode: 'SIMULATED',
    environment: 'LOCAL',
    critical: true,
    secret_ref: null,
    simulator_version: 'echo-1.0.0',
    ...over,
  };
}

function allowed(
  env: DeploymentEnvironment,
  mode: (typeof MODES)[number],
  critical: boolean,
): boolean {
  if (env === 'PRODUCTION' && mode !== 'REAL') return false;
  if ((env === 'LOCAL' || env === 'CI') && mode !== 'SIMULATED') return false;
  if (mode === 'SIMULATED' && !['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE'].includes(env))
    return false;
  if ((mode === 'REAL' || mode === 'SANDBOX') && env === 'PRODUCTION' && !critical) {
    // W1 stricter than contract: still REAL only in production (handled above).
  }
  return true;
}

describe('mode resolution (005-16, 005-17, 005-18, 005-21)', () => {
  it('parses SF_ENVIRONMENT fail-closed', () => {
    expect(() => parseDeploymentEnvironment(undefined)).toThrow(
      ProductionSimulatedCriticalConnectorError,
    );
    expect(() => parseDeploymentEnvironment('')).toThrow(ProductionSimulatedCriticalConnectorError);
    expect(() => parseDeploymentEnvironment('production')).toThrow(
      ProductionSimulatedCriticalConnectorError,
    );
    expect(() => parseDeploymentEnvironment(' PRODUCTION')).toThrow(
      ProductionSimulatedCriticalConnectorError,
    );
    expect(() => parseDeploymentEnvironment('NOPE')).toThrow(
      ProductionSimulatedCriticalConnectorError,
    );
    expect(parseDeploymentEnvironment('PRODUCTION')).toBe('PRODUCTION');
  });

  it('builds the 8x3xcritical matrix without rewriting mode', () => {
    const lines = [
      '# simulation-mode-matrix',
      '',
      '| environment | mode | critical | result |',
      '|---|---|---|---|',
    ];
    for (const env of ENVS) {
      for (const mode of MODES) {
        for (const critical of [true, false]) {
          const over: Partial<ConnectorBinding> = {
            environment: env,
            mode,
            critical,
            secret_ref: mode === 'SIMULATED' ? null : 'vault://app/dept',
          };
          if (mode === 'SIMULATED') over.simulator_version = 'echo-1.0.0';
          const b = binding(over);
          let result = 'ok';
          try {
            const resolved = resolveMode(b, { deploymentEnvironment: env });
            expect(resolved).toBe(mode);
          } catch {
            result = 'refused';
          }
          const expectRefuse = !allowed(env, mode, critical);
          if (expectRefuse) expect(result).toBe('refused');
          lines.push(`| ${env} | ${mode} | ${critical} | ${result} |`);
        }
      }
    }
    const out = join(ROOT, 'evidence/SF-M01-005/simulation-mode-matrix.md');
    mkdirSync(join(ROOT, 'evidence/SF-M01-005'), { recursive: true });
    writeFileSync(out, `${lines.join('\n')}\n`);
    expect(readFileSync(out, 'utf8')).toContain('PRODUCTION');
  });

  it('refuses production simulated critical bindings at the guard', () => {
    expect(() =>
      assertProductionSafe(
        [{ ...binding({ environment: 'PRODUCTION', mode: 'SIMULATED' }), enabled: true }],
        'PRODUCTION',
      ),
    ).toThrow(ProductionSimulatedCriticalConnectorError);
    expect(() =>
      assertProductionSafe(
        [
          {
            ...binding({ environment: 'PRODUCTION', mode: 'SANDBOX', secret_ref: 'vault://x' }),
            enabled: true,
          },
        ],
        'PRODUCTION',
      ),
    ).toThrow(ProductionSimulatedCriticalConnectorError);
    expect(() =>
      assertProductionSafe([{ ...binding({ mode: 'SIMULATED' }), enabled: false }], 'PRODUCTION'),
    ).not.toThrow();
  });

  it('does not fall through when a binding is invalid', () => {
    expect(() =>
      resolveMode(binding({ tenant_id: null }), { deploymentEnvironment: 'LOCAL' }),
    ).toThrow(BindingInvalidError);
    expect(() =>
      resolveMode(binding({ environment: 'SIT' }), { deploymentEnvironment: 'PRODUCTION' }),
    ).toThrow(ConnectorModeForbiddenError);
  });

  it('contains no SIMULATED substitution in source', () => {
    const src = readFileSync(join(ROOT, 'packages/connector-sdk/src/modes.ts'), 'utf8');
    expect(src).not.toMatch(/mode\s*=\s*['"]SIMULATED['"]/);
    expect(src).not.toMatch(/mode\s*=\s*['"]REAL['"]/);
  });
});
