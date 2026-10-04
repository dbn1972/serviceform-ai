import type { SimulationMarker } from '@serviceform/contracts';
import { buildSimulationMarker, type MakerCheckerConfig } from '../config.js';
import { isContentHash, isUuid } from '../domain/ids.js';
import { Cmp051Error } from '../errors.js';

export interface VersioningCheckOk {
  ok: true;
  artifact_hash: string;
  simulation?: SimulationMarker;
}

export interface VersioningPort {
  confirmHash(input: { bindingId: string; proposedHash: string }): Promise<VersioningCheckOk>;
}

export class SimulatedVersioningPort implements VersioningPort {
  constructor(
    private readonly config: MakerCheckerConfig,
    private readonly fail = false,
  ) {}

  async confirmHash(input: {
    bindingId: string;
    proposedHash: string;
  }): Promise<VersioningCheckOk> {
    if (this.fail) {
      throw new Cmp051Error('SF-SYS-004', { details: [{ code: 'VERSIONING_PORT_UNAVAILABLE' }] });
    }
    if (!isUuid(input.bindingId) || !isContentHash(input.proposedHash)) {
      throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'HASH_CONFIRM_INVALID' }] });
    }
    const result: VersioningCheckOk = { ok: true, artifact_hash: input.proposedHash };
    if (this.config.versioningMode === 'SIMULATED') {
      result.simulation = buildSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.versioningBindingId,
      });
    }
    return result;
  }
}

export function failingVersioningPort(config: MakerCheckerConfig): VersioningPort {
  return new SimulatedVersioningPort(config, true);
}

export function wrapVersioningPort(port: VersioningPort): VersioningPort {
  return {
    async confirmHash(input) {
      try {
        return await port.confirmHash(input);
      } catch (err) {
        if (err instanceof Cmp051Error) throw err;
        throw new Cmp051Error('SF-SYS-004', {
          details: [{ code: 'VERSIONING_PORT_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}
