import type { SimulationMarker } from '@serviceform/contracts';
import { buildSimulationMarker, type MakerCheckerConfig } from '../config.js';
import { isContentHash } from '../domain/ids.js';
import { Cmp051Error } from '../errors.js';

export interface MetadataCheckOk {
  ok: true;
  simulation?: SimulationMarker;
}

export interface MetadataPort {
  assertPublishable(input: { proposedHash: string }): Promise<MetadataCheckOk>;
}

export class SimulatedMetadataPort implements MetadataPort {
  constructor(
    private readonly config: MakerCheckerConfig,
    private readonly fail = false,
  ) {}

  async assertPublishable(input: { proposedHash: string }): Promise<MetadataCheckOk> {
    if (this.fail) {
      throw new Cmp051Error('SF-SYS-004', { details: [{ code: 'METADATA_PORT_UNAVAILABLE' }] });
    }
    if (!isContentHash(input.proposedHash)) {
      throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'INVALID_PROPOSED_HASH' }] });
    }
    const result: MetadataCheckOk = { ok: true };
    if (this.config.metadataMode === 'SIMULATED') {
      result.simulation = buildSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.metadataBindingId,
      });
    }
    return result;
  }
}

export function failingMetadataPort(config: MakerCheckerConfig): MetadataPort {
  return new SimulatedMetadataPort(config, true);
}

export function wrapMetadataPort(port: MetadataPort): MetadataPort {
  return {
    async assertPublishable(input) {
      try {
        return await port.assertPublishable(input);
      } catch (err) {
        if (err instanceof Cmp051Error) throw err;
        throw new Cmp051Error('SF-SYS-004', {
          details: [{ code: 'METADATA_PORT_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}
