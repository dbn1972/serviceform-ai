import type { ConnectorBinding, SimulationMarker } from '@serviceform/contracts';
import { Cmp004Error } from '../errors.js';
import { hmacHex } from '../hashing.js';
import { requireSimulationMarker } from '../bindings.js';

export interface DigiLockerIdentityResult {
  subjectHash: string;
  simulation: SimulationMarker;
}

export interface DigiLockerIdentityAdapter {
  exchangeAuthorizationCode(input: {
    code: string;
    citizenId: string;
    testRunId: string;
  }): Promise<DigiLockerIdentityResult>;
}

export class SimulatedDigiLockerIdentityAdapter implements DigiLockerIdentityAdapter {
  constructor(
    private readonly binding: ConnectorBinding,
    private readonly pepper: string,
  ) {}

  async exchangeAuthorizationCode(input: {
    code: string;
    citizenId: string;
    testRunId: string;
  }): Promise<DigiLockerIdentityResult> {
    if (input.code.length < 8) throw new Cmp004Error('SF-AUTH-001');
    const simulation = requireSimulationMarker({
      simulation: true,
      scenario: 'digilocker_identity',
      test_run_id: input.testRunId,
      connector_binding_id: this.binding.connector_binding_id,
      environment: this.binding.environment,
    });
    return {
      subjectHash: hmacHex(this.pepper, `digilocker:${input.citizenId}:${input.code}`),
      simulation,
    };
  }
}
