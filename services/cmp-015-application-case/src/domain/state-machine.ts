import { Cmp015Error, detail } from '../errors.js';
import {
  isForbiddenAuthoritativeState,
  isLegalState,
  requestKindFor,
  resolveTransition,
  type CaseState,
  type RequestKind,
  type RequestStatus,
  type TransitionCommand,
  type TransitionDef,
} from './model.js';
import type { ActorType } from './validate.js';

export interface RequestConstructRef {
  kind: RequestKind;
  status: RequestStatus;
}

export interface TransitionInput {
  command: TransitionCommand;
  expectedState: string;
  expectedVersion: number;
  currentState: string;
  currentVersion: number;
  requestConstruct?: RequestConstructRef | null;
}

export interface PlannedTransition {
  def: TransitionDef;
  fromVersion: number;
  toVersion: number;
}

/** Parses a client-supplied expected_state. *_REQUESTED tokens are refused outright (ADR-0003). */
export function parseExpectedState(value: unknown): CaseState {
  if (isForbiddenAuthoritativeState(value)) {
    throw new Cmp015Error('SF-APP-001', {
      details: detail('REQUEST_CONSTRUCT_IS_NOT_A_STATE', '/expected_state'),
    });
  }
  if (!isLegalState(value)) {
    throw new Cmp015Error('SF-SYS-003', {
      details: detail('EXPECTED_STATE_INVALID', '/expected_state'),
    });
  }
  return value;
}

export function parseExpectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Cmp015Error('SF-SYS-003', {
      details: detail('EXPECTED_VERSION_INVALID', '/expected_version'),
    });
  }
  return value;
}

/**
 * Validates a command against the authoritative case snapshot. Order matters: optimistic
 * concurrency (expected_state / expected_version) first, then legality, then the ADR-0003
 * committed-request gate for WITHDRAWN / CANCELLED.
 */
export function planTransition(input: TransitionInput): PlannedTransition {
  const expected = parseExpectedState(input.expectedState);
  if (!isLegalState(input.currentState)) {
    throw new Cmp015Error('SF-SYS-001', { details: detail('STORED_STATE_INVALID') });
  }
  if (input.currentState !== expected) {
    throw new Cmp015Error('SF-APP-001', {
      details: detail('STALE_EXPECTED_STATE', '/expected_state'),
    });
  }
  if (input.currentVersion !== input.expectedVersion) {
    throw new Cmp015Error('SF-APP-001', { details: detail('STALE_VERSION', '/expected_version') });
  }
  const def = resolveTransition(input.command, input.currentState);
  if (!def) {
    throw new Cmp015Error('SF-APP-001', { details: detail('ILLEGAL_TRANSITION', '/command') });
  }
  const kind = requestKindFor(def.cls);
  if (kind) {
    const rc = input.requestConstruct;
    if (!rc || rc.kind !== kind || rc.status !== 'COMMITTED') {
      throw new Cmp015Error('SF-APP-001', {
        details: detail('REQUEST_NOT_COMMITTED', '/request_id'),
      });
    }
  } else if (input.requestConstruct) {
    throw new Cmp015Error('SF-SYS-003', {
      details: detail('REQUEST_NOT_APPLICABLE', '/request_id'),
    });
  }
  return { def, fromVersion: input.currentVersion, toVersion: input.currentVersion + 1 };
}

export interface ApplicationCaseSmRecord {
  contract_id: 'SF-CON-APPLICATION-CASE-SM';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  owner_component: 'CMP-015';
  tenant_id: string;
  application_id: string;
  command: TransitionCommand;
  from_state: CaseState;
  to_state: CaseState;
  transition_key: string;
  transition_class: TransitionDef['cls'];
  expected_state: CaseState;
  aggregate_version: number;
  idempotency_key: string;
  authz_decision_id: string;
  correlation_id: string;
  actor_type: ActorType;
  actor_id: string;
  reason_code?: string;
  outbox_required: true;
  request_construct?: RequestConstructRef;
}

export function stateMachineRecord(params: {
  tenantId: string;
  applicationId: string;
  plan: PlannedTransition;
  idempotencyKey: string;
  authzDecisionId: string;
  correlationId: string;
  actorType: ActorType;
  actorId: string;
  reasonCode?: string;
  requestConstruct?: RequestConstructRef;
}): ApplicationCaseSmRecord {
  const { def } = params.plan;
  const record: ApplicationCaseSmRecord = {
    contract_id: 'SF-CON-APPLICATION-CASE-SM',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    owner_component: 'CMP-015',
    tenant_id: params.tenantId,
    application_id: params.applicationId,
    command: def.command,
    from_state: def.from,
    to_state: def.to,
    transition_key: def.key,
    transition_class: def.cls,
    expected_state: def.from,
    aggregate_version: params.plan.fromVersion,
    idempotency_key: params.idempotencyKey,
    authz_decision_id: params.authzDecisionId,
    correlation_id: params.correlationId,
    actor_type: params.actorType,
    actor_id: params.actorId,
    outbox_required: true,
  };
  if (params.reasonCode) record.reason_code = params.reasonCode;
  if (params.requestConstruct) record.request_construct = { ...params.requestConstruct };
  return record;
}
