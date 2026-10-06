import type { RequestContext } from '../contracts.js';
import type { Assignment } from './assignment.js';

export interface PrincipalScope {
  roles: string[];
  organisation_ids: string[];
  office_ids: string[];
  jurisdiction_ids: string[];
  service_scope_ids: string[];
}

export type MismatchDimension =
  'ROLE' | 'ORGANISATION' | 'OFFICE' | 'JURISDICTION' | 'SERVICE_SCOPE';

export interface ScopeExtension {
  organisation_ids?: string[];
  office_ids?: string[];
  jurisdiction_ids?: string[];
  service_scope_ids?: string[];
}

function uniq(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export function scopeFromContext(
  ctx: RequestContext,
  extension: ScopeExtension = {},
): PrincipalScope {
  return {
    roles: uniq(ctx.roles),
    organisation_ids: uniq([
      ...(ctx.organisation_id ? [ctx.organisation_id] : []),
      ...(extension.organisation_ids ?? []),
    ]),
    office_ids: uniq([...(ctx.office_id ? [ctx.office_id] : []), ...(extension.office_ids ?? [])]),
    jurisdiction_ids: uniq([...ctx.jurisdiction_ids, ...(extension.jurisdiction_ids ?? [])]),
    service_scope_ids: uniq(extension.service_scope_ids ?? []),
  };
}

export function mismatches(assignment: Assignment, scope: PrincipalScope): MismatchDimension[] {
  const out: MismatchDimension[] = [];
  if (!scope.roles.includes(assignment.role_code)) out.push('ROLE');
  if (!scope.organisation_ids.includes(assignment.organisation_id)) out.push('ORGANISATION');
  if (assignment.office_id !== null && !scope.office_ids.includes(assignment.office_id)) {
    out.push('OFFICE');
  }
  if (!scope.jurisdiction_ids.includes(assignment.jurisdiction_id)) out.push('JURISDICTION');
  if (
    assignment.service_scope_id !== null &&
    !scope.service_scope_ids.includes(assignment.service_scope_id)
  ) {
    out.push('SERVICE_SCOPE');
  }
  return out;
}

export function matchesAssignment(assignment: Assignment, scope: PrincipalScope): boolean {
  return mismatches(assignment, scope).length === 0;
}
