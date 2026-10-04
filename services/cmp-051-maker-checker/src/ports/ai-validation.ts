import type { SimulationMarker } from '@serviceform/contracts';
import { buildSimulationMarker, type MakerCheckerConfig } from '../config.js';

export interface AiAdvisory {
  blocking: false;
  skipped: boolean;
  finding_count: number;
  codes: string[];
  simulation?: SimulationMarker;
}

export interface AiValidationPort {
  review(input: { requestId: string; proposedHash: string }): Promise<AiAdvisory>;
}

/** CMP-043 is optional and must never block the publication engine. */
export class OffAiValidationPort implements AiValidationPort {
  async review(_input: { requestId: string; proposedHash: string }): Promise<AiAdvisory> {
    void _input;
    return { blocking: false, skipped: true, finding_count: 0, codes: ['AI_REVIEW_OFF'] };
  }
}

export class SimulatedAiValidationPort implements AiValidationPort {
  constructor(private readonly config: MakerCheckerConfig) {}

  async review(): Promise<AiAdvisory> {
    const advisory: AiAdvisory = {
      blocking: false,
      skipped: false,
      finding_count: 0,
      codes: ['AI_ADVISORY_ONLY'],
    };
    if (this.config.aiMode === 'SIMULATED') {
      advisory.simulation = buildSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.aiBindingId,
      });
    }
    return advisory;
  }
}

export function wrapAiValidationPort(port: AiValidationPort): AiValidationPort {
  return {
    async review(input) {
      try {
        const out = await port.review(input);
        return {
          blocking: false,
          skipped: out.skipped,
          finding_count: out.finding_count,
          codes: out.codes.slice(0, 16),
          ...(out.simulation ? { simulation: out.simulation } : {}),
        };
      } catch {
        return {
          blocking: false,
          skipped: true,
          finding_count: 0,
          codes: ['AI_REVIEW_UNAVAILABLE'],
        };
      }
    },
  };
}
