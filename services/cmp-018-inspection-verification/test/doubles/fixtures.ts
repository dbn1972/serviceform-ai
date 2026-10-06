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
export const JUR_2 = uuid(32);
export const APP_1 = uuid(51);
export const OFFICER_1 = uuid(101);
export const OFFICER_2 = uuid(102);
export const WORKFLOW_SYSTEM = uuid(104);
export const BINDING = uuid(201);
export const EVIDENCE = uuid(301);
export const DOCUMENT = uuid(302);
export const OCR_JOB = uuid(303);

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
    roles: ['INSPECTION_OFFICER'],
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

export const INSPECT_ASSIGNMENT = {
  role_code: 'INSPECTION_OFFICER',
  organisation_id: ORG_1,
  office_id: OFFICE_1,
  jurisdiction_id: JUR_1,
};

export function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    application_id: APP_1,
    workflow_node_id: 'SITE_VISIT',
    assignment: { ...INSPECT_ASSIGNMENT },
    ...overrides,
  };
}

let keySeq = 0;
export function idemKey(prefix = 'insp-op'): string {
  keySeq += 1;
  return `${prefix}-${String(keySeq).padStart(6, '0')}`;
}
