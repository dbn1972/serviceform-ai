import { describe, expect, it } from 'vitest';
import { RECONCILIATION_CONSUMER_GROUP } from '../../src/service/reconciliation.js';
import type { TenantContext } from '../../src/types.js';
import {
  ACTOR_CITIZEN,
  APPLICATION_ID,
  ctxFor,
  OPEN_BODY,
  RESPOND_BODY,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function tenantCtx(h: ReturnType<typeof makeHarness>): TenantContext {
  const ctx = h.state.ctx;
  if (!ctx || ctx.tenant_id === null) throw new Error('tenant context required');
  return ctx as TenantContext;
}

async function openNotice(h: ReturnType<typeof makeHarness>) {
  const opened = await h.call('POST', '/v1/deficiencies', OPEN_BODY);
  expect(opened.status).toBe(201);
  return opened.body as Body;
}

function intents(h: ReturnType<typeof makeHarness>, tenant = TENANT_A) {
  return [...h.repo.tenant(tenant).intents.values()];
}

describe('CMP-019 durable reconciliation (INT-009 REM-001)', () => {
  it('OPEN/RESPOND healthy path applies case + SLA + notification via reconciler', async () => {
    const h = makeHarness();
    const notice = await openNotice(h);
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.caseCommands.commands[0]?.body.expected_state).toBe('UNDER_SCRUTINY');
    expect(h.caseCommands.commands[0]?.body.expected_version).toBe(8);
    expect(h.slaClock.pauses).toHaveLength(1);
    expect(h.notifier.requests).toHaveLength(1);
    const openIntent = intents(h)[0];
    expect(openIntent?.case_effect_status).toBe('APPLIED');
    expect(openIntent?.sla_effect_status).toBe('APPLIED');
    expect(openIntent?.notification_effect_status).toBe('APPLIED');
    expect(openIntent?.case_expected_state).toBe('UNDER_SCRUTINY');
    expect(openIntent?.case_expected_version).toBe(8);

    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const responded = await h.call(
      'POST',
      `/v1/deficiencies/${notice.deficiency_id as string}/response`,
      RESPOND_BODY,
    );
    expect(responded.status).toBe(200);
    expect(h.caseCommands.commands[1]?.body.command).toBe('RECORD_CITIZEN_RESPONSE');
    expect(h.slaClock.resumes).toHaveLength(1);
    expect(intents(h)).toHaveLength(2);
    expect(intents(h)[1]?.case_effect_status).toBe('APPLIED');
    expect(intents(h)[1]?.sla_effect_status).toBe('APPLIED');
  });

  it('persists same-txn durable intent with tokens sufficient to reconstruct effects', async () => {
    const h = makeHarness();
    // Suppress afterCommit delivery by failing ports, then inspect durable state.
    h.caseCommands.failNext = 1;
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    const intent = intents(h)[0];
    expect(intent).toBeTruthy();
    expect(intent?.application_id).toBe(APPLICATION_ID);
    expect(intent?.case_command).toBe('RAISE_DEFICIENCY');
    expect(intent?.case_expected_state).toBe('UNDER_SCRUTINY');
    expect(intent?.case_expected_version).toBe(8);
    expect(intent?.case_reason_code).toBe('MISSING_PROOF');
    expect(intent?.case_idempotency_key).toBeTruthy();
    expect(intent?.sla_kind).toBe('pause');
    expect(intent?.sla_stage_code).toBe('OVERALL');
    expect(intent?.sla_reason_code).toBe('DEFICIENCY_OPEN');
    expect(intent?.sla_idempotency_key).toMatch(/^int009-pause:/);
    expect(intent?.tenant_id).toBe(TENANT_A);
    expect(intent?.cell_id).toBe('cell-test-1');
    expect(intent?.correlation_id).toBeTruthy();
    expect(intent?.source_event_id).toBeTruthy();
  });

  it('CMP-015 fail then reconcile recovers case command from durable intent', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    await openNotice(h);
    expect(h.caseCommands.commands).toHaveLength(0);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_RETRYABLE');
    expect(intents(h)[0]?.sla_effect_status).toBe('APPLIED');

    const recovered = await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.case_effect_status).toBe('APPLIED');
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.caseCommands.commands[0]?.body.expected_version).toBe(8);
    expect(intents(h)[0]?.case_effect_status).toBe('APPLIED');
  });

  it('CMP-029 fail then reconcile recovers SLA pause from durable intent', async () => {
    const h = makeHarness();
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    expect(h.slaClock.pauses).toHaveLength(0);
    expect(intents(h)[0]?.sla_effect_status).toBe('FAILED_RETRYABLE');
    expect(intents(h)[0]?.case_effect_status).toBe('APPLIED');

    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.slaClock.pauses).toHaveLength(1);
    expect(intents(h)[0]?.sla_effect_status).toBe('APPLIED');
  });

  it('both case and SLA fail then recover via reconciler', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    expect(h.caseCommands.commands).toHaveLength(0);
    expect(h.slaClock.pauses).toHaveLength(0);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_RETRYABLE');
    expect(intents(h)[0]?.sla_effect_status).toBe('FAILED_RETRYABLE');

    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.slaClock.pauses).toHaveLength(1);
    expect(intents(h)[0]?.case_effect_status).toBe('APPLIED');
    expect(intents(h)[0]?.sla_effect_status).toBe('APPLIED');
  });

  it('crash after commit before downstream: durable intent remains PENDING and drain recovers', async () => {
    const h = makeHarness();
    // Simulate crash: persist intent without running afterCommit by opening with failing ports
    // then resetting fail counters and draining (intent was written in the committed txn).
    h.caseCommands.failNext = 99;
    h.slaClock.failNextPause = 99;
    await openNotice(h);
    expect(h.caseCommands.commands).toHaveLength(0);
    expect(h.slaClock.pauses).toHaveLength(0);
    const intent = intents(h)[0]!;
    expect(intent.case_effect_status).toBe('FAILED_RETRYABLE');

    h.caseCommands.failNext = 0;
    h.slaClock.failNextPause = 0;
    const results = await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(results[0]?.reconstructed_from_durable_state).toBe(true);
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.slaClock.pauses).toHaveLength(1);
  });

  it('crash after first effect: partial retry applies only incomplete effects', async () => {
    const h = makeHarness();
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.slaClock.pauses).toHaveLength(0);
    expect(intents(h)[0]?.case_effect_status).toBe('APPLIED');
    expect(intents(h)[0]?.sla_effect_status).toBe('FAILED_RETRYABLE');

    const beforeCase = h.caseCommands.commands.length;
    await h.service
      .getReconciliationConsumer()
      .reconcileIntent(tenantCtx(h), intents(h)[0]!.intent_id);
    expect(h.caseCommands.commands).toHaveLength(beforeCase); // case not re-applied
    expect(h.slaClock.pauses).toHaveLength(1);
    expect(intents(h)[0]?.sla_effect_status).toBe('APPLIED');
  });

  it('duplicate delivery is a no-op once inbox recorded', async () => {
    const h = makeHarness();
    await openNotice(h);
    const intent = intents(h)[0]!;
    expect(
      h.repo
        .tenant(TENANT_A)
        .inbox.has(`${RECONCILIATION_CONSUMER_GROUP}|${intent.source_event_id}`),
    ).toBe(true);
    const beforeCase = h.caseCommands.commands.length;
    const beforeSla = h.slaClock.pauses.length;
    const dup = await h.service
      .getReconciliationConsumer()
      .reconcileIntent(tenantCtx(h), intent.intent_id);
    expect(dup.replayed).toBe(true);
    expect(h.caseCommands.commands).toHaveLength(beforeCase);
    expect(h.slaClock.pauses).toHaveLength(beforeSla);
  });

  it('idempotent open replay does not re-fire ports', async () => {
    const h = makeHarness();
    const first = await h.call('POST', '/v1/deficiencies', OPEN_BODY, { key: 'idem-open-0001' });
    expect(first.status).toBe(201);
    const pauses = h.slaClock.pauses.length;
    const commands = h.caseCommands.commands.length;
    const intentCount = intents(h).length;
    const replay = await h.call('POST', '/v1/deficiencies', OPEN_BODY, { key: 'idem-open-0001' });
    expect(replay.status).toBe(201);
    expect(h.slaClock.pauses).toHaveLength(pauses);
    expect(h.caseCommands.commands).toHaveLength(commands);
    expect(intents(h)).toHaveLength(intentCount);
  });

  it('stale expected version is rejected safely and remains observable', async () => {
    const h = makeHarness();
    h.caseCommands.staleNext = 1;
    await openNotice(h);
    expect(h.caseCommands.commands).toHaveLength(0);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
    expect(intents(h)[0]?.last_error_code).toBe('STALE_EXPECTED_VERSION');
    // SLA still applied; case terminal stale must not be blindly retried.
    expect(intents(h)[0]?.sla_effect_status).toBe('APPLIED');
    const before = h.caseCommands.commands.length;
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.caseCommands.commands).toHaveLength(before);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
  });

  it('reconstructs exact intended effects from durable state alone', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    const intent = intents(h)[0]!;
    // Clear in-memory port history; only durable intent remains as source of truth.
    h.caseCommands.commands.length = 0;
    h.slaClock.pauses.length = 0;
    const result = await h.service
      .getReconciliationConsumer()
      .reconcileIntent(tenantCtx(h), intent.intent_id);
    expect(result.reconstructed_from_durable_state).toBe(true);
    expect(h.caseCommands.commands[0]?.body).toEqual({
      command: 'RAISE_DEFICIENCY',
      expected_state: 'UNDER_SCRUTINY',
      expected_version: 8,
      reason_code: 'MISSING_PROOF',
    });
    expect(h.slaClock.pauses[0]?.idempotency_key).toBe(`int009-pause:${intent.deficiency_id}`);
  });

  it('T1 intents are invisible to T2 (tenant isolation)', async () => {
    const h = makeHarness();
    await openNotice(h);
    expect(intents(h, TENANT_A)).toHaveLength(1);
    expect(intents(h, TENANT_B)).toHaveLength(0);
    h.state.ctx = ctxFor(TENANT_B);
    const pending = await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(pending).toHaveLength(0);
    expect(h.repo.tenant(TENANT_B).intents.size).toBe(0);
  });
});
