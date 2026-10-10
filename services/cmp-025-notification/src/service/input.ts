import {
  CHANNELS,
  HANDLE_CLASSES,
  HANDLE_REF_RE,
  isOneOf,
  LOCALE_RE,
  PARAM_NAME_RE,
  TEMPLATE_REF_RE,
  type Channel,
  type HandleClass,
} from '../domain/model.js';
import { findPii, MAX_PARAMS } from '../domain/pii-guard.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp025Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'requested_at',
  'sent_at',
  'delivered_at',
  'published_at',
  'as_of',
]);

export interface DispatchInput {
  application_id: string | null;
  template_ref: string;
  template_version: number | null;
  channel: Channel;
  locale: string;
  recipient_handle_class: HandleClass;
  recipient_handle_ref: string;
  connector_binding_id: string;
  template_params: Record<string, string>;
}

export interface PublishTemplateInput {
  template_ref: string;
  channel: Channel;
  locale: string;
  subject_template: string | null;
  body_template: string;
  allowed_params: string[];
}

export interface ReceiptInput {
  outcome: 'DELIVERED' | 'UNDELIVERED';
  provider_message_ref: string;
}

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp025Error('SF-SYS-003', detail(code, pointer));
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp025Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function onlyKeys(rec: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(rec)) if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
}

function requireUuid(value: unknown, pointer: string): string {
  if (typeof value !== 'string' || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value;
}

function requireMatching(value: unknown, re: RegExp, pointer: string, code: string): string {
  if (typeof value !== 'string' || !re.test(value)) bad(pointer, code);
  return value;
}

function parseParams(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw))
    bad('/template_params', 'PARAMS_OBJECT_REQUIRED');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PARAMS) bad('/template_params', 'TOO_MANY_PARAMS');
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!PARAM_NAME_RE.test(name)) bad('/template_params', 'PARAM_NAME_INVALID');
    if (typeof value !== 'string') bad(`/template_params/${name}`, 'PARAM_STRING_REQUIRED');
    // Pointers name the parameter, never echo the value (it may be PII-shaped).
    if (findPii(value) !== null) bad(`/template_params/${name}`, 'PII_IN_PARAM_REFUSED');
    out[name] = value;
  }
  return out;
}

export function validateDispatchInput(body: unknown): DispatchInput {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  onlyKeys(rec, [
    'application_id',
    'template_ref',
    'template_version',
    'channel',
    'locale',
    'recipient_handle_class',
    'recipient_handle_ref',
    'connector_binding_id',
    'template_params',
  ]);
  const version = rec['template_version'];
  if (
    version !== undefined &&
    version !== null &&
    (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
  ) {
    bad('/template_version', 'VERSION_INVALID');
  }
  const channel = rec['channel'];
  if (!isOneOf(CHANNELS, channel)) bad('/channel', 'CHANNEL_INVALID');
  const handleClass = rec['recipient_handle_class'];
  if (!isOneOf(HANDLE_CLASSES, handleClass)) bad('/recipient_handle_class', 'HANDLE_CLASS_INVALID');
  const application = rec['application_id'];
  return {
    application_id:
      application === undefined || application === null
        ? null
        : requireUuid(application, '/application_id'),
    template_ref: requireMatching(
      rec['template_ref'],
      TEMPLATE_REF_RE,
      '/template_ref',
      'REF_REQUIRED',
    ),
    template_version: typeof version === 'number' ? version : null,
    channel,
    locale: requireMatching(rec['locale'], LOCALE_RE, '/locale', 'LOCALE_INVALID'),
    recipient_handle_class: handleClass,
    recipient_handle_ref: requireMatching(
      rec['recipient_handle_ref'],
      HANDLE_REF_RE,
      '/recipient_handle_ref',
      'HANDLE_REF_INVALID',
    ),
    connector_binding_id: requireUuid(rec['connector_binding_id'], '/connector_binding_id'),
    template_params: parseParams(rec['template_params']),
  };
}

export function validatePublishTemplateInput(body: unknown): PublishTemplateInput {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  onlyKeys(rec, [
    'template_ref',
    'channel',
    'locale',
    'subject_template',
    'body_template',
    'allowed_params',
  ]);
  const channel = rec['channel'];
  if (!isOneOf(CHANNELS, channel)) bad('/channel', 'CHANNEL_INVALID');
  const subject = rec['subject_template'];
  if (
    subject !== undefined &&
    subject !== null &&
    (typeof subject !== 'string' || subject.length < 1 || subject.length > 300)
  ) {
    bad('/subject_template', 'SUBJECT_INVALID');
  }
  const text = rec['body_template'];
  if (typeof text !== 'string' || text.length < 1 || text.length > 4000) {
    bad('/body_template', 'BODY_INVALID');
  }
  const allowed = rec['allowed_params'] ?? [];
  if (
    !Array.isArray(allowed) ||
    allowed.length > 32 ||
    !allowed.every((p) => typeof p === 'string')
  ) {
    bad('/allowed_params', 'ALLOWED_PARAMS_INVALID');
  }
  return {
    template_ref: requireMatching(
      rec['template_ref'],
      TEMPLATE_REF_RE,
      '/template_ref',
      'REF_REQUIRED',
    ),
    channel,
    locale: requireMatching(rec['locale'], LOCALE_RE, '/locale', 'LOCALE_INVALID'),
    subject_template: typeof subject === 'string' ? subject : null,
    body_template: text,
    allowed_params: allowed as string[],
  };
}

export function validateReceiptInput(body: unknown): ReceiptInput {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  onlyKeys(rec, ['outcome', 'provider_message_ref']);
  const outcome = rec['outcome'];
  if (outcome !== 'DELIVERED' && outcome !== 'UNDELIVERED') bad('/outcome', 'OUTCOME_INVALID');
  const ref = rec['provider_message_ref'];
  if (typeof ref !== 'string' || ref.length < 1 || ref.length > 200) {
    bad('/provider_message_ref', 'PROVIDER_REF_INVALID');
  }
  return { outcome, provider_message_ref: ref };
}

export function validateEmptyInput(body: unknown): void {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  if (Object.keys(rec).length > 0) bad(`/${Object.keys(rec)[0] as string}`, 'UNKNOWN_FIELD');
}
