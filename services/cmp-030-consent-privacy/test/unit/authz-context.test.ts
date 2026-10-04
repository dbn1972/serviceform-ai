import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AuthzDecisionInput, RequestContext } from '@serviceform/contracts';
import { authorize } from '../../src/authz.js';
import {
  assertNoTenantIdentifyingHeaders,
  isForbiddenHeaderName,
  requireContext,
} from '../../src/context.js';
import { Cmp030Error, mapPgError } from '../../src/errors.js';
import { auditEvent, shouldWriteDeniedAudit } from '../../src/audit.js';
import { currentClient } from '../../src/db/tx.js';

const ctx: RequestContext = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

const input: AuthzDecisionInput = {
  subject: {
    user_id: ctx.actor.id,
    actor_type: ctx.actor.type,
    tenant_id: ctx.tenant_id,
    roles: ctx.roles,
    jurisdiction_ids: ctx.jurisdiction_ids,
  },
  resource: {
    resource_type: 'Consent',
    tenant_id: ctx.tenant_id,
    classification: 'TENANT_SCOPED',
  },
  action: 'CONSENT_GRANT',
};

describe('authorize fail-closed', () => {
  it('denies malformed input, PDP throw, and deny', async () => {
    await expect(
      authorize({ decide: async () => ({ allow: true }) as never }, {} as never),
    ).rejects.toBeInstanceOf(Cmp030Error);
    await expect(
      authorize(
        {
          decide: async () => {
            throw new Error('timeout');
          },
        },
        input,
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
    await expect(
      authorize(
        {
          decide: async () => ({
            allow: false,
            reason_code: 'DEFAULT_DENY',
            policy_revision: '1',
            decision_id: randomUUID(),
          }),
        },
        input,
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('denies tenant mismatch on TENANT_SCOPED resources', async () => {
    await expect(
      authorize(
        {
          decide: async () => ({
            allow: true,
            reason_code: 'ALLOW',
            policy_revision: '1',
            decision_id: randomUUID(),
          }),
        },
        {
          ...input,
          resource: {
            ...input.resource,
            tenant_id: '22222222-2222-4222-8222-222222222222',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });
});

describe('context guards', () => {
  it('rejects tenant-identifying headers and missing context', () => {
    expect(isForbiddenHeaderName('x-tenant-id')).toBe(true);
    expect(isForbiddenHeaderName('authorization')).toBe(false);
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        headers: { 'x-tenant-id': 't1' },
      } as never),
    ).toThrow(Cmp030Error);
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        headers: { forwarded: 'for=1;tenant=abc' },
      } as never),
    ).toThrow(Cmp030Error);
    expect(() => requireContext(null, true)).toThrow(/SF-AUTH-001|Unauthorized|Authentication/i);
    expect(() => requireContext({ ...ctx, tenant_id: null }, true)).toThrow(Cmp030Error);
    expect(requireContext(ctx, true).tenant_id).toBe(ctx.tenant_id);
  });
});

describe('errors and audit helpers', () => {
  it('maps pg errors and rate-limits deny audits', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError(new Error('x')).code).toBe('SF-SYS-001');
    expect(() => currentClient()).toThrow(Cmp030Error);
    const event = auditEvent(ctx, {
      action: 'CONSENT_GRANT',
      actionClass: 'WRITE',
      resourceType: 'Consent',
      resourceId: randomUUID(),
      result: 'SUCCESS',
      now: new Date('2026-10-04T00:00:00.000Z'),
    });
    expect(event.resource_type).toBe('Consent');
    const now = Date.now();
    for (let i = 0; i < 20; i += 1) expect(shouldWriteDeniedAudit('a', '/x', now)).toBe(true);
    expect(shouldWriteDeniedAudit('a', '/x', now)).toBe(false);
  });
});
