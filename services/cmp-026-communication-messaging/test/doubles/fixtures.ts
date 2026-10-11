import { randomUUID } from 'node:crypto';
import type { ActorType, TenantRequestContext } from '../../src/domain/validate.js';
import type {
  AttachmentAccessGrant,
  AttachmentObjectDescriptor,
  AttachmentStoragePort,
  CaseParticipationPort,
  NoticeSignal,
  WorkflowSignalPort,
} from '../../src/ports/external.js';
import { MessagingService } from '../../src/service.js';
import { inDomainTransaction } from '../../src/tx-scope.js';
import type { MessagingStore } from '../../src/store/types.js';
import { ContractAuthorizer } from './authorizer.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
export const CITIZEN_B = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
export const OFFICER = '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f';
export const OFFICER_B = '0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e';
export const SYSTEM = '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const JUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const APP_1 = '33333333-3333-4333-8333-333333333333';
export const APP_2 = '44444444-4444-4444-8444-444444444444';
export const CANARY = '00000000-0000-4000-8000-000000000099';
export const NOW = new Date('2026-10-06T12:00:00.000Z');
export const KEY_OK = 'tenant/11111111/objects/demo-attachment-001';
export const SUM = `sha256:${'a'.repeat(64)}`;

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
    roles: type === 'CITIZEN' ? ['APPLICANT'] : ['CASE_OFFICER'],
    jurisdiction_ids: [JUR],
    auth_assurance: type === 'SYSTEM' || type === 'INTEGRATION' ? 'WORKLOAD_IDENTITY' : 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...extra,
  };
  if (type === 'INTEGRATION' && !base.purpose) base.purpose = 'AI_ASSISTANCE';
  return base;
}

let counter = 0;
export function key(suffix: string): string {
  counter += 1;
  return `idem-${suffix}-${String(counter).padStart(6, '0')}`;
}

export class RecordingParticipation implements CaseParticipationPort {
  readonly opened: { application_id: string }[] = [];
  readonly checked: { application_id: string; actor_id: string; role_code: string }[] = [];
  readonly calledInsideTransaction: boolean[] = [];
  denyOpen = false;
  readonly ineligible = new Set<string>();

  async canOpenThread(
    _ctx: TenantRequestContext,
    input: { application_id: string },
  ): Promise<boolean> {
    this.calledInsideTransaction.push(inDomainTransaction());
    this.opened.push(input);
    return !this.denyOpen;
  }

  async isEligibleParticipant(
    _ctx: TenantRequestContext,
    input: { application_id: string; actor_id: string; role_code: string },
  ): Promise<boolean> {
    this.calledInsideTransaction.push(inDomainTransaction());
    this.checked.push(input);
    return !this.ineligible.has(input.actor_id);
  }
}

export class RecordingStorage implements AttachmentStoragePort {
  readonly simulation = 'SIMULATED' as const;
  readonly objects = new Map<string, AttachmentObjectDescriptor>();
  readonly described: { tenantId: string; storageKey: string }[] = [];
  readonly accessed: string[] = [];
  readonly calledInsideTransaction: boolean[] = [];
  fail = false;

  register(tenant: string, storageKey: string, d?: Partial<AttachmentObjectDescriptor>): void {
    this.objects.set(`${tenant}|${storageKey}`, {
      byte_size: 1024,
      checksum_sha256: SUM,
      scan_verdict: 'CLEAN',
      ...d,
    });
  }

  async describeObject(input: {
    tenantId: string;
    storageKey: string;
  }): Promise<AttachmentObjectDescriptor | null> {
    this.calledInsideTransaction.push(inDomainTransaction());
    this.described.push(input);
    if (this.fail) throw new Error('object store unavailable');
    return this.objects.get(`${input.tenantId}|${input.storageKey}`) ?? null;
  }

  async issueDownloadAccess(input: {
    tenantId: string;
    storageKey: string;
    expiresAt: Date;
  }): Promise<AttachmentAccessGrant> {
    this.calledInsideTransaction.push(inDomainTransaction());
    this.accessed.push(input.storageKey);
    return {
      method: 'GET',
      url: 'https://simulated-storage.invalid/object',
      expires_at: input.expiresAt.toISOString(),
      simulation: 'SIMULATED',
    };
  }
}

export class RecordingWorkflow implements WorkflowSignalPort {
  readonly signals: NoticeSignal[] = [];
  fail = false;
  async signalNotice(signal: NoticeSignal): Promise<void> {
    if (this.fail) throw new Error('temporal unavailable');
    this.signals.push(signal);
  }
}

export interface Harness {
  service: MessagingService;
  authorizer: ContractAuthorizer;
  participation: RecordingParticipation;
  storage: RecordingStorage;
  workflow: RecordingWorkflow;
}

export function harness(store: MessagingStore, clock: () => Date = () => NOW): Harness {
  const authorizer = new ContractAuthorizer();
  const participation = new RecordingParticipation();
  const storage = new RecordingStorage();
  storage.register(T1, KEY_OK);
  const workflow = new RecordingWorkflow();
  const service = new MessagingService({
    store,
    authorizer,
    participation,
    storage,
    workflow,
    clock,
    config: { environment: 'CI' },
  });
  return { service, authorizer, participation, storage, workflow };
}
