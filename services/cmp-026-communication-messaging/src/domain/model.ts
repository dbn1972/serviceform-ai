import { createHash } from 'node:crypto';
import { Cmp026Error, detail } from '../errors.js';
import { isCode, isUuid, type ActorType } from './validate.js';

export const THREAD_STATUSES = ['OPEN', 'CLOSED', 'ARCHIVED'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const THREAD_COMMANDS = ['CLOSE', 'REOPEN', 'ARCHIVE'] as const;
export type ThreadCommand = (typeof THREAD_COMMANDS)[number];

export const MESSAGE_KINDS = ['MESSAGE', 'OFFICIAL_NOTICE'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MAX_BODY_CHARS = 8000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_PARTICIPANTS_PER_THREAD = 50;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const TRANSITIONS: Readonly<Record<ThreadCommand, { from: ThreadStatus; to: ThreadStatus }>> = {
  CLOSE: { from: 'OPEN', to: 'CLOSED' },
  REOPEN: { from: 'CLOSED', to: 'OPEN' },
  ARCHIVE: { from: 'CLOSED', to: 'ARCHIVED' },
};

export function isThreadCommand(value: unknown): value is ThreadCommand {
  return typeof value === 'string' && (THREAD_COMMANDS as readonly string[]).includes(value);
}

export function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === 'string' && (THREAD_STATUSES as readonly string[]).includes(value);
}

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === 'string' && (MESSAGE_KINDS as readonly string[]).includes(value);
}

export interface PlannedTransition {
  to: ThreadStatus;
  nextVersion: number;
}

export function planThreadTransition(params: {
  command: ThreadCommand;
  from: ThreadStatus;
  expectedStatus: ThreadStatus;
  expectedVersion: number;
  currentVersion: number;
}): PlannedTransition {
  if (params.expectedStatus !== params.from || params.expectedVersion !== params.currentVersion) {
    throw new Cmp026Error('SF-APP-001', { details: detail('STALE_VERSION') });
  }
  const rule = TRANSITIONS[params.command];
  if (rule.from !== params.from) {
    throw new Cmp026Error('SF-APP-001', { details: detail('ILLEGAL_TRANSITION') });
  }
  return { to: rule.to, nextVersion: params.currentVersion + 1 };
}

export function assertThreadAcceptsMessages(status: ThreadStatus): void {
  if (status !== 'OPEN') {
    throw new Cmp026Error('SF-APP-001', { details: detail('THREAD_NOT_OPEN') });
  }
}

const AUTHORITY_ACTOR_TYPES: readonly ActorType[] = ['OFFICER', 'SYSTEM', 'PRIVILEGED_ADMIN'];

/** Official notices originate from the authority side only; never from a citizen principal. */
export function assertNoticeSenderIsAuthority(actorType: ActorType): void {
  if (!AUTHORITY_ACTOR_TYPES.includes(actorType)) {
    throw new Cmp026Error('SF-AUTH-002', { details: detail('NOTICE_SENDER_NOT_AUTHORITY') });
  }
}

export function parseBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Cmp026Error('SF-SYS-003', { details: detail('BODY_REQUIRED', '/body') });
  }
  if (value.trim().length === 0 || value.length > MAX_BODY_CHARS) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('BODY_LENGTH_INVALID', '/body') });
  }
  return value;
}

export function bodyDigest(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

const STORAGE_KEY_MIN_LENGTH = 8;
const STORAGE_KEY_MAX_LENGTH = 256;
const STORAGE_KEY_PUNCTUATION = '_./:-';
const SEQUENCE_MAX_DIGITS = 15;

function isAsciiAlnum(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

/** Length-bound first, then a single linear pass over the allowed charset [A-Za-z0-9_./:-]. */
function isStorageKeyShape(value: string): boolean {
  if (value.length < STORAGE_KEY_MIN_LENGTH || value.length > STORAGE_KEY_MAX_LENGTH) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (!isAsciiAlnum(code) && !STORAGE_KEY_PUNCTUATION.includes(value.charAt(i))) return false;
  }
  return true;
}

/** Length-bound first (1..15), then ASCII digits only. */
function isDigitString(value: string): boolean {
  if (value.length < 1 || value.length > SEQUENCE_MAX_DIGITS) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return false;
  }
  return true;
}

/**
 * Storage key reference only (CMP-032). The key is opaque to CMP-026; tenant ownership is
 * verified by the CMP-032 port. Structural traversal markers are refused here as defence in depth.
 */
export function parseStorageKey(value: unknown, pointer: string): string {
  if (
    typeof value !== 'string' ||
    !isStorageKeyShape(value) ||
    value.includes('..') ||
    value.startsWith('/') ||
    value.includes('//')
  ) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('STORAGE_KEY_INVALID', pointer) });
  }
  return value;
}

export function parseStorageKeys(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Cmp026Error('SF-SYS-003', {
      details: detail('ATTACHMENTS_INVALID', '/attachment_storage_keys'),
    });
  }
  const keys = value.map((v, i) => parseStorageKey(v, `/attachment_storage_keys/${i}`));
  if (new Set(keys).size !== keys.length) {
    throw new Cmp026Error('SF-SYS-003', {
      details: detail('ATTACHMENTS_DUPLICATE', '/attachment_storage_keys'),
    });
  }
  return keys;
}

export interface ParticipantInput {
  actor_id: string;
  role_code: string;
}

const PARTICIPANT_KEYS = ['actor_id', 'role_code', 'tenant_id'] as const;

export function parseParticipant(
  value: unknown,
  tenantId: string,
  pointer: string,
): ParticipantInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('PARTICIPANT_INVALID', pointer) });
  }
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    if (!(PARTICIPANT_KEYS as readonly string[]).includes(k)) {
      throw new Cmp026Error('SF-SYS-003', {
        details: detail('UNKNOWN_FIELD', `${pointer}/${k}`),
      });
    }
  }
  if (v['tenant_id'] !== undefined && v['tenant_id'] !== tenantId) {
    throw new Cmp026Error('SF-TEN-002', { details: detail('CROSS_TENANT_PARTICIPANT_DENIED') });
  }
  if (!isUuid(v['actor_id'])) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('ID_INVALID', `${pointer}/actor_id`) });
  }
  if (!isCode(v['role_code'])) {
    throw new Cmp026Error('SF-SYS-003', {
      details: detail('CODE_INVALID', `${pointer}/role_code`),
    });
  }
  return { actor_id: v['actor_id'].toLowerCase(), role_code: v['role_code'] };
}

/** Opaque, stable, non-reversible participant reference (no raw principal id in views/events). */
export function participantRef(threadId: string, actorId: string): string {
  const digest = createHash('sha256').update(`${threadId}:${actorId}`).digest('hex');
  return `p-${digest.slice(0, 24)}`;
}

export function parsePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('LIMIT_INVALID', '/limit') });
  }
  return n;
}

export function parseSequence(value: unknown, pointer: string, min: number): number {
  const n = typeof value === 'string' && isDigitString(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('SEQUENCE_INVALID', pointer) });
  }
  return n;
}
