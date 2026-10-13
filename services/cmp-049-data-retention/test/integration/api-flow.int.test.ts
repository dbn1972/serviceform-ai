import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRetentionApi } from '../../src/api/handler.js';
import { buildDataRetentionService } from '../../src/index.js';
import type { RequestContext } from '../../src/types.js';
import {
  ACTOR_OFFICER,
  ctxFor,
  MutableClock,
  OWNER_PERIOD_REF,
  policyBody,
  RESOURCE_1,
  ScriptedAuthorizer,
} from '../doubles/fixtures.js';
import {
  asSqlPool,
  closeHarness,
  resetData,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-049 API over PostgreSQL (real LOGIN role, FORCE RLS)', () => {
  let h: Harness;
  const holder: { ctx: RequestContext | null } = { ctx: null };
  const authorizer = new ScriptedAuthorizer();
  const clock = new MutableClock(Date.parse('2026-10-10T10:00:00Z'));
  let call: (
    m: string,
    p: string,
    body?: unknown,
    key?: string,
  ) => Promise<{ status: number; body: unknown }>;
  let n = 0;

  beforeAll(async () => {
    h = await setupHarness();
    const service = buildDataRetentionService({
      pool: asSqlPool(h.rt),
      authorizer,
      clock: clock.now,
    });
    const api = createRetentionApi({ service, resolveContext: () => Promise.resolve(holder.ctx) });
    call = (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> = {};
      if (method === 'POST')
        headers['idempotency-key'] = key ?? `it-key-${String(n).padStart(8, '0')}`;
      return api.handle({ method, path, headers, body });
    };
  }, 180_000);

  beforeEach(async () => {
    await resetData(h.admin);
    authorizer.deniedActions.clear();
    authorizer.fail = false;
    holder.ctx = ctxFor(T1);
  });

  afterAll(async () => {
    await closeHarness(h);
  });

  async function setup(): Promise<{ policyId: string; subjectId: string }> {
    const reg = await call('POST', '/v1/retention/policies', policyBody());
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const policyId = (reg.body as Body)['policy']['policy_id'] as string;
    const enr = await call('POST', '/v1/retention/subjects', {
      policy_id: policyId,
      resource_type: 'APPLICATION',
      resource_id: RESOURCE_1,
    });
    expect(enr.status, JSON.stringify(enr.body)).toBe(201);
    return { policyId, subjectId: (enr.body as Body)['subject_id'] as string };
  }

  const move = (subjectId: string, to: string, v: number, key?: string) =>
    call(
      'POST',
      `/v1/retention/subjects/${subjectId}/transitions`,
      { to_eligibility: to, expected_version: v },
      key,
    );

  async function outbox(tenant: string): Promise<Body[]> {
    return (
      await h.admin.query(
        `SELECT topic, event_type, envelope FROM sf_retention.outbox_event WHERE tenant_id = $1 ORDER BY seq`,
        [tenant],
      )
    ).rows;
  }

  it('fails closed with POLICY_INPUT_REQUIRED, leaves state unchanged and commits a FAILED audit', async () => {
    const { subjectId } = await setup();
    const res = await move(subjectId, 'ARCHIVE_ELIGIBLE', 1);
    expect(res.status).toBe(409);
    expect((res.body as Body)['details']).toEqual([{ code: 'POLICY_INPUT_REQUIRED' }]);
    const subj = await h.admin.query(
      'SELECT eligibility, subject_version FROM sf_retention.retention_subject WHERE subject_id = $1',
      [subjectId],
    );
    expect(subj.rows[0]).toEqual({ eligibility: 'ACTIVE', subject_version: '1' });
    const log = await h.admin.query('SELECT 1 FROM sf_retention.retention_transition_log');
    expect(log.rowCount).toBe(0);
    const rows = await outbox(T1);
    const failed = rows.filter(
      (r) =>
        r['event_type'] === 'AuditEventSubmitted' && r['envelope']['data']['result'] === 'FAILED',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.['envelope']['data']['reason']).toBe('POLICY_INPUT_REQUIRED');
    expect(rows.some((r) => r['event_type'] === 'RetentionEligibilityChanged')).toBe(false);
  });

  it('after owner period ref binding, archive then delete eligibility commit with log, event and audit', async () => {
    const { policyId, subjectId } = await setup();
    const bind = await call('POST', `/v1/retention/policies/${policyId}/period-ref`, {
      owner_supplied_period_ref: OWNER_PERIOD_REF,
    });
    expect(bind.status, JSON.stringify(bind.body)).toBe(200);
    expect((await move(subjectId, 'ARCHIVE_ELIGIBLE', 1)).status).toBe(200);
    const del = await move(subjectId, 'DELETE_ELIGIBLE', 2);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect((del.body as Body)['eligibility']).toBe('DELETE_ELIGIBLE');
    const log = await h.admin.query(
      `SELECT from_eligibility, to_eligibility, owner_supplied_period_ref, policy_version
         FROM sf_retention.retention_transition_log ORDER BY subject_version`,
    );
    expect(log.rows).toEqual([
      {
        from_eligibility: 'ACTIVE',
        to_eligibility: 'ARCHIVE_ELIGIBLE',
        owner_supplied_period_ref: OWNER_PERIOD_REF,
        policy_version: '2',
      },
      {
        from_eligibility: 'ARCHIVE_ELIGIBLE',
        to_eligibility: 'DELETE_ELIGIBLE',
        owner_supplied_period_ref: OWNER_PERIOD_REF,
        policy_version: '2',
      },
    ]);
    const types = (await outbox(T1)).map((r) => r['event_type']);
    expect(types.filter((t) => t === 'RetentionEligibilityChanged')).toHaveLength(2);
    expect(types).toContain('RetentionPolicyPeriodRefBound');
  });

  it('idempotent replay returns the stored response without a second transition', async () => {
    const { subjectId } = await setup();
    const a = await move(subjectId, 'LEGAL_HOLD', 1, 'it-replay-key-0001');
    const b = await move(subjectId, 'LEGAL_HOLD', 1, 'it-replay-key-0001');
    expect(a.status).toBe(200);
    expect(b).toEqual(a);
    const log = await h.admin.query('SELECT 1 FROM sf_retention.retention_transition_log');
    expect(log.rowCount).toBe(1);
  });

  it('tenant B cannot read, evaluate or move tenant A subjects', async () => {
    const { policyId, subjectId } = await setup();
    holder.ctx = ctxFor(T2, ACTOR_OFFICER, 'OFFICER');
    expect((await call('GET', `/v1/retention/policies/${policyId}`)).status).toBe(404);
    expect((await call('GET', `/v1/retention/subjects/${subjectId}`)).status).toBe(404);
    expect((await call('GET', `/v1/retention/subjects/${subjectId}/evaluation`)).status).toBe(404);
    expect((await move(subjectId, 'LEGAL_HOLD', 1)).status).toBe(404);
    const enr = await call('POST', '/v1/retention/subjects', {
      policy_id: policyId,
      resource_type: 'APPLICATION',
      resource_id: RESOURCE_1,
    });
    expect(enr.status).toBe(404);
    const subj = await h.admin.query(
      'SELECT eligibility FROM sf_retention.retention_subject WHERE subject_id = $1',
      [subjectId],
    );
    expect(subj.rows[0]?.['eligibility']).toBe('ACTIVE');
  });

  it('OPA denial and PDP outage fail closed; denial is audited', async () => {
    authorizer.deniedActions.add('RETENTION_POLICY_REGISTER');
    const res = await call('POST', '/v1/retention/policies', policyBody());
    expect(res.status).toBe(403);
    const audit = await outbox(T1);
    expect(audit.map((r) => r['envelope']['data']['result'])).toEqual(['DENIED']);
    authorizer.deniedActions.clear();
    authorizer.fail = true;
    expect((await call('POST', '/v1/retention/policies', policyBody())).status).toBe(503);
    const policies = await h.admin.query('SELECT 1 FROM sf_retention.retention_policy');
    expect(policies.rowCount).toBe(0);
  });

  it('evaluation over PostgreSQL reports the blocking reason per candidate', async () => {
    const { subjectId } = await setup();
    const res = await call('GET', `/v1/retention/subjects/${subjectId}/evaluation`);
    expect(res.status).toBe(200);
    const byTarget = Object.fromEntries(
      ((res.body as Body)['candidates'] as Body[]).map((c) => [
        c['to_eligibility'],
        c['blocking_reason'],
      ]),
    );
    expect(byTarget).toEqual({
      ARCHIVE_ELIGIBLE: 'POLICY_INPUT_REQUIRED',
      DELETE_ELIGIBLE: 'TRANSITION_NOT_IN_POLICY',
      LEGAL_HOLD: null,
    });
  });
});
