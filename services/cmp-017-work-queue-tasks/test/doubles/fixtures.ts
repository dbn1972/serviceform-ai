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
export const OFFICE_2 = uuid(22);
export const JUR_1 = uuid(31);
export const JUR_2 = uuid(32);
export const SCOPE_1 = uuid(41);
export const APP_1 = uuid(51);
export const APP_2 = uuid(52);
export const OFFICER_1 = uuid(101);
export const OFFICER_2 = uuid(102);
export const SUPERVISOR = uuid(103);
export const WORKFLOW_SYSTEM = uuid(104);

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
    roles: ['SCRUTINY_OFFICER'],
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

export const SCRUTINY_ASSIGNMENT = {
  role_code: 'SCRUTINY_OFFICER',
  organisation_id: ORG_1,
  office_id: OFFICE_1,
  jurisdiction_id: JUR_1,
};

export function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    application_id: APP_1,
    workflow_node_id: 'SCRUTINY',
    assignment: { ...SCRUTINY_ASSIGNMENT },
    ...overrides,
  };
}

let keySeq = 0;
export function idemKey(prefix = 'task-op'): string {
  keySeq += 1;
  return `${prefix}-${String(keySeq).padStart(6, '0')}`;
}
