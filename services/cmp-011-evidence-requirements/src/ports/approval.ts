import { Cmp011Error } from '../errors.js';

export interface ApprovalOk {
  ok: true;
  request_id: string;
}

/** CMP-051 maker-checker approval, consumed through this port only. */
export interface ApprovalPort {
  requireApproved(input: { policyId: string; proposedHash: string }): Promise<ApprovalOk>;
}

export class DenyApprovalPort implements ApprovalPort {
  async requireApproved(): Promise<ApprovalOk> {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'CHECKER_APPROVAL_REQUIRED' }] });
  }
}

export function wrapApprovalPort(port: ApprovalPort): ApprovalPort {
  return {
    async requireApproved(input) {
      try {
        return await port.requireApproved(input);
      } catch (err) {
        if (err instanceof Cmp011Error) throw err;
        throw new Cmp011Error('SF-SYS-004', {
          details: [{ code: 'APPROVAL_PORT_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}
