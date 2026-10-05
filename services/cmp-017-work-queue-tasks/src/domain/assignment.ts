import { Cmp017Error, detail } from '../errors.js';
import { assertOnlyKeys, codeField, optionalUuid, requireRecord, uuidField } from './validate.js';

/** Assignment target: role + organisation/office + jurisdiction + service scope (Constitution #19). */
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

/**
 * Field names that identify a person. Published workflow or configuration may never carry them;
 * a runtime claim is recorded by the service itself and is never accepted as input metadata.
 */
const NAMED_OFFICER_KEY =
  /(officer|assignee|employee|staff|person|user|principal|owner|email|phone|name|claimed)/i;

export function rejectNamedOfficer(obj: Record<string, unknown>, pointer: string): void {
  for (const key of Object.keys(obj)) {
    if (!(ASSIGNMENT_KEYS as readonly string[]).includes(key) && NAMED_OFFICER_KEY.test(key)) {
      throw new Cmp017Error('SF-SYS-003', detail('NAMED_OFFICER_FORBIDDEN', `${pointer}/${key}`));
    }
  }
}

/**
 * Strict parser for assignment metadata supplied by a published workflow node or a reassignment.
 * Anything other than the five criteria is refused; person-identifying keys get a dedicated code.
 */
export function parseAssignment(input: unknown, pointer = '/assignment'): Assignment {
  const obj = requireRecord(input, pointer);
  rejectNamedOfficer(obj, pointer);
  assertOnlyKeys(obj, ASSIGNMENT_KEYS, pointer);
  const office = optionalUuid(obj, 'office_id', pointer);
  const scope = optionalUuid(obj, 'service_scope_id', pointer);
  return {
    role_code: codeField(obj, 'role_code', pointer),
    organisation_id: uuidField(obj, 'organisation_id', pointer),
    office_id: office,
    jurisdiction_id: uuidField(obj, 'jurisdiction_id', pointer),
    service_scope_id: scope,
  };
}

export function sameAssignment(a: Assignment, b: Assignment): boolean {
  return (
    a.role_code === b.role_code &&
    a.organisation_id === b.organisation_id &&
    a.office_id === b.office_id &&
    a.jurisdiction_id === b.jurisdiction_id &&
    a.service_scope_id === b.service_scope_id
  );
}
