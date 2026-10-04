import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@serviceform/contracts';
import type pg from 'pg';
import { auditThenAct } from '../../src/dead-letter/operator-actions.js';

const adminCtx: RequestContext = {
  tenant_id: null,
  cell_id: 'cell-01',
  actor: { type: 'PRIVILEGED_ADMIN', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
  roles: ['PRIVILEGED_ADMIN'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
};

function pool(): pg.Pool {
  return {
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.includes('current_tenant_id')) return { rows: [{ tid: null }] };
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    }),
  } as unknown as pg.Pool;
}

describe('auditThenAct', () => {
  it('requires privileged MFA, a reason, and an allow decision before apply', async () => {
    await expect(
      auditThenAct(
        pool(),
        { ...adminCtx, actor: { ...adminCtx.actor, type: 'SYSTEM' } },
        {
          decide: async () => ({
            allow: true,
            reason_code: 'OK',
            policy_revision: '1',
            decision_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
          }),
        },
        { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: 'r' },
        async () => 1,
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    await expect(
      auditThenAct(
        pool(),
        { ...adminCtx, auth_assurance: 'WORKLOAD_IDENTITY' },
        {
          decide: async () => ({
            allow: true,
            reason_code: 'OK',
            policy_revision: '1',
            decision_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
          }),
        },
        { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: 'r' },
        async () => 1,
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    await expect(
      auditThenAct(
        pool(),
        adminCtx,
        {
          decide: async () => ({
            allow: true,
            reason_code: 'OK',
            policy_revision: '1',
            decision_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
          }),
        },
        { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: '   ' },
        async () => 1,
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      auditThenAct(
        pool(),
        adminCtx,
        {
          decide: async () => ({
            allow: false,
            reason_code: 'DENY',
            policy_revision: '1',
            decision_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
          }),
        },
        { kind: 'discard', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: 'r' },
        async () => 1,
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('audits then applies replay and discard', async () => {
    let applied = 0;
    await auditThenAct(
      pool(),
      adminCtx,
      {
        decide: async () => ({
          allow: true,
          reason_code: 'OK',
          policy_revision: '1',
          decision_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
        }),
      },
      { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: 'fix' },
      async () => {
        applied += 1;
        return 1;
      },
    );
    await auditThenAct(
      pool(),
      adminCtx,
      {
        decide: async () => ({
          allow: true,
          reason_code: 'OK',
          policy_revision: '1',
          decision_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
        }),
      },
      { kind: 'discard', schema: 'sf_event_bus', table: 'outbox_event', seq: '2', reason: 'gone' },
      async () => {
        applied += 1;
        return 1;
      },
    );
    expect(applied).toBe(2);
  });
});
