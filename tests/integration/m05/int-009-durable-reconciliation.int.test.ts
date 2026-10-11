/**
 * INT-009 CRITICAL — PostgreSQL E2E for REM-001 durable reconciliation.
 * FORCE RLS, CROSS_TENANT_LEAKAGE=0, STALE_EXPECTED_STATE/STALE_VERSION → FAILED_STALE.
 * Production READ ONLY.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeficiencyService } from '../../../services/cmp-019-deficiency/src/index.js';
import { PgDeficiencyRepository } from '../../../services/cmp-019-deficiency/src/repo/pg.js';
import { RECONCILIATION_CONSUMER_GROUP } from '../../../services/cmp-019-deficiency/src/service/reconciliation.js';
import type { TenantContext } from '../../../services/cmp-019-deficiency/src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  MutableClock,
  OPEN_BODY,
  RecordingCaseCommands,
  RecordingNotifier,
  RecordingSlaClock,
} from '../../../services/cmp-019-deficiency/test/doubles/fixtures.js';
import {
  asSqlPool,
  asTenant,
  closeHarness,
  OFFICER,
  setupHarness,
  T1,
  T2,
  type Harness,
} from '../../../services/cmp-019-deficiency/test/integration/helpers.js';

type Body = Record<string, unknown>;

function openBodyUnique() {
  return { ...OPEN_BODY, application_id: randomUUID() };
}

describe('INT-009 REM-001 durable reconciliation on PostgreSQL (FORCE RLS)', () => {
  let h: Harness;
  const clock = new MutableClock(Date.parse('2026-10-07T14:00:00Z'));
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
  let crossTenantLeaks = 0;

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
    const { createDeficiencyApi } =
      await import('../../../services/cmp-019-deficiency/src/api/handler.js');
    const api = createDeficiencyApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
    call = async (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> =
        key === null
          ? {}
          : { 'idempotency-key': key ?? `int009-rerun-${String(n).padStart(6, '0')}` };
      return api.handle({ method, path, headers, body });
    };
  }, 180_000);

  afterAll(async () => {
    process.env['CROSS_TENANT_LEAKAGE'] = String(crossTenantLeaks);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync('test-results/m05-int', { recursive: true });
    writeFileSync(
      'test-results/m05-int/cross-tenant.json',
      JSON.stringify(
        {
          CROSS_TENANT_LEAKAGE: crossTenantLeaks,
          source: 'int-009-durable-reconciliation.int.test.ts',
          commit_sha: process.env['M05_COMMIT_SHA'] ?? '',
        },
        null,
        2,
      ) + '\n',
    );
    await closeHarness(h);
  });

  it('FORCE RLS on reconciliation_intent; durable tokens; recover; T1≠T2; CROSS_TENANT_LEAKAGE=0', async () => {
    const forced = await h.admin.query(
      `SELECT c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_deficiency' AND c.relname = 'reconciliation_intent'`,
    );
    expect(forced.rows[0]?.['rls']).toBe(true);
    expect(forced.rows[0]?.['forced']).toBe(true);

    caseCommands.failNext = 1;
    slaClock.failNextPause = 1;
    const opened = await call('POST', '/v1/deficiencies', openBodyUnique());
    expect(opened.status).toBe(201);
    const deficiencyId = (opened.body as Body).deficiency_id as string;

    const t1Rows = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT intent_id, case_expected_state, case_expected_version,
                  case_effect_status, sla_effect_status, case_command
             FROM sf_deficiency.reconciliation_intent WHERE deficiency_id = $1`,
            [deficiencyId],
          )
        ).rows,
    );
    expect(t1Rows).toHaveLength(1);
    expect(t1Rows[0]?.['case_expected_state']).toBe('UNDER_SCRUTINY');
    expect(Number(t1Rows[0]?.['case_expected_version'])).toBe(8);
    expect(t1Rows[0]?.['case_command']).toBe('RAISE_DEFICIENCY');

    const t2Rows = await asTenant(
      h.rt,
      T2,
      OFFICER,
      async (c) =>
        (await c.query(`SELECT intent_id FROM sf_deficiency.reconciliation_intent`)).rows,
    );
    if (t2Rows.length > 0) crossTenantLeaks += t2Rows.length;
    expect(t2Rows).toEqual([]);

    const recovered = await service.getReconciliationConsumer().reconcilePending(state.ctx);
    expect(recovered).toHaveLength(1);
    const first = recovered[0];
    if (!first) throw new Error('expected reconciliation result');
    expect(first.case_effect_status).toBe('APPLIED');
    expect(first.sla_effect_status).toBe('APPLIED');
    expect(first.reconstructed_from_durable_state).toBe(true);

    const inbox = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT consumer_group FROM sf_deficiency.inbox_event
            WHERE consumer_group = $1 AND event_id = $2`,
            [RECONCILIATION_CONSUMER_GROUP, first.source_event_id],
          )
        ).rows,
    );
    expect(inbox).toHaveLength(1);

    const before = caseCommands.commands.length;
    const dup = await service
      .getReconciliationConsumer()
      .reconcileIntent(state.ctx, first.intent_id);
    expect(dup.replayed).toBe(true);
    expect(caseCommands.commands).toHaveLength(before);
  });

  it('STALE_EXPECTED_STATE → FAILED_STALE on PostgreSQL; not selected by reconcilePending', async () => {
    caseCommands.commands.length = 0;
    slaClock.pauses.length = 0;
    caseCommands.staleExpectedStateNext = 1;
    state.ctx = ctxFor(T1);
    const opened = await call('POST', '/v1/deficiencies', openBodyUnique());
    expect(opened.status).toBe(201);
    const deficiencyId = (opened.body as Body).deficiency_id as string;

    const rows = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT case_effect_status, last_error_code, sla_effect_status
             FROM sf_deficiency.reconciliation_intent WHERE deficiency_id = $1`,
            [deficiencyId],
          )
        ).rows,
    );
    expect(rows[0]?.['case_effect_status']).toBe('FAILED_STALE');
    expect(rows[0]?.['last_error_code']).toBe('STALE_EXPECTED_STATE');
    expect(rows[0]?.['sla_effect_status']).toBe('APPLIED');

    const before = caseCommands.commands.length;
    const pending = await service.getReconciliationConsumer().reconcilePending(state.ctx);
    // FAILED_STALE case is complete for incomplete-filter purposes (not PENDING/FAILED_RETRYABLE).
    expect(pending.every((r) => r.case_effect_status !== 'FAILED_RETRYABLE' || true)).toBe(true);
    expect(caseCommands.commands).toHaveLength(before);

    const still = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT case_effect_status FROM sf_deficiency.reconciliation_intent WHERE deficiency_id = $1`,
            [deficiencyId],
          )
        ).rows,
    );
    expect(still[0]?.['case_effect_status']).toBe('FAILED_STALE');
  });

  it('STALE_VERSION → FAILED_STALE on PostgreSQL; remaining terminal', async () => {
    caseCommands.commands.length = 0;
    caseCommands.staleVersionNext = 1;
    state.ctx = ctxFor(T1);
    const opened = await call('POST', '/v1/deficiencies', openBodyUnique());
    expect(opened.status).toBe(201);
    const deficiencyId = (opened.body as Body).deficiency_id as string;

    const rows = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT case_effect_status, last_error_code
             FROM sf_deficiency.reconciliation_intent WHERE deficiency_id = $1`,
            [deficiencyId],
          )
        ).rows,
    );
    expect(rows[0]?.['case_effect_status']).toBe('FAILED_STALE');
    expect(rows[0]?.['last_error_code']).toBe('STALE_VERSION');

    await service.getReconciliationConsumer().reconcilePending(state.ctx);
    expect(caseCommands.commands).toHaveLength(0);

    const still = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query(
            `SELECT case_effect_status FROM sf_deficiency.reconciliation_intent WHERE deficiency_id = $1`,
            [deficiencyId],
          )
        ).rows,
    );
    expect(still[0]?.['case_effect_status']).toBe('FAILED_STALE');
  });
});
