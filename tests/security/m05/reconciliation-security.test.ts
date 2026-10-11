/**
 * SF-M05-SEC-RERUN — REM-001 durable reconciliation security surfaces.
 * Verifier-owned. Not CERTIFIED. Does not patch production.
 */
import { describe, expect, it } from 'vitest';
import { Cmp019Error } from '../../../services/cmp-019-deficiency/src/errors.js';
import type { TenantContext } from '../../../services/cmp-019-deficiency/src/types.js';
import {
  ACTOR_CITIZEN,
  APPLICATION_ID,
  ctxFor,
  OPEN_BODY,
  TENANT_A,
  TENANT_B,
} from '../../../services/cmp-019-deficiency/test/doubles/fixtures.js';
import { makeHarness } from '../../../services/cmp-019-deficiency/test/doubles/harness.js';

type Body = Record<string, unknown>;

function tenantCtx(tenant = TENANT_A): TenantContext {
  const ctx = ctxFor(tenant, ACTOR_CITIZEN, 'CITIZEN');
  if (ctx.tenant_id === null) throw new Error('tenant required');
  return ctx as TenantContext;
}

function intents(h: ReturnType<typeof makeHarness>, tenant = TENANT_A) {
  return [...h.repo.tenant(tenant).intents.values()];
}

async function openNotice(h: ReturnType<typeof makeHarness>) {
  const opened = await h.call('POST', '/v1/deficiencies', OPEN_BODY);
  expect(opened.status).toBe(201);
  return opened.body as Body;
}

describe('SF-M05-SEC-RERUN REM-001 reconciliation security (not CERTIFIED)', () => {
  it('durable recon does not bypass expected_state/version; STALE → FAILED_STALE terminal', async () => {
    const h = makeHarness();
    h.caseCommands.staleExpectedStateNext = 1;
    await openNotice(h);
    const intent = intents(h)[0];
    expect(intent?.case_expected_state).toBe('UNDER_SCRUTINY');
    expect(intent?.case_expected_version).toBe(8);
    expect(intent?.case_effect_status).toBe('FAILED_STALE');
    expect(intent?.last_error_code).toBe('STALE_EXPECTED_STATE');
    // Terminal: reconcilePending must not re-attempt case effect.
    const before = h.caseCommands.commands.length;
    const pending = await h.service.getReconciliationConsumer().reconcilePending(tenantCtx());
    expect(pending).toHaveLength(0);
    expect(h.caseCommands.commands).toHaveLength(before);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
  });

  it('STALE_VERSION also terminates safely as FAILED_STALE', async () => {
    const h = makeHarness();
    h.caseCommands.staleVersionNext = 1;
    await openNotice(h);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
    expect(intents(h)[0]?.last_error_code).toBe('STALE_VERSION');
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx());
    expect(h.caseCommands.commands).toHaveLength(0);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
  });

  it('reconcile refuses when authoritative transaction is open (no network in auth txn)', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    await openNotice(h);
    const intentId = intents(h)[0]?.intent_id;
    expect(intentId).toBeTruthy();
    await expect(
      h.repo.withTx(tenantCtx(), async () =>
        h.service.getReconciliationConsumer().reconcileIntent(tenantCtx(), intentId as string),
      ),
    ).rejects.toBeInstanceOf(Cmp019Error);
    try {
      await h.repo.withTx(tenantCtx(), async () =>
        h.service.getReconciliationConsumer().reconcileIntent(tenantCtx(), intentId as string),
      );
    } catch (e) {
      expect(e).toBeInstanceOf(Cmp019Error);
      expect((e as Cmp019Error).code).toBe('SF-SYS-001');
      expect((e as Cmp019Error).details?.[0]?.code).toBe('NETWORK_IN_TX');
    }
  });

  it('wrong-tenant reconcile cannot observe peer intent (CROSS_TENANT isolation)', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    await openNotice(h);
    const intentId = intents(h)[0]?.intent_id as string;
    expect(intentId).toBeTruthy();
    // Memory RLS analogue: peer tenant cannot load intent (not found) — no leakage.
    await expect(
      h.service.getReconciliationConsumer().reconcileIntent(tenantCtx(TENANT_B), intentId),
    ).rejects.toMatchObject({ code: 'SF-SYS-002' });
    expect(intents(h, TENANT_A)[0]?.case_effect_status).toBe('FAILED_RETRYABLE');
    expect(intents(h, TENANT_B)).toHaveLength(0);
  });

  it('reconstructor uses CaseCommandPort only with durable expected_state/version', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    await openNotice(h);
    expect(h.caseCommands.commands).toHaveLength(0);
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx());
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.caseCommands.commands[0]?.body.command).toBe('RAISE_DEFICIENCY');
    expect(h.caseCommands.commands[0]?.body.expected_state).toBe('UNDER_SCRUTINY');
    expect(h.caseCommands.commands[0]?.body.expected_version).toBe(8);
    expect(h.caseCommands.commands[0]?.applicationId).toBe(APPLICATION_ID);
    expect(intents(h)[0]?.case_effect_status).toBe('APPLIED');
  });
});
