import { randomUUID } from 'node:crypto';
import type { PinGraph } from '../../src/domain/pins.js';
import type { ActorType, TenantRequestContext } from '../../src/domain/validate.js';
import { SimulatedPublishedBindingPort } from '../../src/ports/published-binding.js';
import { SimulatedServicePolicyPort } from '../../src/ports/service-policy.js';
import type {
  WorkflowAdvancePort,
  WorkflowAdvanceSignal,
} from '../../src/ports/workflow-advance.js';
import { ApplicationCaseService } from '../../src/service.js';
import type { CaseStore } from '../../src/store/types.js';
import { ContractAuthorizer } from './authorizer.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
export const OFFICER = '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f';
export const SYSTEM = '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e';
export const AI_GATEWAY = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const SERVICE_ID = '5ee5ee5e-5ee5-45ee-85ee-5ee5ee5ee5ee';
export const TSB_T1 = '88888888-8888-4888-8888-888888888888';
export const TSB_T2 = '89898989-8989-4898-8989-898989898989';
/** Canary id that must never appear in another tenant's responses (INT-011). */
export const CANARY = '00000000-0000-4000-8000-000000000099';

export function pinsFor(tsb: string): PinGraph {
  return {
    tenant_service_binding_id: tsb,
    form_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    rule_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    workflow_version_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    evidence_policy_version_id: '12121212-1212-4121-8121-121212121212',
    sla_policy_version_id: '14141414-1414-4141-8141-141414141414',
    fee_policy_version_id: '13131313-1313-4131-8131-131313131313',
    authorization_policy_version_id: '17171717-1717-4171-8171-171717171717',
  };
}

export function ctx(
  tenant: string,
  type: ActorType,
  id: string,
  extra: Partial<TenantRequestContext> = {},
): TenantRequestContext {
  const base: TenantRequestContext = {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type, id },
    roles: type === 'CITIZEN' ? ['APPLICANT'] : ['CASE_OFFICER'],
    jurisdiction_ids: [],
    auth_assurance: type === 'SYSTEM' || type === 'INTEGRATION' ? 'WORKLOAD_IDENTITY' : 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...extra,
  };
  if (type === 'INTEGRATION' && !base.purpose) base.purpose = 'AI_ASSISTANCE';
  return base;
}

export class RecordingWorkflow implements WorkflowAdvancePort {
  readonly signals: WorkflowAdvanceSignal[] = [];
  fail = false;
  async advance(signal: WorkflowAdvanceSignal): Promise<void> {
    if (this.fail) throw new Error('temporal unavailable');
    this.signals.push(signal);
  }
}

export interface Harness {
  service: ApplicationCaseService;
  authorizer: ContractAuthorizer;
  bindings: SimulatedPublishedBindingPort;
  policy: SimulatedServicePolicyPort;
  workflow: RecordingWorkflow;
}

export function harness(store: CaseStore, clock?: () => Date): Harness {
  const authorizer = new ContractAuthorizer();
  const bindings = new SimulatedPublishedBindingPort();
  bindings.put(T1, {
    tenant_service_binding_id: TSB_T1,
    service_id: SERVICE_ID,
    status: 'PUBLISHED',
    pins: pinsFor(TSB_T1),
  });
  bindings.put(T2, {
    tenant_service_binding_id: TSB_T2,
    service_id: SERVICE_ID,
    status: 'PUBLISHED',
    pins: pinsFor(TSB_T2),
  });
  const policy = new SimulatedServicePolicyPort();
  const workflow = new RecordingWorkflow();
  const service = new ApplicationCaseService({
    store,
    authorizer,
    bindings,
    servicePolicy: policy,
    workflow,
    config: { environment: 'CI' },
    ...(clock ? { clock } : {}),
  });
  return { service, authorizer, bindings, policy, workflow };
}

let keySeq = 0;
export function key(prefix = 'key'): string {
  keySeq += 1;
  return `${prefix}-${String(keySeq).padStart(6, '0')}-${randomUUID().slice(0, 8)}`;
}

export const HUMAN = { decision_maker: 'HUMAN' } as const;
