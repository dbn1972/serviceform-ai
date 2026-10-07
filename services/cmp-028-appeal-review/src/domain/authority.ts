import { Cmp028Error, detail } from '../errors.js';
import { assertOnlyKeys, codeField, optionalUuid, requireRecord, uuidField } from './validate.js';

/** Appellate authority: role + organisation/office + jurisdiction + service scope (Constitution #19). */
export interface AppellateAuthority {
  role_code: string;
  organisation_id: string;
  office_id: string | null;
  jurisdiction_id: string;
  service_scope_id: string | null;
}

export const AUTHORITY_KEYS = [
  'role_code',
  'organisation_id',
  'office_id',
  'jurisdiction_id',
  'service_scope_id',
] as const;

const NAMED_OFFICER_KEY =
  /(officer|assignee|employee|staff|person|user|principal|owner|email|phone|name|claimed)/i;

export function rejectNamedOfficer(obj: Record<string, unknown>, pointer: string): void {
  for (const key of Object.keys(obj)) {
    if (!(AUTHORITY_KEYS as readonly string[]).includes(key) && NAMED_OFFICER_KEY.test(key)) {
      throw new Cmp028Error('SF-SYS-003', detail('NAMED_OFFICER_FORBIDDEN', `${pointer}/${key}`));
    }
  }
}

export function parseAuthority(
  input: unknown,
  pointer = '/appellate_authority',
): AppellateAuthority {
  const obj = requireRecord(input, pointer);
  rejectNamedOfficer(obj, pointer);
  assertOnlyKeys(obj, AUTHORITY_KEYS, pointer);
  return {
    role_code: codeField(obj, 'role_code', pointer),
    organisation_id: uuidField(obj, 'organisation_id', pointer),
    office_id: optionalUuid(obj, 'office_id', pointer),
    jurisdiction_id: uuidField(obj, 'jurisdiction_id', pointer),
    service_scope_id: optionalUuid(obj, 'service_scope_id', pointer),
  };
}

export function sameAuthority(a: AppellateAuthority, b: AppellateAuthority): boolean {
  return (
    a.role_code === b.role_code &&
    a.organisation_id === b.organisation_id &&
    a.office_id === b.office_id &&
    a.jurisdiction_id === b.jurisdiction_id &&
    a.service_scope_id === b.service_scope_id
  );
}
