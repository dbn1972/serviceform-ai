import type { SimulationMarker } from '@serviceform/contracts';
import { buildSimulationMarker, type AiGatewayConfig } from '../config.js';
import { Cmp039Error } from '../errors.js';
import { sha256Hash } from '../domain/ids.js';

export interface ModelPin {
  provider_id: string;
  model_id: string;
  model_version: string;
}

export interface ToolRef {
  tool_id: string;
  version: string;
}

export interface ProviderInvokeInput {
  model: ModelPin;
  prompt: string;
  maxOutputTokens: number;
  tools: readonly ToolRef[];
  signal: AbortSignal;
}

export interface ProviderInvokeOutput {
  text: string;
  tool_calls: ToolRef[];
  citations: { source_id: string }[];
  input_tokens: number;
  output_tokens: number;
}

export interface ProviderEmbedInput {
  model: ModelPin;
  inputs: readonly string[];
  signal: AbortSignal;
}

export interface ProviderEmbedOutput {
  vectors: number[][];
  input_tokens: number;
}

/**
 * Provider abstraction. Only the AI Gateway holds provider adapters; domain components call
 * the gateway and never a model provider directly (Eng v1.4 CMP-039 non-responsibilities).
 */
export interface ModelProviderPort {
  readonly providerId: string;
  readonly simulation?: SimulationMarker;
  invoke(input: ProviderInvokeInput): Promise<ProviderInvokeOutput>;
  embed(input: ProviderEmbedInput): Promise<ProviderEmbedOutput>;
}

export type ProviderRegistry = ReadonlyMap<string, ModelProviderPort>;

export const SIMULATED_SCENARIOS = [
  'advisory_success',
  'provider_outage',
  'provider_timeout',
  'unsafe_output',
  'binding_decision_output',
  'pii_output',
  'disallowed_tool_call',
  'oversized_output',
  'foreign_citation',
] as const;
export type SimulatedScenario = (typeof SIMULATED_SCENARIOS)[number];

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function vectorOf(text: string): number[] {
  const hex = sha256Hash(text).slice('sha256:'.length);
  const out: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    out.push(parseInt(hex.slice(i * 8, i * 8 + 8), 16) / 0xffffffff);
  }
  return out;
}

/** SIMULATED provider adapter (INT-013, SF-CON-SIMULATION-MARKER). Deterministic; no network. */
export class SimulatedModelProvider implements ModelProviderPort {
  readonly simulation: SimulationMarker;
  calls = 0;

  constructor(
    readonly providerId: string,
    config: AiGatewayConfig,
    readonly scenario: SimulatedScenario = 'advisory_success',
  ) {
    if (config.providerMode !== 'SIMULATED') {
      throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'SIMULATED_MODE_REQUIRED' }] });
    }
    this.simulation = buildSimulationMarker({
      environment: config.environment,
      scenario,
      testRunId: config.testRunId,
      bindingId: config.providerBindingId,
    });
  }

  async invoke(input: ProviderInvokeInput): Promise<ProviderInvokeOutput> {
    this.calls += 1;
    const base: ProviderInvokeOutput = {
      text: `Simulated advisory output ${sha256Hash(input.prompt).slice(7, 15)}`,
      tool_calls: [],
      citations: [],
      input_tokens: Math.ceil(input.prompt.length / 4),
      output_tokens: 12,
    };
    switch (this.scenario) {
      case 'provider_outage':
        throw new Error('simulated provider outage');
      case 'provider_timeout':
        return waitForAbort(input.signal);
      case 'unsafe_output':
        return { ...base, text: 'The application is hereby approved.' };
      case 'binding_decision_output':
        return { ...base, text: 'Final decision: the applicant is eligible.' };
      case 'pii_output':
        return { ...base, text: ['contact', ['person', 'example.org'].join('@')].join(' ') };
      case 'disallowed_tool_call':
        return { ...base, tool_calls: [{ tool_id: 'unlisted_tool', version: '1' }] };
      case 'oversized_output':
        return { ...base, output_tokens: input.maxOutputTokens + 1 };
      case 'foreign_citation':
        return { ...base, citations: [{ source_id: 'not-in-request' }] };
      default:
        return base;
    }
  }

  async embed(input: ProviderEmbedInput): Promise<ProviderEmbedOutput> {
    this.calls += 1;
    if (this.scenario === 'provider_outage') throw new Error('simulated provider outage');
    if (this.scenario === 'provider_timeout') return waitForAbort(input.signal);
    return {
      vectors: input.inputs.map((text) => vectorOf(text)),
      input_tokens: input.inputs.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
    };
  }
}

export function buildProviderRegistry(
  config: AiGatewayConfig,
  scenarios: Record<string, SimulatedScenario> = {},
): ProviderRegistry {
  const map = new Map<string, ModelProviderPort>();
  if (config.providerMode !== 'SIMULATED') return map;
  for (const id of ['sim-primary', 'sim-secondary']) {
    map.set(id, new SimulatedModelProvider(id, config, scenarios[id] ?? 'advisory_success'));
  }
  return map;
}
