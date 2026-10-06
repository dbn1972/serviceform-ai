import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantRequestContext } from '../../src/domain/validate.js';
import { Cmp015Error } from '../../src/errors.js';
import { SimulatedPublishedBindingPort } from '../../src/ports/published-binding.js';
import { SimulatedServicePolicyPort } from '../../src/ports/service-policy.js';
import { ApplicationCaseService } from '../../src/service.js';
import { PgCaseStore } from '../../src/store/pg-store.js';
import type { CaseStore, CaseTx, DbSession } from '../../src/store/types.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import {
  AI_GATEWAY,
  CANARY,
  CITIZEN,
  ctx,
  HUMAN,
  key,
  OFFICER,
  pinsFor,
  RecordingWorkflow,
  SERVICE_ID,
  SYSTEM,
  TSB_T1,
  TSB_T2,
} from '../doubles/fixtures.js';
import {
  asTenant,
  closeHarness,
  resetCmp015Data,
  TABLE_SQL,
  type Cmp015Table,
  setupHarness,
  T1,
  T2,
  withAdmin,
  type Harness,
} from './helpers.js';

const RULE = pinsFor(TSB_T1).rule_version_id;

/** Wraps the real store to inject faults at precise points of the authoritative transaction. */
class FaultStore implements CaseStore {
  onOutbox: ((tx: CaseTx) => Promise<void>) | null = null;
  failCommit = false;
  constructor(private readonly inner: CaseStore) {}
  withTx<T>(session: DbSession, fn: (tx: CaseTx) => Promise<T>): Promise<T> {
    return this.inner.withTx(session, async (tx) => {
      const hook = this.onOutbox;
      const wrapped: CaseTx = hook
        ? new Proxy(tx, {
            get(target, prop, receiver) {
              const v = Reflect.get(target, prop, receiver) as unknown;
              if (prop !== 'insertOutbox' || typeof v !== 'function')
                return typeof v === 'function' ? v.bind(target) : v;
              return async (...args: unknown[]) => {
                await (v as (...a: unknown[]) => Promise<void>).apply(target, args);
                await hook(target);
              };
            },
          })
        : tx;
      const out = await fn(wrapped);
      if (this.failCommit) throw new Cmp015Error('SF-SYS-004');
      return out;
    });
  }
}

let h: Harness;
let store: FaultStore;
let service: ApplicationCaseService;
let workflow: RecordingWorkflow;
let authorizer: ContractAuthorizer;
let policy: SimulatedServicePolicyPort;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});
beforeEach(async () => {
  await withAdmin(resetCmp015Data);
  store = new FaultStore(new PgCaseStore(h.rt));
  workflow = new RecordingWorkflow();
  authorizer = new ContractAuthorizer();
  policy = new SimulatedServicePolicyPort();
  const bindings = new SimulatedPublishedBindingPort();
  bindings.put(T1, {
    tenant_service_binding_id: TSB_T1,
    service_id: SERVICE_ID,
    status: 'PUBLISHED',
    pins: pinsFor(TSB_T1),
  });
  bindings.put(T2, {
    tenant_service_binding_id: TSB_T2,
    service_id: SERVICE_ID,
    status: 'PUBLISHED',
    pins: pinsFor(TSB_T2),
  });
  service = new ApplicationCaseService({
    store,
    authorizer,
    bindings,
    servicePolicy: policy,
    workflow,
    config: { environment: 'CI' },
  });
});

const citizen = (t = T1) => ctx(t, 'CITIZEN', CITIZEN);
const officer = (t = T1) => ctx(t, 'OFFICER', OFFICER);
const system = (t = T1) => ctx(t, 'SYSTEM', SYSTEM);

async function dbCase(
  id: string,
  tenant = T1,
): Promise<{ state: string; aggregate_version: number } | undefined> {
  const r = await asTenant(h.rt, tenant, (c) =>
    c.query(
      'SELECT state, aggregate_version FROM sf_application_case.application_case WHERE application_id = $1',
      [id],
    ),
  );
  const row = r.rows[0];
  return row
    ? { state: String(row['state']), aggregate_version: Number(row['aggregate_version']) }
    : undefined;
}

async function count(table: Cmp015Table, tenant = T1): Promise<number> {
  const r = await asTenant(h.rt, tenant, (c) => c.query(TABLE_SQL[table].count));
  return Number(r.rows[0]?.['n']);
}

async function outboxCount(tenant = T1): Promise<number> {
  const r = await h.admin.query(
    'SELECT count(*)::int AS n FROM sf_application_case.outbox_event WHERE tenant_id = $1',
    [tenant],
  );
  return Number(r.rows[0]?.['n']);
}

async function draft(c: TenantRequestContext = citizen(), tsb = TSB_T1): Promise<string> {
  const res = await service.createDraft(c, { tenant_service_binding_id: tsb }, key('draft'));
  return (res.body as { application: { application_id: string } }).application.application_id;
}

async function run(
  c: TenantRequestContext,
  id: string,
  command: string,
  extra: Record<string, unknown> = {},
) {
  const cur = await dbCase(id, c.tenant_id);
  if (!cur) throw new Error('missing');
  return service.executeCommand(
    c,
    id,
    { command, expected_state: cur.state, expected_version: cur.aggregate_version, ...extra },
    key(command.toLowerCase().replace(/_/g, '-')),
  );
}

describe('INT-004 submission hot path over PostgreSQL (state + outbox in one short transaction)', () => {
  it('golden path DRAFT -> CLOSED: one transition, one domain event and one audit row per step', async () => {
    const id = await draft();
    for (const [c, cmd, extra] of [
      [citizen(), 'MARK_READY_TO_SUBMIT', {}],
      [citizen(), 'SUBMIT', {}],
      [system(), 'ENTER_PAYMENT_PENDING', {}],
      [system(), 'MARK_RECEIVED', {}],
      [system(), 'ENTER_SCRUTINY', {}],
      [officer(), 'RAISE_DEFICIENCY', {}],
      [citizen(), 'RECORD_CITIZEN_RESPONSE', {}],
      [officer(), 'ENTER_SCRUTINY', {}],
      [officer(), 'ENTER_DECISION_PENDING', {}],
      [officer(), 'RECORD_APPROVED', { decision: HUMAN, reason_code: 'ELIGIBLE' }],
      [system(), 'RECORD_ISSUED', {}],
      [system(), 'CLOSE', {}],
    ] as const) {
      await run(c, id, cmd, extra);
    }
    expect(await dbCase(id)).toEqual({ state: 'CLOSED', aggregate_version: 13 });
    expect(await count('case_transition')).toBe(13);
    expect(await outboxCount()).toBe(26);
    expect(workflow.signals.map((s) => s.aggregate_version)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    const env = await h.admin.query(
      `SELECT envelope FROM sf_application_case.outbox_event WHERE tenant_id = $1 AND event_type = 'ApplicationStateChanged' ORDER BY seq DESC LIMIT 1`,
      [T1],
    );
    expect(env.rows[0]?.['envelope']).toMatchObject({
      tenant_id: T1,
      aggregate_id: id,
      aggregate_version: 13,
      data: { to_state: 'CLOSED' },
    });
  });

  it('NEGATIVE: outbox failure rolls the state change back (atomic state + outbox)', async () => {
    const id = await draft();
    store.onOutbox = async () => {
      throw new Error('outbox insert failed');
    };
    await expect(run(citizen(), id, 'MARK_READY_TO_SUBMIT')).rejects.toBeInstanceOf(Cmp015Error);
    store.onOutbox = null;
    expect(await dbCase(id)).toEqual({ state: 'DRAFT', aggregate_version: 1 });
    expect(await count('case_transition')).toBe(1);
    expect(await outboxCount()).toBe(2);
    expect(await count('idempotency_record')).toBe(1);
  });

  it('NEGATIVE: network I/O inside the open transaction is refused and rolled back', async () => {
    const id = await draft();
    store.onOutbox = async () => {
      await service.ports.workflow.advance({} as never);
    };
    const err = await run(citizen(), id, 'MARK_READY_TO_SUBMIT').catch(
      (e: unknown) => e as Cmp015Error,
    );
    expect(err).toMatchObject({
      code: 'SF-SYS-001',
      details: [{ code: 'NETWORK_IO_IN_DOMAIN_TX' }],
    });
    store.onOutbox = null;
    expect(await dbCase(id)).toEqual({ state: 'DRAFT', aggregate_version: 1 });
    expect(workflow.signals).toHaveLength(0);
  });

  it('NEGATIVE: Temporal advance before domain commit is impossible (commit failure => no signal, no state)', async () => {
    const id = await draft();
    store.failCommit = true;
    await expect(run(citizen(), id, 'MARK_READY_TO_SUBMIT')).rejects.toMatchObject({
      code: 'SF-SYS-004',
    });
    store.failCommit = false;
    expect(workflow.signals).toHaveLength(0);
    expect(await dbCase(id)).toEqual({ state: 'DRAFT', aggregate_version: 1 });
  });
});

describe('optimistic concurrency and idempotency over PostgreSQL', () => {
  it('NEGATIVE: stale expected_state / expected_version rejected; DB unchanged', async () => {
    const id = await draft();
    await expect(
      service.executeCommand(
        citizen(),
        id,
        { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 9 },
        key(),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    await expect(
      service.executeCommand(
        citizen(),
        id,
        { command: 'SUBMIT', expected_state: 'READY_TO_SUBMIT', expected_version: 1 },
        key(),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    expect(await dbCase(id)).toEqual({ state: 'DRAFT', aggregate_version: 1 });
  });

  it('NEGATIVE: two concurrent commands on the same version => exactly one commits, the other is SF-APP-001', async () => {
    const id = await draft();
    const body = { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 };
    const results = await Promise.allSettled([
      service.executeCommand(citizen(), id, body, key('a')),
      service.executeCommand(citizen(), id, body, key('b')),
      service.executeCommand(citizen(), id, body, key('c')),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed.length).toBe(2);
    for (const f of failed) expect((f.reason as Cmp015Error).code).toBe('SF-APP-001');
    expect(await dbCase(id)).toEqual({ state: 'READY_TO_SUBMIT', aggregate_version: 2 });
    expect(await count('case_transition')).toBe(2);
  });

  it('NEGATIVE: duplicate idempotency key (sequential and concurrent) is safe: one transition, same response', async () => {
    const id = await draft();
    const k = key('dup');
    const body = { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 };
    const settled = await Promise.allSettled([
      service.executeCommand(citizen(), id, body, k),
      service.executeCommand(citizen(), id, body, k),
    ]);
    const later = await service.executeCommand(citizen(), id, body, k);
    expect(later.replayed).toBe(true);
    for (const s of settled) {
      if (s.status === 'fulfilled')
        expect((s.value.body as { transition: unknown }).transition).toEqual(
          (later.body as { transition: unknown }).transition,
        );
      else expect((s.reason as Cmp015Error).code).toBe('SF-APP-002');
    }
    expect(await count('case_transition')).toBe(2);
    expect(await outboxCount()).toBe(4);
    await expect(
      service.executeCommand(
        citizen(),
        id,
        { command: 'SUBMIT', expected_state: 'READY_TO_SUBMIT', expected_version: 2 },
        k,
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
  });
});

describe('INT-011 tenant isolation over PostgreSQL (CROSS_TENANT_LEAKAGE=0)', () => {
  it('NEGATIVE: wrong tenant is denied on every operation and observes zero rows', async () => {
    const id = await draft();
    await draft(citizen(T2), TSB_T2);
    const intruder = officer(T2);
    for (const op of [
      () => service.getApplication(intruder, id),
      () => service.listTransitions(intruder, id),
      () =>
        service.executeCommand(
          intruder,
          id,
          { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 },
          key(),
        ),
      () => service.registerRequest(intruder, id, { kind: 'WITHDRAWAL' }, key()),
    ]) {
      const err = (await op().then(
        () => null,
        (e: unknown) => e,
      )) as Cmp015Error;
      expect(err?.code).toBe('SF-SYS-002');
      expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(id);
    }
    expect(await dbCase(id, T2)).toBeUndefined();
    const leak = await asTenant(h.rt, T2, (c) =>
      c.query(
        `SELECT
           (SELECT count(*) FROM sf_application_case.application_case WHERE tenant_id = $1) +
           (SELECT count(*) FROM sf_application_case.case_transition WHERE tenant_id = $1) +
           (SELECT count(*) FROM sf_application_case.idempotency_record WHERE tenant_id = $1) +
           (SELECT count(*) FROM sf_application_case.case_request_reference WHERE tenant_id = $1) AS leaked`,
        [T1],
      ),
    );
    expect(Number(leak.rows[0]?.['leaked'])).toBe(0);
    expect(await dbCase(id)).toEqual({ state: 'DRAFT', aggregate_version: 1 });
    expect(await count('application_case', T2)).toBe(1);
  });
});

describe('policy-gated withdrawal / cancellation over PostgreSQL (ADR-0003)', () => {
  async function underScrutiny(): Promise<string> {
    const id = await draft();
    await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    await run(citizen(), id, 'SUBMIT');
    await run(system(), id, 'MARK_RECEIVED');
    await run(system(), id, 'ENTER_SCRUTINY');
    return id;
  }

  it('NEGATIVE: WITHDRAWN / CANCELLED without a committed request are rejected; request registration leaves state', async () => {
    const id = await underScrutiny();
    policy.permit(RULE, 'UNDER_SCRUTINY>WITHDRAWN');
    policy.permit(RULE, 'UNDER_SCRUTINY>CANCELLED');
    await expect(run(system(), id, 'COMMIT_WITHDRAWAL')).rejects.toMatchObject({
      code: 'SF-APP-001',
    });
    const req = await service.registerRequest(citizen(), id, { kind: 'WITHDRAWAL' }, key());
    const rid = (req.body as { request: { request_id: string } }).request.request_id;
    expect(await dbCase(id)).toEqual({ state: 'UNDER_SCRUTINY', aggregate_version: 5 });
    await expect(run(system(), id, 'COMMIT_WITHDRAWAL', { request_id: rid })).rejects.toMatchObject(
      { code: 'SF-APP-001' },
    );
    await expect(
      run(system(), id, 'COMMIT_CANCELLATION', { request_id: rid }),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    expect(await dbCase(id)).toEqual({ state: 'UNDER_SCRUTINY', aggregate_version: 5 });
  });

  it('commits WITHDRAWN with a committed request + permitting policy; the request is consumed exactly once', async () => {
    const id = await underScrutiny();
    policy.permit(RULE, 'UNDER_SCRUTINY>WITHDRAWN');
    const req = await service.registerRequest(citizen(), id, { kind: 'WITHDRAWAL' }, key());
    const rid = (req.body as { request: { request_id: string } }).request.request_id;
    await service.updateRequestStatus(
      officer(),
      id,
      rid,
      { status: 'UNDER_REVIEW', expected_status: 'SUBMITTED' },
      key(),
    );
    await service.updateRequestStatus(
      officer(),
      id,
      rid,
      {
        status: 'COMMITTED',
        expected_status: 'UNDER_REVIEW',
        decision: HUMAN,
        reason_code: 'APPROVED_BY_OFFICER',
      },
      key(),
    );
    expect(await dbCase(id)).toEqual({ state: 'UNDER_SCRUTINY', aggregate_version: 5 });
    await run(system(), id, 'COMMIT_WITHDRAWAL', { request_id: rid });
    expect(await dbCase(id)).toEqual({ state: 'WITHDRAWN', aggregate_version: 6 });
    const r = await asTenant(h.rt, T1, (c) =>
      c.query(
        'SELECT consumed_at_version FROM sf_application_case.case_request_reference WHERE request_id = $1',
        [rid],
      ),
    );
    expect(Number(r.rows[0]?.['consumed_at_version'])).toBe(6);
    const t = await asTenant(h.rt, T1, (c) =>
      c.query(
        `SELECT transition_class, request_id, policy_ref FROM sf_application_case.case_transition WHERE application_id = $1 AND aggregate_version = 6`,
        [id],
      ),
    );
    expect(t.rows[0]).toMatchObject({
      transition_class: 'POLICY_GATED_WITHDRAWAL',
      request_id: rid,
      policy_ref: `simulated:${RULE}`,
    });
  });

  it('NEGATIVE: policy deny keeps the case and the committed request untouched', async () => {
    const id = await underScrutiny();
    const req = await service.registerRequest(officer(), id, { kind: 'CANCELLATION' }, key());
    const rid = (req.body as { request: { request_id: string } }).request.request_id;
    await service.updateRequestStatus(
      officer(),
      id,
      rid,
      { status: 'COMMITTED', expected_status: 'SUBMITTED', decision: HUMAN },
      key(),
    );
    await expect(
      run(system(), id, 'COMMIT_CANCELLATION', { request_id: rid }),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    const r = await asTenant(h.rt, T1, (c) =>
      c.query(
        'SELECT consumed_at_version FROM sf_application_case.case_request_reference WHERE request_id = $1',
        [rid],
      ),
    );
    expect(r.rows[0]?.['consumed_at_version']).toBeNull();
    expect(await dbCase(id)).toEqual({ state: 'UNDER_SCRUTINY', aggregate_version: 5 });
  });
});

describe('AI decision boundary and ADR-0005 over PostgreSQL', () => {
  it('NEGATIVE: AI cannot final-approve/reject; decision rows record HUMAN officer only', async () => {
    const id = await draft();
    for (const cmd of ['MARK_READY_TO_SUBMIT', 'SUBMIT'] as const) await run(citizen(), id, cmd);
    await run(system(), id, 'MARK_RECEIVED');
    await run(system(), id, 'ENTER_SCRUTINY');
    await run(officer(), id, 'ENTER_DECISION_PENDING');
    await expect(
      run(officer(), id, 'RECORD_APPROVED', { decision: { decision_maker: 'AI' } }),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    await expect(
      run(ctx(T1, 'INTEGRATION', AI_GATEWAY), id, 'RECORD_REJECTED', { decision: HUMAN }),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    expect(await dbCase(id)).toEqual({ state: 'DECISION_PENDING', aggregate_version: 6 });
  });

  it('records the runtime OPA policy_revision per action while the pin graph is unchanged', async () => {
    const id = await draft();
    authorizer.policyRevision = 'authz-bundle-7';
    await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    const rows = await asTenant(h.rt, T1, (c) =>
      c.query(
        'SELECT aggregate_version, authz_policy_revision FROM sf_application_case.case_transition WHERE application_id = $1 ORDER BY aggregate_version',
        [id],
      ),
    );
    expect(rows.rows.map((r) => r['authz_policy_revision'])).toEqual([
      'authz-bundle-1',
      'authz-bundle-7',
    ]);
    const pins = await asTenant(h.rt, T1, (c) =>
      c.query(
        'SELECT tenant_service_binding_id, rule_version_id FROM sf_application_case.application_case WHERE application_id = $1',
        [id],
      ),
    );
    expect(pins.rows[0]).toEqual({ tenant_service_binding_id: TSB_T1, rule_version_id: RULE });
    expect(CANARY).not.toBe(id);
  });
});
