import {
  validate,
  type ConnectorBinding,
  type ConnectorMode,
  type DeploymentEnvironment,
  type SimulationMarker,
} from '@serviceform/contracts';
import { Cmp053Error } from '../errors.js';

export interface AssistRequest {
  source_locale_tag: string;
  target_locale_tag: string;
  message_key: string;
  source_text: string;
  test_run_id?: string;
}

export interface AssistSuggestion {
  suggested_text: string;
  authoritative: false;
  label: 'TEST/SIMULATED';
  simulation: SimulationMarker;
}

export interface TranslationAssistPort {
  suggest(input: AssistRequest): Promise<AssistSuggestion>;
}

const SIM_ENV = new Set(['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE']);

export function assertAssistBindingSafe(
  env: DeploymentEnvironment,
  binding: ConnectorBinding | null,
): void {
  if (!binding) return;
  const checked = validate('connector-binding', binding);
  if (!checked.valid) {
    throw new Cmp053Error('SF-INT-001', { details: [{ code: 'BINDING_INVALID' }] });
  }
  if (binding.environment !== env) {
    throw new Cmp053Error('SF-INT-001', { details: [{ code: 'BINDING_ENV_MISMATCH' }] });
  }
  if (env === 'PRODUCTION' && binding.mode === 'SIMULATED') {
    throw new Cmp053Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
  }
  if (env === 'PRODUCTION' && binding.critical && binding.mode !== 'REAL') {
    throw new Cmp053Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
  }
  if ((env === 'UAT' || env === 'PREPROD') && binding.mode === 'SIMULATED') {
    throw new Cmp053Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
  }
}

export function modeForbiddenInEnv(env: DeploymentEnvironment, mode: ConnectorMode): boolean {
  if (env === 'PRODUCTION' && mode === 'SIMULATED') return true;
  if ((env === 'UAT' || env === 'PREPROD') && mode === 'SIMULATED') return true;
  return false;
}

export class DisabledAssistPort implements TranslationAssistPort {
  async suggest(): Promise<AssistSuggestion> {
    throw new Cmp053Error('SF-INT-001', { details: [{ code: 'ASSIST_UNAVAILABLE' }] });
  }
}

export class SimulatedAssistAdapter implements TranslationAssistPort {
  constructor(private readonly binding: ConnectorBinding) {}

  async suggest(input: AssistRequest): Promise<AssistSuggestion> {
    if (this.binding.mode !== 'SIMULATED') {
      throw new Cmp053Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
    }
    if (!SIM_ENV.has(this.binding.environment)) {
      throw new Cmp053Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
    }
    const testRunId = input.test_run_id;
    if (!testRunId) {
      throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'TEST_RUN_ID' }] });
    }
    const marker: SimulationMarker = {
      simulation: true,
      scenario: 'success',
      test_run_id: testRunId,
      connector_binding_id: this.binding.connector_binding_id,
      environment: this.binding.environment as SimulationMarker['environment'],
    };
    const checked = validate('simulation-marker', marker);
    if (!checked.valid) {
      throw new Cmp053Error('SF-INT-001', { details: [{ code: 'MARKER_INVALID' }] });
    }
    return {
      suggested_text: 'TEST/SIMULATED',
      authoritative: false,
      label: 'TEST/SIMULATED',
      simulation: marker,
    };
  }
}
