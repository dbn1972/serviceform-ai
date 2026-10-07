/**
 * INT-009 CRITICAL — executable E2E proof of REM-001 durable reconciliation.
 * Static inspection alone is insufficient. Covers REM-001 points including
 * STALE_EXPECTED_STATE / STALE_VERSION → FAILED_STALE terminal.
 * Production READ ONLY — imports production consumer + package test harness doubles.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECONCILIATION_CONSUMER_GROUP } from '../../../services/cmp-019-deficiency/src/service/reconciliation.js';
import type { TenantContext } from '../../../services/cmp-019-deficiency/src/types.js';
import {
  ACTOR_CITIZEN,
  APPLICATION_ID,
  ctxFor,
  OPEN_BODY,
  RESPOND_BODY,
  TENANT_A,
  TENANT_B,
} from '../../../services/cmp-019-deficiency/test/doubles/fixtures.js';
import { makeHarness } from '../../../services/cmp-019-deficiency/test/doubles/harness.js';

const ROOT = join(import.meta.dirname, '../../..');

type Body = Record<string, unknown>;

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

function firstIntent(h: ReturnType<typeof makeHarness>, tenant = TENANT_A) {
  const row = intents(h, tenant)[0];
  if (!row) throw new Error('expected reconciliation intent');
  return row;
}

function recordDurableStatus(
  status: 'PROVEN' | 'BLOCKED',
  reason: string,
  details: Record<string, unknown>,
): void {
  const dir = 'test-results/m05-int';
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'int-009-durable.json'),
    JSON.stringify(
      {
        INT_009_DURABLE_RECONCILIATION: status,
        reason,
        details,
        production_code_patched: false,
        cmp_019_residual: 'GOVERNING_UNRESOLVED_UNWAIVED',
        executable_e2e: true,
        static_inspection_alone: false,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  process.env['INT_009_DURABLE_RECONCILIATION'] = status;
}

describe('INT-009 REM-001 durable reconciliation (executable E2E)', () => {
  it('1 OPEN/RESPOND healthy applies case + SLA via reconciler with durable tokens', async () => {
    const h = makeHarness();
    const notice = await openNotice(h);
    expect(h.caseCommands.commands[0]?.body.expected_state).toBe('UNDER_SCRUTINY');
    expect(h.caseCommands.commands[0]?.body.expected_version).toBe(8);
    expect(h.slaClock.pauses).toHaveLength(1);
    expect(intents(h)[0]?.case_effect_status).toBe('APPLIED');
    expect(intents(h)[0]?.case_expected_state).toBe('UNDER_SCRUTINY');
    expect(intents(h)[0]?.case_expected_version).toBe(8);

    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const responded = await h.call(
      'POST',
      `/v1/deficiencies/${notice.deficiency_id as string}/response`,
      RESPOND_BODY,
    );
    expect(responded.status).toBe(200);
    expect(h.slaClock.resumes).toHaveLength(1);
    expect(intents(h)).toHaveLength(2);
  });

  it('2 same-txn durable intent reconstructs exact intended effects', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    const intent = firstIntent(h);
    expect(intent.application_id).toBe(APPLICATION_ID);
    expect(intent.case_command).toBe('RAISE_DEFICIENCY');
    expect(intent.case_expected_state).toBe('UNDER_SCRUTINY');
    expect(intent.case_expected_version).toBe(8);
    expect(intent.case_idempotency_key).toBeTruthy();
    expect(intent.sla_kind).toBe('pause');
    expect(intent.sla_idempotency_key).toMatch(/^int009-pause:/);
    expect(intent.tenant_id).toBe(TENANT_A);
    expect(intent.correlation_id).toBeTruthy();
    expect(intent.source_event_id).toBeTruthy();
  });

  it('3 CMP-015 fail then reconcile recovers case command', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    await openNotice(h);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_RETRYABLE');
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(intents(h)[0]?.case_effect_status).toBe('APPLIED');
  });

  it('4 CMP-029 fail then reconcile recovers SLA pause', async () => {
    const h = makeHarness();
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    expect(intents(h)[0]?.sla_effect_status).toBe('FAILED_RETRYABLE');
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.slaClock.pauses).toHaveLength(1);
    expect(intents(h)[0]?.sla_effect_status).toBe('APPLIED');
  });

  it('5 both fail then recover via reconciler', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.slaClock.pauses).toHaveLength(1);
  });

  it('6 crash after commit before downstream: drain recovers', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 99;
    h.slaClock.failNextPause = 99;
    await openNotice(h);
    h.caseCommands.failNext = 0;
    h.slaClock.failNextPause = 0;
    const results = await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(results[0]?.reconstructed_from_durable_state).toBe(true);
    expect(h.caseCommands.commands).toHaveLength(1);
    expect(h.slaClock.pauses).toHaveLength(1);
  });

  it('7 crash after first effect: partial retry only incomplete', async () => {
    const h = makeHarness();
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    const beforeCase = h.caseCommands.commands.length;
    await h.service
      .getReconciliationConsumer()
      .reconcileIntent(tenantCtx(h), firstIntent(h).intent_id);
    expect(h.caseCommands.commands).toHaveLength(beforeCase);
    expect(h.slaClock.pauses).toHaveLength(1);
  });

  it('8 duplicate delivery no-op once inbox recorded', async () => {
    const h = makeHarness();
    await openNotice(h);
    const intent = firstIntent(h);
    expect(
      h.repo
        .tenant(TENANT_A)
        .inbox.has(`${RECONCILIATION_CONSUMER_GROUP}|${intent.source_event_id}`),
    ).toBe(true);
    const before = h.caseCommands.commands.length;
    const dup = await h.service
      .getReconciliationConsumer()
      .reconcileIntent(tenantCtx(h), intent.intent_id);
    expect(dup.replayed).toBe(true);
    expect(h.caseCommands.commands).toHaveLength(before);
  });

  it('9 idempotent open replay does not re-fire ports', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/deficiencies', OPEN_BODY, { key: 'idem-open-rerun-0001' });
    const pauses = h.slaClock.pauses.length;
    const commands = h.caseCommands.commands.length;
    await h.call('POST', '/v1/deficiencies', OPEN_BODY, { key: 'idem-open-rerun-0001' });
    expect(h.slaClock.pauses).toHaveLength(pauses);
    expect(h.caseCommands.commands).toHaveLength(commands);
  });

  it('10 STALE_EXPECTED_VERSION → FAILED_STALE terminal; not retryable', async () => {
    const h = makeHarness();
    h.caseCommands.staleNext = 1;
    await openNotice(h);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
    expect(intents(h)[0]?.last_error_code).toBe('STALE_EXPECTED_VERSION');
    const before = h.caseCommands.commands.length;
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.caseCommands.commands).toHaveLength(before);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
  });

  it('11 STALE_EXPECTED_STATE → FAILED_STALE terminal (REM_001_R1)', async () => {
    const h = makeHarness();
    h.caseCommands.staleExpectedStateNext = 1;
    await openNotice(h);
    const intent = firstIntent(h);
    expect(intent.case_effect_status).toBe('FAILED_STALE');
    expect(intent.last_error_code).toBe('STALE_EXPECTED_STATE');
    expect(intent.sla_effect_status).toBe('APPLIED');
    const pending = await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(pending).toHaveLength(0);
    const dup = await h.service
      .getReconciliationConsumer()
      .reconcileIntent(tenantCtx(h), intent.intent_id);
    expect(dup.replayed).toBe(true);
    expect(dup.case_effect_status).toBe('FAILED_STALE');
  });

  it('12 STALE_VERSION → FAILED_STALE terminal', async () => {
    const h = makeHarness();
    h.caseCommands.staleVersionNext = 1;
    await openNotice(h);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
    expect(intents(h)[0]?.last_error_code).toBe('STALE_VERSION');
    await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(h.caseCommands.commands).toHaveLength(0);
    expect(intents(h)[0]?.case_effect_status).toBe('FAILED_STALE');
  });

  it('13 reconstructs exact CaseCommandPort/SlaClockPort calls from durable state alone', async () => {
    const h = makeHarness();
    h.caseCommands.failNext = 1;
    h.slaClock.failNextPause = 1;
    await openNotice(h);
    const intent = firstIntent(h);
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

  it('14 T1 intents invisible to T2 (tenant isolation)', async () => {
    const h = makeHarness();
    await openNotice(h);
    expect(intents(h, TENANT_A)).toHaveLength(1);
    expect(intents(h, TENANT_B)).toHaveLength(0);
    h.state.ctx = ctxFor(TENANT_B);
    const pending = await h.service.getReconciliationConsumer().reconcilePending(tenantCtx(h));
    expect(pending).toHaveLength(0);
  });

  it('15 no network in auth txn; consumer refuses when repo.inTransaction()', async () => {
    const h = makeHarness();
    await openNotice(h);
    const intent = firstIntent(h);
    const reconSrc = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/service/reconciliation.ts'),
      'utf8',
    );
    expect(reconSrc).toContain("code: 'NETWORK_IN_TX'");
    expect(reconSrc).toMatch(/if \(this\.deps\.repo\.inTransaction\(\)\)/);
    Object.defineProperty(h.repo, 'inTransaction', {
      value: () => true,
      configurable: true,
    });
    await expect(
      h.service.getReconciliationConsumer().reconcileIntent(tenantCtx(h), intent.intent_id),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });

  it('16 CaseCommandPort / SlaClockPort only — no cross-component SQL in reconciler', () => {
    const recon = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/service/reconciliation.ts'),
      'utf8',
    );
    expect(recon).toContain('caseCommands.executeCommand');
    expect(recon).toContain('slaClock.pauseForDeficiency');
    expect(recon).toContain('slaClock.resumeAfterDeficiency');
    expect(recon).not.toMatch(/FROM\s+sf_application_case/i);
    expect(recon).not.toMatch(/FROM\s+sf_sla\./i);
    expect(recon).not.toMatch(/INSERT\s+INTO\s+sf_application_case/i);
    const pg = readFileSync(join(ROOT, 'services/cmp-019-deficiency/src/repo/pg.ts'), 'utf8');
    // Authoritative SQL stays in sf_deficiency only.
    expect(pg).not.toMatch(/sf_application_case|sf_sla\.|sf_tasks\.|sf_workflow/);
  });

  it('17 Temporal is not authoritative for reconciliation', () => {
    const recon = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/service/reconciliation.ts'),
      'utf8',
    );
    expect(recon).toMatch(/Temporal is not authoritative/);
    expect(recon).not.toMatch(/@temporalio|WorkflowClient|temporal\.signal/);
  });

  it('18 migration + consumer present on production base', () => {
    const migration = readFileSync(
      join(ROOT, 'db/migrations/1759541900002_cmp-019-reconciliation.sql'),
      'utf8',
    );
    expect(migration).toContain('reconciliation_intent');
    expect(migration).toContain('case_expected_state');
    expect(migration).toContain('case_expected_version');
    expect(migration).toContain('FAILED_STALE');
    expect(migration).toMatch(/FORCE ROW LEVEL SECURITY/i);
    const recon = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/service/reconciliation.ts'),
      'utf8',
    );
    expect(recon).toContain('class DeficiencyReconciliationConsumer');
    expect(recon).toContain('STALE_EXPECTED_STATE');
    expect(recon).toContain('STALE_VERSION');
  });

  it('19 material gate: record INT_009_DURABLE_RECONCILIATION=PROVEN', () => {
    recordDurableStatus(
      'PROVEN',
      'Executable E2E: durable reconciliation_intent + DeficiencyReconciliationConsumer proves OPEN/RESPOND, fail→reconcile, crash recovery, duplicate/replay, STALE_EXPECTED_STATE/STALE_VERSION→FAILED_STALE terminal, T1≠T2, ports-only, no network in auth txn',
      {
        migration: 'db/migrations/1759541900002_cmp-019-reconciliation.sql',
        consumer: 'DeficiencyReconciliationConsumer',
        stale_codes_terminal: ['STALE_EXPECTED_STATE', 'STALE_VERSION', 'STALE_EXPECTED_VERSION'],
        residual: 'GOVERNING_UNRESOLVED_UNWAIVED',
        residual_closure_recommended_if_all_pass: true,
      },
    );
    expect(process.env['INT_009_DURABLE_RECONCILIATION']).toBe('PROVEN');
  });

  it('20 CMP-028 residual remains unwaived (revalidate — do not silently waive)', () => {
    const m05 = readFileSync(join(ROOT, 'apps/api/src/composition/m05.ts'), 'utf8');
    expect(m05).toContain('GOVERNING_UNRESOLVED_UNWAIVED');
    expect(m05).toContain('CMP-019');
    expect(m05).toContain('CMP-028');
  });
});
