import { randomUUID } from 'node:crypto';
import type { Assignment } from '../../src/domain/model.js';
import type { ActorType, TenantRequestContext } from '../../src/domain/validate.js';
import type {
  HumanTaskCreateRequest,
  HumanTaskPort,
  NotificationPort,
  RoutingPolicyPort,
  WorkflowAdvancePort,
  WorkflowAdvanceSignal,
} from '../../src/ports/external.js';
import { GrievanceFeedbackService } from '../../src/service.js';
import type { GrievanceStore } from '../../src/store/types.js';
import { ContractAuthorizer } from './authorizer.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
export const OFFICER = '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f';
export const SYSTEM = '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e';
export const AI_GATEWAY = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const JUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const OFFICE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const CANARY = '00000000-0000-4000-8000-000000000099';

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
    organisation_id: ORG,
    roles: type === 'CITIZEN' ? ['APPLICANT'] : ['GRIEVANCE_OFFICER'],
    jurisdiction_ids: [JUR],
    auth_assurance: type === 'SYSTEM' || type === 'INTEGRATION' ? 'WORKLOAD_IDENTITY' : 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...extra,
  };
  if (type === 'INTEGRATION' && !base.purpose) base.purpose = 'AI_ASSISTANCE';
  return base;
}

export function key(suffix: string): string {
  return `idem-${suffix}-xxxxxxxx`;
}

export const FIXED_ASSIGNMENT: Assignment = {
  role_code: 'GRIEVANCE_OFFICER',
  organisation_id: ORG,
  office_id: OFFICE,
  jurisdiction_id: JUR,
  service_scope_id: null,
};

export class FixedRouting implements RoutingPolicyPort {
  async resolve(): Promise<Assignment> {
    return { ...FIXED_ASSIGNMENT };
  }
}

export class RecordingWorkflow implements WorkflowAdvancePort {
  readonly signals: WorkflowAdvanceSignal[] = [];
  fail = false;
  async advance(signal: WorkflowAdvanceSignal): Promise<void> {
    if (this.fail) throw new Error('temporal unavailable');
    this.signals.push(signal);
  }
}

export class RecordingTasks implements HumanTaskPort {
  readonly created: HumanTaskCreateRequest[] = [];
  async create(_ctx: TenantRequestContext, request: HumanTaskCreateRequest): Promise<void> {
    this.created.push(request);
  }
}

export class SilentNotification implements NotificationPort {
  readonly sent: string[] = [];
  async requestNotification(params: {
    tenant_id: string;
    grievance_id: string;
    template_ref: string;
    idempotency_key: string;
  }): Promise<{ notification_ref: string }> {
    this.sent.push(params.template_ref);
    return { notification_ref: randomUUID() };
  }
}

export interface Harness {
  service: GrievanceFeedbackService;
  authorizer: ContractAuthorizer;
  workflow: RecordingWorkflow;
  tasks: RecordingTasks;
  notify: SilentNotification;
}

export function harness(store: GrievanceStore): Harness {
  const authorizer = new ContractAuthorizer();
  const workflow = new RecordingWorkflow();
  const tasks = new RecordingTasks();
  const notify = new SilentNotification();
  const service = new GrievanceFeedbackService({
    store,
    authorizer,
    routing: new FixedRouting(),
    workflow,
    tasks,
    notification: notify,
    clock: () => new Date('2026-10-06T12:00:00.000Z'),
  });
  return { service, authorizer, workflow, tasks, notify };
}
