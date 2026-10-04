import type { SimulationMarker } from '@serviceform/contracts';
import { buildSimulationMarker, type VersioningConfig } from '../config.js';
import { Cmp052Error } from '../errors.js';

export interface ApprovalOk {
  ok: true;
  request_id: string;
  simulation?: SimulationMarker;
}

export interface ApprovalPort {
  requireApproved(input: { bindingId: string; proposedHash: string }): Promise<ApprovalOk>;
}

export class DenyApprovalPort implements ApprovalPort {
  async requireApproved(): Promise<ApprovalOk> {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'CHECKER_APPROVAL_REQUIRED' }] });
  }
}

export class SimulatedApprovalPort implements ApprovalPort {
  constructor(
    private readonly config: VersioningConfig,
    private readonly allow: boolean,
  ) {}

  async requireApproved(input: { bindingId: string; proposedHash: string }): Promise<ApprovalOk> {
    if (!this.allow) {
      throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'CHECKER_APPROVAL_REQUIRED' }] });
    }
    const result: ApprovalOk = {
      ok: true,
      request_id: '05100000-0000-4000-8000-000000000051',
    };
    if (this.config.approvalMode === 'SIMULATED') {
      result.simulation = buildSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.approvalBindingId,
      });
    }
    void input;
    return result;
  }
}

export function wrapApprovalPort(port: ApprovalPort): ApprovalPort {
  return {
    async requireApproved(input) {
      try {
        return await port.requireApproved(input);
      } catch (err) {
        if (err instanceof Cmp052Error) throw err;
        throw new Cmp052Error('SF-SYS-004', {
          details: [{ code: 'APPROVAL_PORT_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}

export function failingApprovalPort(): ApprovalPort {
  return {
    async requireApproved() {
      throw new Error('approval-timeout');
    },
  };
}
