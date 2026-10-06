import { beforeEach, describe, expect, it } from 'vitest';
import type { CaseState, TransitionCommand } from '../../src/domain/model.js';
import { Cmp015Error } from '../../src/errors.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/events.js';
import type { TenantRequestContext } from '../../src/domain/validate.js';
import { inDomainTransaction } from '../../src/tx-scope.js';
import {
  AI_GATEWAY,
  CANARY,
  CITIZEN,
  ctx,
  harness,
  HUMAN,
  key,
  OFFICER,
  SYSTEM,
  T1,
  T2,
  TSB_T1,
  TSB_T2,
  type Harness,
} from '../doubles/fixtures.js';
import { MemoryCaseStore } from '../doubles/memory-store.js';

const citizen = () => ctx(T1, 'CITIZEN', CITIZEN);
const officer = () => ctx(T1, 'OFFICER', OFFICER);
const system = () => ctx(T1, 'SYSTEM', SYSTEM);

let store: MemoryCaseStore;
let h: Harness;

beforeEach(() => {
  store = new MemoryCaseStore();
  h = harness(store, () => new Date('2026-10-05T10:00:00.000Z'));
});

async function expectError(
  p: Promise<unknown>,
  code: string,
  detailCode?: string,
): Promise<Cmp015Error> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Cmp015Error);
  const e = err as Cmp015Error;
  expect(e.code).toBe(code);
  if (detailCode) expect(e.details?.map((d) => d.code)).toContain(detailCode);
  return e;
}

async function draft(c: TenantRequestContext = citizen(), tsb = TSB_T1): Promise<string> {
  const res = await h.service.createDraft(c, { tenant_service_binding_id: tsb }, key('draft'));
  return (res.body as { application: { application_id: string } }).application.application_id;
}

function stateOf(id: string): { state: CaseState; version: number } {
  const row = store.state.cases.get(id);
  if (!row) throw new Error('missing');
  return { state: row.state, version: row.aggregate_version };
}

async function run(
  c: TenantRequestContext,
  id: string,
  command: TransitionCommand,
  extra: Record<string, unknown> = {},
) {
  const s = stateOf(id);
  return h.service.executeCommand(
    c,
    id,
    { command, expected_state: s.state, expected_version: s.version, ...extra },
    key(command.toLowerCase().replace(/_/g, '-')),
  );
}

async function toUnderScrutiny(id: string): Promise<void> {
  await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
  await run(citizen(), id, 'SUBMIT');
  await run(system(), id, 'MARK_RECEIVED');
  await run(system(), id, 'ENTER_SCRUTINY');
}

describe('CMP-015 draft creation and version pinning (Constitution #9; SF-CON-VERSION-PINNING)', () => {
  it('creates a DRAFT pinned to the exact published binding with state+outbox+audit atomically', async () => {
    const res = await h.service.createDraft(
      citizen(),
      { tenant_service_binding_id: TSB_T1 },
      key(),
    );
    expect(res.status).toBe(201);
    const body = res.body as {
      application: {
        application_id: string;
        state: string;
        aggregate_version: number;
        pins: Record<string, string>;
      };
      version_pinning: {
        pin_graph: Record<string, string>;
        runtime_authz_policy_revision: string;
        silent_repoint_forbidden: boolean;
      };
    };
    expect(body.application.state).toBe('DRAFT');
    expect(body.application.aggregate_version).toBe(1);
    expect(body.application.pins['tenant_service_binding_id']).toBe(TSB_T1);
    expect(body.version_pinning.runtime_authz_policy_revision).toBe('authz-bundle-1');
    expect(body.version_pinning.silent_repoint_forbidden).toBe(true);
    expect(store.outboxFor(T1, TOPIC_DOMAIN).map((o) => o.envelope.event_type)).toEqual([
      'ApplicationDraftCreated',
    ]);
    expect(store.outboxFor(T1, TOPIC_AUDIT)).toHaveLength(1);
    expect(store.state.transitions[0]?.command).toBe('CREATE_DRAFT');
  });

  it('refuses an unpublished or unknown binding (SF-FORM-001) without writing', async () => {
    await expectError(
      h.service.createDraft(citizen(), { tenant_service_binding_id: TSB_T2 }, key()),
      'SF-FORM-001',
      'BINDING_NOT_PUBLISHED',
    );
    expect(store.state.cases.size).toBe(0);
  });

  it('refuses client-supplied version ids (pins come only from publication)', async () => {
    await expectError(
      h.service.createDraft(
        citizen(),
        { tenant_service_binding_id: TSB_T1, form_version_id: CANARY },
        key(),
      ),
      'SF-SYS-003',
      'UNKNOWN_FIELD',
    );
  });

  it('ADR-0005: records the live policy_revision per action while pins stay identical', async () => {
    const id = await draft();
    h.authorizer.policyRevision = 'authz-bundle-2';
    const res = await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    const body = res.body as {
      application: { pins: Record<string, string> };
      transition: { authz_policy_revision: string };
      command_transition: { authz_policy_revision: string; pin_set: Record<string, string> };
    };
    expect(body.transition.authz_policy_revision).toBe('authz-bundle-2');
    expect(body.command_transition.authz_policy_revision).toBe('authz-bundle-2');
    expect(body.application.pins['tenant_service_binding_id']).toBe(TSB_T1);
    expect(store.state.transitions.map((t) => t.authz_policy_revision)).toEqual([
      'authz-bundle-1',
      'authz-bundle-2',
    ]);
  });

  it('refuses to act on a case whose stored pin graph no longer matches its hash', async () => {
    const id = await draft();
    const row = store.state.cases.get(id);
    if (row) row.pins = { ...row.pins, rule_version_id: CANARY };
    await expectError(
      run(citizen(), id, 'MARK_READY_TO_SUBMIT'),
      'SF-SYS-001',
      'PIN_GRAPH_INTEGRITY',
    );
  });
});

describe('CMP-015 lifecycle (SF-CON-APPLICATION-CASE-SM; SF-CON-COMMAND-TRANSITION)', () => {
  it('drives the golden path DRAFT -> CLOSED with one transition, event and audit per step', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    await run(officer(), id, 'ENTER_VERIFICATION');
    await run(officer(), id, 'ENTER_DECISION_PENDING');
    await run(officer(), id, 'RECORD_APPROVED', { decision: HUMAN, reason_code: 'ELIGIBLE' });
    await run(system(), id, 'ENTER_SIGNING_PENDING');
    await run(system(), id, 'RECORD_ISSUED');
    const closed = await run(system(), id, 'CLOSE');
    expect((closed.body as { application: { state: string } }).application.state).toBe('CLOSED');
    expect(stateOf(id)).toEqual({ state: 'CLOSED', version: 11 });
    expect(store.state.transitions.map((t) => t.to_state)).toEqual([
      'DRAFT',
      'READY_TO_SUBMIT',
      'SUBMITTED',
      'RECEIVED',
      'UNDER_SCRUTINY',
      'VERIFICATION',
      'DECISION_PENDING',
      'APPROVED',
      'SIGNING_PENDING',
      'ISSUED',
      'CLOSED',
    ]);
    expect(store.outboxFor(T1, TOPIC_DOMAIN)).toHaveLength(11);
    expect(store.outboxFor(T1, TOPIC_AUDIT)).toHaveLength(11);
    const approvedAudit = store
      .outboxFor(T1, TOPIC_AUDIT)
      .map((o) => o.envelope.data as { action: string; action_class: string; reason?: string })
      .find((a) => a.action === 'APPLICATION_RECORD_APPROVED');
    expect(approvedAudit).toMatchObject({ action_class: 'DECISION', reason: 'ELIGIBLE' });
    expect(store.state.cases.get(id)?.submitted_at).toBe('2026-10-05T10:00:00.000Z');
  });

  it('commits the domain change before the workflow signal and signals idempotently per version', async () => {
    const id = await draft();
    const res = await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    const body = res.body as {
      workflow_advance: string;
      command_transition: Record<string, unknown>;
    };
    expect(body.workflow_advance).toBe('SIGNALLED');
    expect(body.command_transition).toMatchObject({
      phase: 'TEMPORAL_ADVANCE',
      domain_committed: true,
      temporal_advanced: true,
      open_domain_txn_has_temporal_network: false,
    });
    expect(h.workflow.signals[0]).toMatchObject({
      application_id: id,
      aggregate_version: 2,
      idempotency_key: `${id}:2`,
    });
  });

  it('a failed workflow signal never undoes the committed transition (outbox remains the trigger)', async () => {
    const id = await draft();
    h.workflow.fail = true;
    const res = await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    const body = res.body as {
      workflow_advance: string;
      command_transition: { phase: string; temporal_advanced: boolean };
    };
    expect(body.workflow_advance).toBe('DEFERRED_TO_OUTBOX');
    expect(body.command_transition).toMatchObject({
      phase: 'DOMAIN_COMMITTED',
      temporal_advanced: false,
    });
    expect(stateOf(id).state).toBe('READY_TO_SUBMIT');
  });

  it('NEGATIVE: Temporal advance before domain commit is impossible (commit failure => no signal)', async () => {
    const id = await draft();
    store.hooks.beforeCommit = async () => {
      throw new Cmp015Error('SF-SYS-004');
    };
    await expectError(run(citizen(), id, 'MARK_READY_TO_SUBMIT'), 'SF-SYS-004');
    expect(h.workflow.signals).toHaveLength(0);
    expect(stateOf(id)).toEqual({ state: 'DRAFT', version: 1 });
    expect(store.outboxFor(T1, TOPIC_DOMAIN)).toHaveLength(1);
  });

  it('NEGATIVE: illegal transition rejected with SF-APP-001', async () => {
    const id = await draft();
    await expectError(run(citizen(), id, 'SUBMIT'), 'SF-APP-001', 'ILLEGAL_TRANSITION');
    await expectError(
      run(officer(), id, 'RECORD_APPROVED', { decision: HUMAN }),
      'SF-APP-001',
      'ILLEGAL_TRANSITION',
    );
  });
});

describe('CMP-015 optimistic concurrency and idempotency (AWS v1.7 s13.4)', () => {
  it('NEGATIVE: stale expected_state is rejected and nothing is written', async () => {
    const id = await draft();
    await expectError(
      h.service.executeCommand(
        citizen(),
        id,
        { command: 'MARK_READY_TO_SUBMIT', expected_state: 'READY_TO_SUBMIT', expected_version: 1 },
        key(),
      ),
      'SF-APP-001',
      'STALE_EXPECTED_STATE',
    );
    expect(stateOf(id)).toEqual({ state: 'DRAFT', version: 1 });
  });

  it('NEGATIVE: stale expected_version is rejected', async () => {
    const id = await draft();
    await expectError(
      h.service.executeCommand(
        citizen(),
        id,
        { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 7 },
        key(),
      ),
      'SF-APP-001',
      'STALE_VERSION',
    );
  });

  it('NEGATIVE: a concurrent commit between pre-check and lock is caught inside the transaction', async () => {
    const id = await draft();
    store.hooks.beforeLockCase = (appId, work) => {
      const row = work.cases.get(appId);
      if (row) {
        row.state = 'READY_TO_SUBMIT';
        row.aggregate_version = 2;
      }
    };
    const err = await expectError(run(citizen(), id, 'MARK_READY_TO_SUBMIT'), 'SF-APP-001');
    expect(err.details?.[0]?.code).toMatch(/STALE/);
  });

  it('NEGATIVE: duplicate idempotency key replays the original response without a second write', async () => {
    const id = await draft();
    const body = { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 };
    const k = key('dup');
    const first = await h.service.executeCommand(citizen(), id, body, k);
    const second = await h.service.executeCommand(citizen(), id, body, k);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((second.body as { transition: unknown }).transition).toEqual(
      (first.body as { transition: unknown }).transition,
    );
    expect(store.state.transitions).toHaveLength(2);
    expect(store.outboxFor(T1, TOPIC_DOMAIN)).toHaveLength(2);
    expect(h.workflow.signals).toHaveLength(1);
  });

  it('duplicate draft creation with the same key returns the same application', async () => {
    const k = key('draft-dup');
    const a = await h.service.createDraft(citizen(), { tenant_service_binding_id: TSB_T1 }, k);
    const b = await h.service.createDraft(citizen(), { tenant_service_binding_id: TSB_T1 }, k);
    expect(b.replayed).toBe(true);
    expect(b.body).toEqual(a.body);
    expect(store.state.cases.size).toBe(1);
  });

  it('NEGATIVE: the same key with a different payload is an idempotency conflict (SF-APP-002)', async () => {
    const id = await draft();
    const k = key('conflict');
    await h.service.executeCommand(
      citizen(),
      id,
      { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 },
      k,
    );
    await expectError(
      h.service.executeCommand(
        citizen(),
        id,
        { command: 'SUBMIT', expected_state: 'READY_TO_SUBMIT', expected_version: 2 },
        k,
      ),
      'SF-APP-002',
    );
  });

  it('NEGATIVE: an idempotency key that is missing or malformed is refused', async () => {
    const id = await draft();
    await expectError(
      h.service.executeCommand(
        citizen(),
        id,
        { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 },
        'short',
      ),
      'SF-SYS-003',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });
});

describe('CMP-015 tenant isolation (INT-011; CROSS_TENANT_LEAKAGE=0)', () => {
  it('NEGATIVE: wrong tenant cannot read, list or command another tenant case and sees no data', async () => {
    const id = await draft();
    const intruder = ctx(T2, 'OFFICER', OFFICER);
    for (const op of [
      () => h.service.getApplication(intruder, id),
      () => h.service.listTransitions(intruder, id),
      () =>
        h.service.executeCommand(
          intruder,
          id,
          { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 },
          key(),
        ),
      () => h.service.registerRequest(intruder, id, { kind: 'WITHDRAWAL' }, key()),
    ]) {
      const err = await expectError(op(), 'SF-SYS-002');
      expect(JSON.stringify(err)).not.toContain(id);
    }
    expect(stateOf(id)).toEqual({ state: 'DRAFT', version: 1 });
    expect(store.outboxFor(T2)).toHaveLength(0);
  });

  it('tenant context comes from the server-side RequestContext only', async () => {
    await expectError(
      h.service.createDraft(null, { tenant_service_binding_id: TSB_T1 }, key()),
      'SF-AUTH-001',
    );
    await expectError(
      h.service.createDraft(
        { ...citizen(), tenant_id: null },
        { tenant_service_binding_id: TSB_T1 },
        key(),
      ),
      'SF-TEN-001',
    );
    await expectError(
      h.service.createDraft(
        { ...citizen(), cell_id: 'nope' },
        { tenant_service_binding_id: TSB_T1 },
        key(),
      ),
      'SF-AUTH-001',
    );
  });

  it('every transaction sets the tenant session context of the caller', async () => {
    const id = await draft(ctx(T2, 'CITIZEN', CITIZEN), TSB_T2);
    expect(store.sessions.every((s) => s.tenantId === T2)).toBe(true);
    expect(store.state.cases.get(id)?.tenant_id).toBe(T2);
  });
});

describe('CMP-015 OPA authorization (PEP fails closed)', () => {
  it('NEGATIVE: an OPA deny is SF-AUTH-002, writes nothing to the case, and records a DENIED audit', async () => {
    const id = await draft();
    h.authorizer.denied.add('APPLICATION_SUBMIT');
    await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    await expectError(run(citizen(), id, 'SUBMIT'), 'SF-AUTH-002');
    expect(stateOf(id).state).toBe('READY_TO_SUBMIT');
    const denied = store
      .outboxFor(T1, TOPIC_AUDIT)
      .map((o) => o.envelope.data as { result: string; action: string })
      .filter((a) => a.result === 'DENIED');
    expect(denied).toEqual([expect.objectContaining({ action: 'APPLICATION_SUBMIT' })]);
  });

  it('NEGATIVE: PDP outage is SF-SYS-004 and a malformed decision is SF-AUTH-002', async () => {
    const id = await draft();
    h.authorizer.failWith = new Error('opa down');
    await expectError(run(citizen(), id, 'MARK_READY_TO_SUBMIT'), 'SF-SYS-004', 'PDP_UNAVAILABLE');
    h.authorizer.failWith = null;
    h.authorizer.malformed = true;
    await expectError(run(citizen(), id, 'MARK_READY_TO_SUBMIT'), 'SF-AUTH-002');
  });

  it('sends the case resource attributes to OPA with the command as the action', async () => {
    const id = await draft();
    await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    const last = h.authorizer.inputs.at(-1);
    expect(last?.action).toBe('APPLICATION_MARK_READY_TO_SUBMIT');
    expect(last?.resource).toMatchObject({
      resource_type: 'ApplicationCase',
      tenant_id: T1,
      application_id: id,
      owner_id: CITIZEN,
    });
  });
});

describe('CMP-015 no network I/O inside the domain transaction (Constitution #11)', () => {
  it('NEGATIVE: an outbound port called inside the transaction is refused and the transaction rolls back', async () => {
    const id = await draft();
    store.hooks.onOutbox = async () => {
      expect(inDomainTransaction()).toBe(true);
      await h.service.ports.payment.requestPaymentIntent({
        tenant_id: T1,
        application_id: id,
        fee_policy_version_id: CANARY,
        idempotency_key: 'pay-000001',
      });
    };
    await expectError(
      run(citizen(), id, 'MARK_READY_TO_SUBMIT'),
      'SF-SYS-001',
      'NETWORK_IO_IN_DOMAIN_TX',
    );
    expect(stateOf(id)).toEqual({ state: 'DRAFT', version: 1 });
    expect(h.workflow.signals).toHaveLength(0);
  });

  it.each([
    'authorizer',
    'workflow',
    'notification',
    'digilocker',
    'servicePolicy',
    'bindings',
  ] as const)('NEGATIVE: %s port is refused inside the transaction', async (name) => {
    const id = await draft();
    const calls: Record<typeof name, () => Promise<unknown>> = {
      authorizer: () => h.service.ports.authorizer.decide({} as never),
      workflow: () => h.service.ports.workflow.advance({} as never),
      notification: () => h.service.ports.notification.requestNotification({} as never),
      digilocker: () => h.service.ports.digilocker.requestDocumentPull({} as never),
      servicePolicy: () => h.service.ports.servicePolicy.evaluateTransition({} as never),
      bindings: () => h.service.ports.bindings.resolve({} as never),
    };
    store.hooks.onOutbox = async () => {
      await calls[name]();
    };
    await expectError(
      run(citizen(), id, 'MARK_READY_TO_SUBMIT'),
      'SF-SYS-001',
      'NETWORK_IO_IN_DOMAIN_TX',
    );
  });

  it('ports outside a transaction work normally; M06/M07 ports are unconfigured in M05', async () => {
    await expectError(
      h.service.ports.payment.requestPaymentIntent({
        tenant_id: T1,
        application_id: CANARY,
        fee_policy_version_id: CANARY,
        idempotency_key: 'pay-000002',
      }),
      'SF-SYS-004',
      'PAYMENT_PORT_NOT_CONFIGURED',
    );
    await expectError(
      h.service.ports.notification.requestNotification({
        tenant_id: T1,
        application_id: CANARY,
        template_ref: 'x',
        idempotency_key: 'ntf-000001',
      }),
      'SF-SYS-004',
      'NOTIFICATION_PORT_NOT_CONFIGURED',
    );
    await expectError(
      h.service.ports.digilocker.requestDocumentPull({
        tenant_id: T1,
        application_id: CANARY,
        document_type_code: 'X',
        idempotency_key: 'dgl-000001',
      }),
      'SF-SYS-004',
      'DIGILOCKER_PORT_NOT_CONFIGURED',
    );
  });
});

describe('CMP-015 AI decision boundary (Constitution #20)', () => {
  async function decisionPending(): Promise<string> {
    const id = await draft();
    await toUnderScrutiny(id);
    await run(officer(), id, 'ENTER_DECISION_PENDING');
    return id;
  }

  it('NEGATIVE: AI cannot final-approve or final-reject, whatever the actor', async () => {
    const id = await decisionPending();
    for (const c of [officer(), system(), ctx(T1, 'INTEGRATION', AI_GATEWAY)]) {
      await expectError(
        run(c, id, 'RECORD_APPROVED', { decision: { decision_maker: 'AI' } }),
        'SF-AUTH-002',
        'AI_FINAL_DECISION_FORBIDDEN',
      );
      await expectError(
        run(c, id, 'RECORD_REJECTED', { decision: { decision_maker: 'AI' } }),
        'SF-AUTH-002',
        'AI_FINAL_DECISION_FORBIDDEN',
      );
    }
    expect(stateOf(id).state).toBe('DECISION_PENDING');
  });

  it('NEGATIVE: an INTEGRATION principal (AI Gateway) cannot record a decision even claiming HUMAN', async () => {
    const id = await decisionPending();
    await expectError(
      run(ctx(T1, 'INTEGRATION', AI_GATEWAY), id, 'RECORD_APPROVED', { decision: HUMAN }),
      'SF-AUTH-002',
      'AI_FINAL_DECISION_FORBIDDEN',
    );
  });

  it('NEGATIVE: decisions need an attestation; HUMAN needs an officer; RULES needs SYSTEM + basis', async () => {
    const id = await decisionPending();
    await expectError(
      run(officer(), id, 'RECORD_APPROVED'),
      'SF-SYS-003',
      'DECISION_ATTESTATION_REQUIRED',
    );
    await expectError(
      run(citizen(), id, 'RECORD_APPROVED', { decision: HUMAN }),
      'SF-AUTH-002',
      'HUMAN_OFFICER_DECISION_REQUIRED',
    );
    await expectError(
      run(officer(), id, 'RECORD_REJECTED', { decision: { decision_maker: 'RULES' } }),
      'SF-AUTH-002',
    );
    await expectError(
      run(system(), id, 'RECORD_REJECTED', {
        decision: { decision_maker: 'RULES', basis_ref: 'rule:1', ai_assisted: true },
      }),
      'SF-AUTH-002',
      'AI_FINAL_DECISION_FORBIDDEN',
    );
  });

  it('a human officer may decide with AI assistance; deterministic rules may decide via SYSTEM', async () => {
    const id = await decisionPending();
    const res = await run(officer(), id, 'RECORD_REJECTED', {
      decision: { decision_maker: 'HUMAN', ai_assisted: true },
      reason_code: 'NOT_ELIGIBLE',
    });
    expect((res.body as { application: { state: string } }).application.state).toBe('REJECTED');
    const event = store.outboxFor(T1, TOPIC_DOMAIN).at(-1)?.envelope.data as Record<
      string,
      unknown
    >;
    expect(event).toMatchObject({ decision_maker: 'HUMAN', ai_assisted: true });

    const id2 = await decisionPending();
    const res2 = await run(system(), id2, 'RECORD_APPROVED', {
      decision: { decision_maker: 'RULES', basis_ref: 'rule-eval:42' },
    });
    expect((res2.body as { application: { state: string } }).application.state).toBe('APPROVED');
  });
});

describe('CMP-015 policy-gated withdrawal / cancellation (ADR-0003; Constitution #17)', () => {
  const RULE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  async function request(
    id: string,
    kind: 'WITHDRAWAL' | 'CANCELLATION',
    c = citizen(),
  ): Promise<string> {
    const res = await h.service.registerRequest(
      c,
      id,
      { kind, workflow_ref: 'wf-run-1' },
      key('req'),
    );
    return (res.body as { request: { request_id: string } }).request.request_id;
  }

  async function resolve(
    id: string,
    rid: string,
    status: string,
    expected: string,
    c = officer(),
    decision: unknown = HUMAN,
  ) {
    return h.service.updateRequestStatus(
      c,
      id,
      rid,
      { status, expected_status: expected, decision, reason_code: 'REVIEWED' },
      key('res'),
    );
  }

  it('NEGATIVE: WITHDRAWAL_REQUESTED / CANCELLATION_REQUESTED can never be an application state', async () => {
    const id = await draft();
    for (const s of ['WITHDRAWAL_REQUESTED', 'CANCELLATION_REQUESTED']) {
      await expectError(
        h.service.executeCommand(
          citizen(),
          id,
          { command: 'COMMIT_WITHDRAWAL', expected_state: s, expected_version: 1 },
          key(),
        ),
        'SF-APP-001',
        'REQUEST_CONSTRUCT_IS_NOT_A_STATE',
      );
    }
    await expectError(
      h.service.executeCommand(
        citizen(),
        id,
        { command: 'WITHDRAWAL_REQUESTED', expected_state: 'DRAFT', expected_version: 1 },
        key(),
      ),
      'SF-SYS-003',
      'COMMAND_INVALID',
    );
  });

  it('registering a request never changes the authoritative case state or version', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    const before = stateOf(id);
    const rid = await request(id, 'WITHDRAWAL');
    await resolve(id, rid, 'UNDER_REVIEW', 'SUBMITTED', officer(), undefined);
    expect(stateOf(id)).toEqual(before);
    expect(store.state.requests.get(rid)?.status).toBe('UNDER_REVIEW');
  });

  it('NEGATIVE: WITHDRAWN without a request is rejected', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    h.policy.permit(RULE, 'UNDER_SCRUTINY>WITHDRAWN');
    await expectError(
      run(system(), id, 'COMMIT_WITHDRAWAL'),
      'SF-APP-001',
      'REQUEST_NOT_COMMITTED',
    );
  });

  it('NEGATIVE: WITHDRAWN / CANCELLED with an uncommitted (SUBMITTED / UNDER_REVIEW) request is rejected', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    h.policy.permit(RULE, 'UNDER_SCRUTINY>WITHDRAWN');
    h.policy.permit(RULE, 'UNDER_SCRUTINY>CANCELLED');
    const w = await request(id, 'WITHDRAWAL');
    await expectError(
      run(system(), id, 'COMMIT_WITHDRAWAL', { request_id: w }),
      'SF-APP-001',
      'REQUEST_NOT_COMMITTED',
    );
    const c = await request(id, 'CANCELLATION', officer());
    await resolve(id, c, 'UNDER_REVIEW', 'SUBMITTED', officer(), undefined);
    await expectError(
      run(system(), id, 'COMMIT_CANCELLATION', { request_id: c }),
      'SF-APP-001',
      'REQUEST_NOT_COMMITTED',
    );
    expect(stateOf(id).state).toBe('UNDER_SCRUTINY');
  });

  it('NEGATIVE: a committed request of the other kind cannot be used', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    h.policy.permit(RULE, 'UNDER_SCRUTINY>CANCELLED');
    const w = await request(id, 'WITHDRAWAL');
    await resolve(id, w, 'COMMITTED', 'SUBMITTED');
    await expectError(
      run(system(), id, 'COMMIT_CANCELLATION', { request_id: w }),
      'SF-APP-001',
      'REQUEST_NOT_COMMITTED',
    );
  });

  it('NEGATIVE: committed request but published service policy denies => SF-APP-001, state unchanged', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    const w = await request(id, 'WITHDRAWAL');
    await resolve(id, w, 'COMMITTED', 'SUBMITTED');
    await expectError(
      run(system(), id, 'COMMIT_WITHDRAWAL', { request_id: w }),
      'SF-APP-001',
      'SERVICE_POLICY_DENIED',
    );
    expect(stateOf(id).state).toBe('UNDER_SCRUTINY');
  });

  it('commits WITHDRAWN only with a committed request + permitting policy, consuming the request once', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    h.policy.permit(RULE, 'UNDER_SCRUTINY>WITHDRAWN');
    const w = await request(id, 'WITHDRAWAL');
    await resolve(id, w, 'UNDER_REVIEW', 'SUBMITTED', officer(), undefined);
    await resolve(id, w, 'COMMITTED', 'UNDER_REVIEW');
    const res = await run(system(), id, 'COMMIT_WITHDRAWAL', {
      request_id: w,
      reason_code: 'CITIZEN_WITHDREW',
    });
    const body = res.body as {
      application: { state: string };
      transition: { request_id: string; transition_class: string; policy_ref: string };
    };
    expect(body.application.state).toBe('WITHDRAWN');
    expect(body.transition).toMatchObject({
      request_id: w,
      transition_class: 'POLICY_GATED_WITHDRAWAL',
      policy_ref: `simulated:${RULE}`,
    });
    expect(store.state.requests.get(w)?.consumed_at_version).toBe(6);
    const audit = store.outboxFor(T1, TOPIC_AUDIT).at(-1)?.envelope.data as {
      action_class: string;
      reason: string;
    };
    expect(audit).toMatchObject({ action_class: 'DECISION', reason: 'CITIZEN_WITHDREW' });
  });

  it('commits CANCELLED from PAYMENT_PENDING with a committed cancellation request', async () => {
    const id = await draft();
    await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    await run(citizen(), id, 'SUBMIT');
    await run(system(), id, 'ENTER_PAYMENT_PENDING');
    h.policy.permit(RULE, 'PAYMENT_PENDING>CANCELLED');
    const c = await request(id, 'CANCELLATION', system());
    await resolve(id, c, 'COMMITTED', 'SUBMITTED', system(), {
      decision_maker: 'RULES',
      basis_ref: 'payment-timeout-rule',
    });
    const res = await run(system(), id, 'COMMIT_CANCELLATION', { request_id: c });
    expect((res.body as { application: { state: string } }).application.state).toBe('CANCELLED');
  });

  it('a rejected or expired request leaves the case state unchanged and cannot be committed', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    h.policy.permit(RULE, 'UNDER_SCRUTINY>WITHDRAWN');
    const w = await request(id, 'WITHDRAWAL');
    await resolve(id, w, 'REJECTED', 'SUBMITTED');
    expect(stateOf(id).state).toBe('UNDER_SCRUTINY');
    await expectError(
      run(system(), id, 'COMMIT_WITHDRAWAL', { request_id: w }),
      'SF-APP-001',
      'REQUEST_NOT_COMMITTED',
    );
    const w2 = await request(id, 'WITHDRAWAL');
    await resolve(id, w2, 'EXPIRED', 'SUBMITTED', system(), undefined);
    await expectError(
      resolve(id, w2, 'COMMITTED', 'EXPIRED'),
      'SF-APP-001',
      'ILLEGAL_REQUEST_STATUS_CHANGE',
    );
  });

  it('NEGATIVE: AI cannot approve or reject a withdrawal request (ADR-0003)', async () => {
    const id = await draft();
    await toUnderScrutiny(id);
    const w = await request(id, 'WITHDRAWAL');
    await expectError(
      resolve(id, w, 'COMMITTED', 'SUBMITTED', officer(), { decision_maker: 'AI' }),
      'SF-AUTH-002',
      'AI_FINAL_DECISION_FORBIDDEN',
    );
    await expectError(
      resolve(id, w, 'REJECTED', 'SUBMITTED', ctx(T1, 'INTEGRATION', AI_GATEWAY), HUMAN),
      'SF-AUTH-002',
      'AI_FINAL_DECISION_FORBIDDEN',
    );
  });

  it('NEGATIVE: requests are refused where no WITHDRAWN/CANCELLED transition exists, and stale status is refused', async () => {
    const id = await draft();
    await expectError(
      h.service.registerRequest(citizen(), id, { kind: 'CANCELLATION' }, key()),
      'SF-APP-001',
      'REQUEST_NOT_AVAILABLE_IN_STATE',
    );
    const w = await request(id, 'WITHDRAWAL');
    await expectError(
      resolve(id, w, 'COMMITTED', 'UNDER_REVIEW'),
      'SF-APP-001',
      'STALE_REQUEST_STATUS',
    );
    await expectError(
      h.service.registerRequest(citizen(), id, { kind: 'WITHDRAWAL' }, key()),
      'SF-APP-002',
    );
  });

  it('validates request payloads', async () => {
    const id = await draft();
    await expectError(
      h.service.registerRequest(citizen(), id, { kind: 'WITHDRAWAL_REQUESTED' }, key()),
      'SF-SYS-003',
      'REQUEST_KIND_INVALID',
    );
    await expectError(
      h.service.registerRequest(citizen(), id, { kind: 'WITHDRAWAL', workflow_ref: '' }, key()),
      'SF-SYS-003',
      'WORKFLOW_REF_INVALID',
    );
    const w = await request(id, 'WITHDRAWAL');
    await expectError(
      resolve(id, w, 'SUBMITTED', 'SUBMITTED'),
      'SF-SYS-003',
      'REQUEST_STATUS_INVALID',
    );
    await expectError(
      resolve(id, w, 'UNDER_REVIEW', 'NOPE'),
      'SF-SYS-003',
      'EXPECTED_STATUS_INVALID',
    );
    await expectError(resolve(id, CANARY, 'UNDER_REVIEW', 'SUBMITTED'), 'SF-SYS-002');
    const replay = await h.service.updateRequestStatus(
      officer(),
      id,
      w,
      { status: 'UNDER_REVIEW', expected_status: 'SUBMITTED' },
      'fixed-key-0001',
    );
    const again = await h.service.updateRequestStatus(
      officer(),
      id,
      w,
      { status: 'UNDER_REVIEW', expected_status: 'SUBMITTED' },
      'fixed-key-0001',
    );
    expect(again.replayed).toBe(true);
    expect(again.body).toEqual(replay.body);
  });
});

describe('CMP-015 reads', () => {
  it('returns the case and its transition history without tenant or actor identifiers', async () => {
    const id = await draft();
    await run(citizen(), id, 'MARK_READY_TO_SUBMIT');
    const got = await h.service.getApplication(citizen(), id);
    expect((got.body as { application: { state: string } }).application.state).toBe(
      'READY_TO_SUBMIT',
    );
    const list = await h.service.listTransitions(officer(), id);
    const transitions = (list.body as { transitions: Record<string, unknown>[] }).transitions;
    expect(transitions.map((t) => t['to_state'])).toEqual(['DRAFT', 'READY_TO_SUBMIT']);
    expect(transitions.every((t) => !('tenant_id' in t) && !('actor_id' in t))).toBe(true);
    await expectError(h.service.getApplication(citizen(), CANARY), 'SF-SYS-002');
    await expectError(h.service.listTransitions(citizen(), CANARY), 'SF-SYS-002');
    await expectError(
      h.service.getApplication(citizen(), 'not-a-uuid'),
      'SF-SYS-003',
      'ID_INVALID',
    );
  });
});
