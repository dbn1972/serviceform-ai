import { createHash } from 'node:crypto';
import type { SimulationMarker } from '../../../packages/contracts/src/index.js';
import { validate } from '../../../packages/contracts/src/index.js';
import type { ConnectorBinding } from '../../../packages/contracts/src/index.js';

const ALLOWED_ENV = new Set(['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE']);

export const ECHO_SIMULATOR_VERSION = 'echo-1.0.0';

export const ECHO_SCENARIOS = [
  'success',
  'fail_permanent',
  'fail_transient_then_success',
  'timeout',
  'malformed_response',
  'duplicate_callback',
  'slow',
] as const;

export type EchoScenario = (typeof ECHO_SCENARIOS)[number];

export function buildSimulationMarker(
  binding: ConnectorBinding,
  input: { scenario: string; test_run_id: string },
): SimulationMarker {
  if (!ALLOWED_ENV.has(binding.environment)) {
    throw new Error('Simulator refuses this environment');
  }
  const marker: SimulationMarker = {
    simulation: true,
    scenario: input.scenario,
    test_run_id: input.test_run_id,
    connector_binding_id: binding.connector_binding_id,
    environment: binding.environment as SimulationMarker['environment'],
  };
  const result = validate('simulation-marker', marker);
  if (!result.valid) throw new Error('Simulation marker failed SF-CON-SIMULATION-MARKER');
  return marker;
}

export function deterministicId(parts: string[]): string {
  const h = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
