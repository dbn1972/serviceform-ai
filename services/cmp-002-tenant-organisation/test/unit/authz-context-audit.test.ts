import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../src/authz.js';
import { auditEvent, shouldWriteDeniedAudit } from '../../src/audit.js';
import { requireContext, assertTenantRouteId } from '../../src/context.js';
import { currentClient } from '../../src/db/tx.js';
import { Cmp002Error, mapPgError } from '../../src/errors.js';
import { envelopeOf } from '../../src/events.js';
import { frozenClock } from '../doubles/clock.js';
import type { AuthzDecisionInput, RequestContext } from '@serviceform/contracts';

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
    resource_type: 'Organisation',
    tenant_id: ctx.tenant_id,
    classification: 'TENANT_SCOPED',
  },
  action: 'ORGANISATION_READ',
};

describe('authorize fail-closed', () => {
  it('denies malformed input, PDP throw, deny, and extra fields', async () => {
    await expect(
      authorize({ decide: async () => ({ allow: true }) as never }, {} as never),
    ).rejects.toBeInstanceOf(Cmp002Error);
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
    await expect(
      authorize(
        {
          decide: async () =>
            ({
              allow: true,
              reason_code: 'ALLOW',
              policy_revision: '1',
              decision_id: randomUUID(),
              extra: true,
            }) as never,
        },
        input,
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    await authorize(
      {
        decide: async () => ({
          allow: true,
          reason_code: 'ALLOW',
          policy_revision: '1',
          decision_id: randomUUID(),
        }),
      },
      input,
    );
  });

  it('denies TENANT_SCOPED subject/resource tenant mismatch', async () => {
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
            resource_type: 'Organisation',
            tenant_id: '22222222-2222-4222-8222-222222222222',
            classification: 'TENANT_SCOPED',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });
});

describe('context and tx guards', () => {
  it('requireContext and route id checks', () => {
    expect(() => requireContext(null, true)).toThrow(Cmp002Error);
    expect(() => requireContext({ no: true }, true)).toThrow(Cmp002Error);
    const admin = requireContext({ ...ctx, tenant_id: null }, false);
    expect(admin.tenant_id).toBeNull();
    try {
      requireContext({ ...ctx, tenant_id: null }, true);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Cmp002Error);
      expect((err as Cmp002Error).code).toBe('SF-TEN-001');
    }
    expect(() => assertTenantRouteId(ctx, '22222222-2222-4222-8222-222222222222')).toThrow(
      Cmp002Error,
    );
    assertTenantRouteId(ctx, ctx.tenant_id as string);
  });

  it('currentClient throws outside withContextTx', () => {
    expect(() => currentClient()).toThrow(Cmp002Error);
  });
});

describe('audit and errors', () => {
  it('rate-limits denied audit writes', () => {
    const now = 1_000_000;
    expect(shouldWriteDeniedAudit('actor', '/v1/admin/tenants', now)).toBe(true);
    for (let i = 0; i < 19; i += 1) {
      expect(shouldWriteDeniedAudit('actor', '/v1/admin/tenants', now)).toBe(true);
    }
    expect(shouldWriteDeniedAudit('actor', '/v1/admin/tenants', now)).toBe(false);
    expect(shouldWriteDeniedAudit('actor', '/v1/admin/tenants', now + 61_000)).toBe(true);
  });

  it('maps remaining pg codes without SQL text', () => {
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError({ code: '57014' }).code).toBe('SF-SYS-004');
    expect(mapPgError(new Cmp002Error('SF-APP-001')).code).toBe('SF-APP-001');
    expect(mapPgError({ code: 'XX000', message: 'sf_tenant_org.office boom' }).code).toBe(
      'SF-SYS-001',
    );
    expect(mapPgError({ code: 'XX000', message: 'sf_tenant_org.office boom' }).message).not.toMatch(
      /office|sf_tenant_org/i,
    );
  });

  it('builds audit and envelope helpers', () => {
    const now = frozenClock('2026-10-03T12:00:00.000Z')();
    const audit = auditEvent(ctx, {
      action: 'ORGANISATION_CREATE',
      actionClass: 'WRITE',
      resourceType: 'Organisation',
      resourceId: randomUUID(),
      result: 'SUCCESS',
      now,
    });
    expect(audit.tenant_id).toBe(ctx.tenant_id);
    const env = envelopeOf({
      eventType: 'OfficeActivated',
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'Office',
      aggregateId: randomUUID(),
      aggregateVersion: 2,
      occurredAt: now.toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        office_id: randomUUID(),
        organisation_id: randomUUID(),
        activated_at: now.toISOString(),
      },
    });
    expect(env.event_type).toBe('OfficeActivated');
  });
});
