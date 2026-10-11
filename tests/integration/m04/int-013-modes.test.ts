import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate, type ConnectorBinding } from '@serviceform/contracts';
import {
  assertProviderModeAllowed,
  buildSimulationMarker as build039Marker,
} from '../../../services/cmp-039-ai-gateway/src/config.js';
import {
  assertConnectorModeAllowed as assert008Mode,
  buildSimulationMarker as build008Marker,
} from '../../../services/cmp-008-rules/src/config.js';
import {
  assertConnectorModeAllowed as assert009Mode,
  buildSimulationMarker as build009Marker,
} from '../../../services/cmp-009-dynamic-forms/src/config.js';
import {
  assertDigiLockerModeAllowed,
  loadConfig as load011Config,
} from '../../../services/cmp-011-evidence-requirements/src/config.js';
import {
  assertBindingSafe,
  requireSimulationMarker,
} from '../../../services/cmp-011-evidence-requirements/src/domain/connector-guard.js';
import {
  adapterBindings as uploadBindings,
  assertSimulationPolicy as assert013Sim,
} from '../../../services/cmp-013-document-upload/src/domain/simulation.js';
import {
  adapterBindings as ocrBindings,
  assertSimulationPolicy as assert014Sim,
} from '../../../services/cmp-014-document-intelligence/src/domain/simulation.js';
import { buildUploadService } from '../../../services/cmp-013-document-upload/src/plugin.js';
import { buildIntelligenceService } from '../../../services/cmp-014-document-intelligence/src/plugin.js';

const EXAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/shared/examples/valid/connector-binding.local.json',
);

const T1 = '11111111-1111-4111-8111-111111111111';
const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function binding(overrides: Partial<ConnectorBinding> = {}): ConnectorBinding {
  const base = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ConnectorBinding;
  return {
    ...base,
    connector_type: 'DIGILOCKER',
    tenant_id: T1,
    ...overrides,
  };
}

function simAdapter(mode: 'SIMULATED' | 'SANDBOX' | 'REAL' = 'SIMULATED') {
  return {
    mode,
    connectorBindingId: BINDING,
    ...(mode === 'SIMULATED'
      ? {
          simulation: {
            simulation: true as const,
            scenario: 'probe',
            test_run_id: 'm04-int',
            connector_binding_id: BINDING,
            environment: 'CI' as const,
          },
        }
      : {}),
  };
}

describe('INT-013 M04 connector modes (independent; REAL/SANDBOX/SIMULATED)', () => {
  it('CMP-039/008/009 SIMULATED allowed in CI; PRODUCTION SIMULATED fail-closed', () => {
    expect(() => assertProviderModeAllowed('SIMULATED', 'CI')).not.toThrow();
    expect(() => assertProviderModeAllowed('SIMULATED', 'PRODUCTION')).toThrow();
    expect(() => assertProviderModeAllowed('REAL', 'CI')).toThrow();
    expect(() => assertProviderModeAllowed('SANDBOX', 'LOCAL')).toThrow();
    expect(() => assert008Mode('SIMULATED', 'CI', 'PACK_SOURCE')).not.toThrow();
    expect(() => assert008Mode('SIMULATED', 'PRODUCTION', 'PACK_SOURCE')).toThrow();
    expect(() => assert008Mode('REAL', 'LOCAL', 'PACK_SOURCE')).toThrow();
    expect(() => assert009Mode('SIMULATED', 'CI', 'FORM_SOURCE')).not.toThrow();
    expect(() => assert009Mode('SIMULATED', 'PRODUCTION', 'LOCALIZATION')).toThrow();
    expect(() => assert009Mode('SANDBOX', 'CI', 'FORM_SOURCE')).toThrow();

    const m039 = build039Marker({
      environment: 'CI',
      scenario: 'advisory',
      testRunId: 'm04-int',
      bindingId: BINDING,
    });
    expect(m039.simulation).toBe(true);
    expect(validate('simulation-marker', m039).valid).toBe(true);
    expect(
      validate(
        'simulation-marker',
        build008Marker({
          environment: 'CI',
          scenario: 'eval',
          testRunId: 'm04-int',
          bindingId: BINDING,
        }),
      ).valid,
    ).toBe(true);
    expect(
      validate(
        'simulation-marker',
        build009Marker({
          environment: 'CI',
          scenario: 'form',
          testRunId: 'm04-int',
          bindingId: BINDING,
        }),
      ).valid,
    ).toBe(true);
  });

  it('CMP-011 DigiLocker SIMULATED allowed in CI; PRODUCTION / REAL / SANDBOX fail-closed', () => {
    expect(assertDigiLockerModeAllowed('SIMULATED', 'CI')).toBe('SIMULATED');
    expect(() => assertDigiLockerModeAllowed('SIMULATED', 'PRODUCTION')).toThrow();
    expect(() => assertDigiLockerModeAllowed('REAL', 'CI')).toThrow();
    expect(() => assertDigiLockerModeAllowed('SANDBOX', 'LOCAL')).toThrow();
    const cfg = load011Config({ SF_ENVIRONMENT: 'CI', SF_CMP011_DIGILOCKER_MODE: 'SIMULATED' });
    expect(cfg.digiLockerMode).toBe('SIMULATED');
    expect(() =>
      assertBindingSafe(binding({ environment: 'CI', mode: 'SIMULATED' }), 'CI', T1),
    ).not.toThrow();
    expect(() =>
      assertBindingSafe(
        binding({ environment: 'PRODUCTION', mode: 'SIMULATED' }),
        'PRODUCTION',
        T1,
      ),
    ).toThrow();
    const marker = requireSimulationMarker({
      environment: 'CI',
      scenario: 'dl',
      testRunId: 'm04-int',
      connectorBindingId: BINDING,
    });
    expect(validate('simulation-marker', marker).valid).toBe(true);
  });

  it('CMP-013 storage/scanner SIMULATED critical refuse PRODUCTION; CI admits with marker', () => {
    expect(() => assert013Sim(uploadBindings('CI', [simAdapter(), simAdapter()]))).not.toThrow();
    expect(() =>
      assert013Sim(uploadBindings('PRODUCTION', [simAdapter(), simAdapter()])),
    ).toThrow();
    expect(() =>
      buildUploadService({
        environment: 'PRODUCTION',
        repository: {} as never,
        resolveContext: async () => null,
        authorizer: {
          decide: async () => ({
            allow: false,
            reason_code: 'x',
            policy_revision: '1',
            decision_id: BINDING,
          }),
        },
        storage: simAdapter() as never,
        scanner: simAdapter() as never,
        workerActorId: BINDING,
      }),
    ).toThrow();
  });

  it('CMP-014 OCR SIMULATED critical refuse PRODUCTION; gateway port is the only inference path', () => {
    expect(() => assert014Sim(ocrBindings('CI', [simAdapter()]))).not.toThrow();
    expect(() => assert014Sim(ocrBindings('PRODUCTION', [simAdapter()]))).toThrow();
    expect(() =>
      buildIntelligenceService({
        environment: 'PRODUCTION',
        repository: {} as never,
        resolveContext: async () => null,
        authorizer: {
          decide: async () => ({
            allow: false,
            reason_code: 'x',
            policy_revision: '1',
            decision_id: BINDING,
          }),
        },
        sources: { resolve: async () => null },
        sourceAcl: { canRead: async () => false },
        ocr: simAdapter() as never,
        gateway: { invoke: async () => ({ ok: false, kind: 'DENIED', reason_code: 'x' }) },
      }),
    ).toThrow();
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../services/cmp-014-document-intelligence/src/ports/gateway-port.ts',
      ),
      'utf8',
    );
    expect(src).toMatch(/never provider SDKs/);
    expect(src).toContain('AiGatewayPort');
  });
});
