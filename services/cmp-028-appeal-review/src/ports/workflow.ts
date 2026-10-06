import type { TenantContext } from '../context.js';

/** CMP-016 workflow port. CMP-028 does not host a second BPMN/Temporal runtime. */
export interface WorkflowLinkRequest {
  appeal_id: string;
  application_id: string;
  workflow_version_id: string;
  idempotency_key: string;
}

export interface WorkflowLinkPort {
  link(ctx: TenantContext, request: WorkflowLinkRequest): Promise<{ workflow_instance_id: string }>;
}

export function unconfiguredWorkflowPort(): WorkflowLinkPort {
  return {
    async link() {
      throw new Error('CMP-016 workflow port is unconfigured');
    },
  };
}
