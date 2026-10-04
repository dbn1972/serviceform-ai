import type { ConnectorBinding, SimulationMarker } from '@serviceform/contracts';
import { hmacHex } from '../hashing.js';
import { requireSimulationMarker } from '../bindings.js';

export interface OtpChallengeResult {
  code: string;
  simulation: SimulationMarker;
}

export interface OtpAdapter {
  createChallenge(input: {
    challengeId: string;
    channelHash: string;
    testRunId: string;
  }): OtpChallengeResult;
  dispatch(input: { challengeId: string; channelHash: string }): Promise<void>;
}

export class SimulatedOtpAdapter implements OtpAdapter {
  constructor(
    private readonly binding: ConnectorBinding,
    private readonly pepper: string,
  ) {}

  createChallenge(input: {
    challengeId: string;
    channelHash: string;
    testRunId: string;
  }): OtpChallengeResult {
    const digest = hmacHex(this.pepper, `${input.channelHash}:${input.challengeId}`);
    const n = Number.parseInt(digest.slice(0, 8), 16) % 1_000_000;
    const code = n.toString().padStart(6, '0');
    const simulation = requireSimulationMarker({
      simulation: true,
      scenario: 'otp_challenge',
      test_run_id: input.testRunId,
      connector_binding_id: this.binding.connector_binding_id,
      environment: this.binding.environment,
    });
    return { code, simulation };
  }

  async dispatch(_input: { challengeId: string; channelHash: string }): Promise<void> {
    return;
  }
}
