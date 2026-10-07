import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeficiencyService } from '../../src/index.js';
import { PgDeficiencyRepository } from '../../src/repo/pg.js';
import { RECONCILIATION_CONSUMER_GROUP } from '../../src/service/reconciliation.js';
import type { TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  MutableClock,
  OPEN_BODY,
  RecordingCaseCommands,
  RecordingNotifier,
  RecordingSlaClock,
} from '../doubles/fixtures.js';
import {
  asTenant,
  asSqlPool,
  closeHarness,
  OFFICER,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-019 durable reconciliation on PostgreSQL (FORCE RLS)', () => {
  let h: Harness;
  const clock = new MutableClock(Date.parse('2026-10-06T10:00:00Z'));
  const notifier = new RecordingNotifier();
  const slaClock = new RecordingSlaClock();
  const caseCommands = new RecordingCaseCommands();
  const state: { ctx: TenantContext } = { ctx: ctxFor(T1) };
  let service: ReturnType<typeof buildDeficiencyService>;
  let call: (
    method: string,
    path: string,
    body?: unknown,
    key?: string | null,
  ) => Promise<{ status: number; body: unknown }>;
  let n = 0;

  beforeAll(async () => {
    h = await setupHarness();
    service = buildDeficiencyService({
      repository: new PgDeficiencyRepository(asSqlPool(h.rt)),
      authorizer: new AllowAllAuthorizer(),
      notifier,
      slaClock,
      caseCommands,
      clock: clock.now,
    });
    const { createDeficiencyApi } = await import('../../src/api/handler.js');
    const api = createDeficiencyApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
    call = async (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> =
        key === null ? {} : { 'idempotency-key': key ?? `recon-key-${String(n).padStart(6, '0')}` };
      return api.handle({ method, path, headers, body });
    };
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('FORCE RLS on reconciliation_intent; T1≠T2; CROSS_TENANT_LEAKAGE=0', async () => {
    const forced = await h.admin.query(
      `SELECT c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_deficiency' AND c.relname = 'reconciliation_intent'`,
    );
    expect(forced.rows[0]?.['rls']).toBe(true);
    expect(forced.rows[0]?.['forced']).toBe(true);

    caseCommands.failNext = 1;
    slaClock.failNextPause = 1;
    const opened = await call('POST', '/v1/deficiencies', OPEN_BODY);
    expect(opened.status).toBe(201);
    const deficiencyId = (opened.body as Body).deficiency_id as string;

    const t1Rows = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT intent_id, case_expected_state, case_expected_version, case_effect_status, sla_effect_status
             FROM sf_deficiency.reconciliation_intent WHERE deficiency_id = $1`,
            [deficiencyId],
          )
        ).rows,
    );
    expect(t1Rows).toHaveLength(1);
    expect(t1Rows[0]?.['case_expected_state']).toBe('UNDER_SCRUTINY');
    expect(Number(t1Rows[0]?.['case_expected_version'])).toBe(8);

    const t2Rows = await asTenant(
      h.rt,
      T2,
      OFFICER,
      async (c) =>
        (await c.query(`SELECT intent_id FROM sf_deficiency.reconciliation_intent`)).rows,
    );
    expect(t2Rows).toEqual([]);

    // Recover via executable reconciler (no cross-component SQL).
    const recovered = await service.getReconciliationConsumer().reconcilePending(state.ctx);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.case_effect_status).toBe('APPLIED');
    expect(recovered[0]?.sla_effect_status).toBe('APPLIED');
    expect(caseCommands.commands).toHaveLength(1);
    expect(slaClock.pauses).toHaveLength(1);

    const inbox = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT consumer_group FROM sf_deficiency.inbox_event
            WHERE consumer_group = $1 AND event_id = $2`,
            [RECONCILIATION_CONSUMER_GROUP, recovered[0]!.source_event_id],
          )
        ).rows,
    );
    expect(inbox).toHaveLength(1);

    // Duplicate delivery no-op.
    const before = caseCommands.commands.length;
    const dup = await service
      .getReconciliationConsumer()
      .reconcileIntent(state.ctx, recovered[0]!.intent_id);
    expect(dup.replayed).toBe(true);
    expect(caseCommands.commands).toHaveLength(before);
  });
});
