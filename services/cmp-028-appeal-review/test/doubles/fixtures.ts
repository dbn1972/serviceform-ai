import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../src/contracts.js';

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const TENANT_A = uuid(1);
export const TENANT_B = uuid(2);
export const ORG_1 = uuid(11);
export const ORG_2 = uuid(12);
export const OFFICE_1 = uuid(21);
export const JUR_1 = uuid(31);
export const SCOPE_1 = uuid(41);
export const APP_1 = uuid(51);
export const DECISION_1 = uuid(61);
export const OFFICER_1 = uuid(101);
export const OFFICER_2 = uuid(102);
export const CITIZEN_1 = uuid(201);
export const WF_VERSION = uuid(301);

export function ctxFor(
  actorId: string,
  overrides: { [K in keyof RequestContext]?: RequestContext[K] | undefined } = {},
  type: RequestContext['actor']['type'] = 'OFFICER',
): RequestContext {
  const ctx: RequestContext = {
    tenant_id: TENANT_A,
    cell_id: 'cell-01',
    actor: { type, id: actorId },
    organisation_id: ORG_1,
    office_id: OFFICE_1,
    roles: ['APPELLATE_AUTHORITY'],
    jurisdiction_ids: [JUR_1],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: randomUUID().replaceAll('-', ''),
  };
  const merged: Record<string, unknown> = { ...ctx };
  for (const [k, v] of Object.entries(overrides)) merged[k] = v;
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  ) as unknown as RequestContext;
}

export const AUTHORITY = {
  role_code: 'APPELLATE_AUTHORITY',
  organisation_id: ORG_1,
  office_id: OFFICE_1,
  jurisdiction_id: JUR_1,
};

export function fileBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    original_application_id: APP_1,
    original_decision_id: DECISION_1,
    grounds_code: 'PROCEDURAL_ERROR',
    evidence_refs: [uuid(71)],
    appellate_authority: { ...AUTHORITY },
    ...overrides,
  };
}

let keySeq = 0;
export function idemKey(prefix = 'appeal-op'): string {
  keySeq += 1;
  return `${prefix}-${String(keySeq).padStart(6, '0')}`;
}
