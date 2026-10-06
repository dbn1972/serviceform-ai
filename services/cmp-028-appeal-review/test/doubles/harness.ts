import { randomUUID } from 'node:crypto';
import { AppealService } from '../../src/service/appeal-service.js';
import type { Idempotency } from '../../src/service/appeal-service.js';
import type { TenantContext } from '../../src/context.js';
import { requestFingerprint } from '../../src/domain/fingerprint.js';
import type { CaseCommandPort, CaseCommandRequest } from '../../src/ports/case-command.js';
import type { WorkflowLinkPort, WorkflowLinkRequest } from '../../src/ports/workflow.js';
import { inDomainTransaction } from '../../src/tx-scope.js';
import { ScriptedAuthorizer } from './authorizer.js';
import { idemKey } from './fixtures.js';
import { MemoryAppealRepository } from './memory-repo.js';

export class RecordingCasePort implements CaseCommandPort {
  readonly calls: { inTxn: boolean; application_id: string; command_type: string }[] = [];
  cases = new Map<string, { state: string }>();

  async apply(_ctx: TenantContext, request: CaseCommandRequest): Promise<{ command_id: string }> {
    this.calls.push({
      inTxn: inDomainTransaction(),
      application_id: request.application_id,
      command_type: request.command_type,
    });
    this.cases.set(request.application_id, { state: request.command_type });
    return { command_id: randomUUID() };
  }
}

export class RecordingWorkflowPort implements WorkflowLinkPort {
  readonly calls: { inTxn: boolean; appeal_id: string }[] = [];

  async link(
    _ctx: TenantContext,
    request: WorkflowLinkRequest,
  ): Promise<{ workflow_instance_id: string }> {
    this.calls.push({ inTxn: inDomainTransaction(), appeal_id: request.appeal_id });
    return { workflow_instance_id: randomUUID() };
  }
}

export function makeService() {
  const repo = new MemoryAppealRepository();
  const authz = new ScriptedAuthorizer();
  const caseCommands = new RecordingCasePort();
  const workflow = new RecordingWorkflowPort();
  let tick = 0;
  let idSeq = 5000;
  const clock = () => new Date(Date.UTC(2026, 9, 6, 12, 0, tick++));
  const newId = () => `00000000-0000-4000-8000-${String(idSeq++).padStart(12, '0')}`;
  const service = new AppealService({ repo, authz, caseCommands, workflow, clock, newId });
  return { service, repo, authz, caseCommands, workflow };
}

export function idem(endpoint: string, body: unknown = null, key: string = idemKey()): Idempotency {
  return { key, endpoint, fingerprint: requestFingerprint('POST', endpoint, body) };
}

export type Ctx = TenantContext;
