import { Cmp027Error, detail } from '../errors.js';
import { isCode, isUuid } from './validate.js';

export const KINDS = ['GRIEVANCE', 'FEEDBACK'] as const;
export type GrievanceKind = (typeof KINDS)[number];

export const STATUSES = [
  'FILED',
  'CATEGORISED',
  'ROUTED',
  'OPEN',
  'PENDING_RESPONSE',
  'RESOLVED',
  'CLOSED',
  'WITHDRAWN',
] as const;
export type GrievanceStatus = (typeof STATUSES)[number];

export const COMMANDS = [
  'CATEGORISE',
  'ROUTE',
  'REQUEST_ASSIGNMENT',
  'RECORD_RESPONSE',
  'RESOLVE',
  'CLOSE',
  'WITHDRAW',
] as const;
export type TransitionCommand = (typeof COMMANDS)[number];

export const AI_ASSIST_KINDS = [
  'CLASSIFY',
  'SUMMARIZE',
  'SUGGEST_ROUTING',
  'DRAFT_RESPONSE',
  'DETECT_DUPLICATE',
] as const;
export type AiAssistKind = (typeof AI_ASSIST_KINDS)[number];

export const FORBIDDEN_AI_DISPOSITION = [
  'CLOSE',
  'RESOLVE',
  'DISPOSE',
  'DISPOSITION',
  'ENTITLEMENT',
  'APPEAL',
  'LEGAL',
  'STATUTORY',
] as const;

export interface Assignment {
  role_code: string;
  organisation_id: string;
  office_id: string | null;
  jurisdiction_id: string;
  service_scope_id: string | null;
}

export const ASSIGNMENT_KEYS = [
  'role_code',
  'organisation_id',
  'office_id',
  'jurisdiction_id',
  'service_scope_id',
] as const;

const NAMED_OFFICER_KEY =
  /(officer|assignee|employee|staff|person|user|principal|owner|email|phone|name|claimed)/i;

export function isKind(value: unknown): value is GrievanceKind {
  return (KINDS as readonly unknown[]).includes(value);
}

export function isStatus(value: unknown): value is GrievanceStatus {
  return (STATUSES as readonly unknown[]).includes(value);
}

export function isCommand(value: unknown): value is TransitionCommand {
  return (COMMANDS as readonly unknown[]).includes(value);
}

export function isAiAssistKind(value: unknown): value is AiAssistKind {
  return (AI_ASSIST_KINDS as readonly unknown[]).includes(value);
}

export const TRANSITIONS: ReadonlyArray<{
  command: TransitionCommand;
  from: GrievanceStatus;
  to: GrievanceStatus;
}> = [
  { command: 'CATEGORISE', from: 'FILED', to: 'CATEGORISED' },
  { command: 'ROUTE', from: 'CATEGORISED', to: 'ROUTED' },
  { command: 'REQUEST_ASSIGNMENT', from: 'ROUTED', to: 'OPEN' },
  { command: 'RECORD_RESPONSE', from: 'OPEN', to: 'PENDING_RESPONSE' },
  { command: 'RECORD_RESPONSE', from: 'PENDING_RESPONSE', to: 'OPEN' },
  { command: 'RESOLVE', from: 'OPEN', to: 'RESOLVED' },
  { command: 'RESOLVE', from: 'PENDING_RESPONSE', to: 'RESOLVED' },
  { command: 'CLOSE', from: 'RESOLVED', to: 'CLOSED' },
  { command: 'WITHDRAW', from: 'FILED', to: 'WITHDRAWN' },
  { command: 'WITHDRAW', from: 'CATEGORISED', to: 'WITHDRAWN' },
  { command: 'WITHDRAW', from: 'ROUTED', to: 'WITHDRAWN' },
  { command: 'WITHDRAW', from: 'OPEN', to: 'WITHDRAWN' },
  { command: 'WITHDRAW', from: 'PENDING_RESPONSE', to: 'WITHDRAWN' },
];

export function resolveTransition(
  command: TransitionCommand,
  from: GrievanceStatus,
): { command: TransitionCommand; from: GrievanceStatus; to: GrievanceStatus } | null {
  return TRANSITIONS.find((t) => t.command === command && t.from === from) ?? null;
}

export function planTransition(params: {
  command: TransitionCommand;
  from: GrievanceStatus;
  expectedStatus: GrievanceStatus;
  expectedVersion: number;
  currentVersion: number;
}): { to: GrievanceStatus; nextVersion: number } {
  if (params.expectedStatus !== params.from) {
    throw new Cmp027Error('SF-APP-001', { details: detail('STALE_STATUS') });
  }
  if (params.expectedVersion !== params.currentVersion) {
    throw new Cmp027Error('SF-APP-001', { details: detail('STALE_VERSION') });
  }
  const def = resolveTransition(params.command, params.from);
  if (!def) {
    throw new Cmp027Error('SF-APP-001', { details: detail('ILLEGAL_TRANSITION') });
  }
  return { to: def.to, nextVersion: params.currentVersion + 1 };
}

export function rejectNamedOfficer(obj: Record<string, unknown>, pointer: string): void {
  for (const key of Object.keys(obj)) {
    if (!(ASSIGNMENT_KEYS as readonly string[]).includes(key) && NAMED_OFFICER_KEY.test(key)) {
      throw new Cmp027Error('SF-SYS-003', {
        details: detail('NAMED_OFFICER_FORBIDDEN', `${pointer}/${key}`),
      });
    }
  }
}

export function parseAssignment(input: unknown, pointer = '/assignment'): Assignment {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Cmp027Error('SF-SYS-003', { details: detail('ASSIGNMENT_REQUIRED', pointer) });
  }
  const obj = input as Record<string, unknown>;
  rejectNamedOfficer(obj, pointer);
  for (const key of Object.keys(obj)) {
    if (!(ASSIGNMENT_KEYS as readonly string[]).includes(key)) {
      throw new Cmp027Error('SF-SYS-003', {
        details: detail('UNKNOWN_FIELD', `${pointer}/${key}`),
      });
    }
  }
  if (!isCode(obj['role_code'])) {
    throw new Cmp027Error('SF-SYS-003', {
      details: detail('CODE_INVALID', `${pointer}/role_code`),
    });
  }
  if (!isUuid(obj['organisation_id'])) {
    throw new Cmp027Error('SF-SYS-003', {
      details: detail('ID_INVALID', `${pointer}/organisation_id`),
    });
  }
  if (!isUuid(obj['jurisdiction_id'])) {
    throw new Cmp027Error('SF-SYS-003', {
      details: detail('ID_INVALID', `${pointer}/jurisdiction_id`),
    });
  }
  const office = obj['office_id'];
  if (office !== undefined && office !== null && !isUuid(office)) {
    throw new Cmp027Error('SF-SYS-003', { details: detail('ID_INVALID', `${pointer}/office_id`) });
  }
  const scope = obj['service_scope_id'];
  if (scope !== undefined && scope !== null && !isUuid(scope)) {
    throw new Cmp027Error('SF-SYS-003', {
      details: detail('ID_INVALID', `${pointer}/service_scope_id`),
    });
  }
  return {
    role_code: obj['role_code'],
    organisation_id: obj['organisation_id'],
    office_id: office === undefined || office === null ? null : office,
    jurisdiction_id: obj['jurisdiction_id'],
    service_scope_id: scope === undefined || scope === null ? null : scope,
  };
}

export function assertAiAssistAllowed(kind: string): void {
  const upper = kind.toUpperCase();
  if ((FORBIDDEN_AI_DISPOSITION as readonly string[]).some((k) => upper.includes(k))) {
    throw new Cmp027Error('SF-AUTH-002', { details: detail('AI_FINAL_DISPOSITION_FORBIDDEN') });
  }
  if (!isAiAssistKind(kind)) {
    throw new Cmp027Error('SF-SYS-003', { details: detail('AI_ASSIST_KIND_INVALID', '/kind') });
  }
}

export function assertStatutoryClose(params: {
  kind: GrievanceKind;
  command: TransitionCommand;
  actorType: string;
}): void {
  if (params.command !== 'RESOLVE' && params.command !== 'CLOSE') return;
  if (params.actorType === 'INTEGRATION') {
    throw new Cmp027Error('SF-AUTH-002', { details: detail('AI_FINAL_DISPOSITION_FORBIDDEN') });
  }
  if (params.kind === 'GRIEVANCE' && params.actorType !== 'OFFICER') {
    throw new Cmp027Error('SF-AUTH-002', {
      details: detail('HUMAN_OFFICER_DISPOSITION_REQUIRED'),
    });
  }
}
