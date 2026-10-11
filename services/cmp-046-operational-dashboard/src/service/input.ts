import { isViewCode, type ViewCode } from '../domain/model.js';
import { Cmp046Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'as_of',
  'attempted_at',
  'source_observed_at',
]);

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp046Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp046Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

/** Dashboard routes carry no client data: a refresh re-reads the owner ports server-side. */
export function validateEmptyInput(body: unknown): void {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  if (Object.keys(rec).length > 0) bad(`/${Object.keys(rec)[0] as string}`, 'UNKNOWN_FIELD');
}

export function validateViewCode(value: string | undefined): ViewCode {
  if (value === undefined || !isViewCode(value)) {
    throw new Cmp046Error('SF-SYS-003', detail('VIEW_CODE_UNKNOWN', '/view_code'));
  }
  return value;
}
