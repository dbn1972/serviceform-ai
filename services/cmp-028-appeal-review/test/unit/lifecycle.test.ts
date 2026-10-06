import { describe, expect, it } from 'vitest';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import { inDomainTransaction } from '../../src/tx-scope.js';
import {
  APP_1,
  AUTHORITY,
  CITIZEN_1,
  ctxFor,
  DECISION_1,
  fileBody,
  OFFICER_1,
  ORG_2,
  uuid,
  WF_VERSION,
} from '../doubles/fixtures.js';
import { idem, makeService, type Ctx } from '../doubles/harness.js';

const officer = ctxFor(OFFICER_1) as Ctx;
const citizen = ctxFor(CITIZEN_1, { roles: ['CITIZEN'] }, 'CITIZEN') as Ctx;

async function filed() {
  const h = makeService();
  const res = await h.service.fileAppeal(citizen, fileBody(), idem('POST /v1/appeals'));
  return { ...h, id: res.body.appeal_id };
}

describe('appeal lifecycle', () => {
  it('files, records admissibility, assigns, review, hearing, decision, and emits outbox+audit', async () => {
    const { service, repo, id } = await filed();
    expect((await service.getAppeal(officer, id)).appeal_state).toBe('FILED');
    expect((await service.getAppeal(officer, id)).original_decision_id).toBe(DECISION_1);

    await service.recordAdmissibility(
      officer,
      id,
      { admissibility_code: 'ADMITTED', reason_code: 'WITHIN_LIMITATION' },
      idem('POST /adm'),
    );
    await service.assign(
      officer,
      id,
      { appellate_authority: { ...AUTHORITY, organisation_id: ORG_2 } },
      idem('POST /asg'),
      'ASSIGN',
    );
    await service.recordReview(officer, id, { review_ref: uuid(80) }, idem('POST /rev'));
    await service.recordHearing(officer, id, { hearing_ref: uuid(81) }, idem('POST /hear'));
    const decided = await service.recordDecision(
      officer,
      id,
      { decision_ref: uuid(82) },
      idem('POST /dec'),
    );
    expect(decided.body.appeal_state).toBe('DECISION_REFERENCED');
    expect(decided.body.decision_ref).toBe(uuid(82));

    const hist = await service.getHistory(officer, id);
    expect(hist.items.map((i) => i.operation)).toEqual([
      'FILE',
      'RECORD_ADMISSIBILITY',
      'ASSIGN',
      'RECORD_REVIEW',
      'RECORD_HEARING',
      'RECORD_DECISION',
    ]);
    expect(hist.items.every((i) => i.policy_revision === 'rev-1')).toBe(true);
    expect(repo.outboxOf(TOPIC_DOMAIN).map((e) => e.event_type)).toContain('AppealFiled');
    expect(repo.outboxOf(TOPIC_AUDIT).length).toBeGreaterThan(0);
  });

  it('withdraws a filed appeal and refuses later mutation', async () => {
    const { service, id } = await filed();
    await service.withdrawOrCancel(
      officer,
      id,
      { reason_code: 'CITIZEN_REQUEST' },
      idem('POST /w'),
      'WITHDRAW',
    );
    await expect(
      service.recordAdmissibility(officer, id, { admissibility_code: 'ADMITTED' }, idem('POST /a')),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
  });

  it('is idempotent on file', async () => {
    const h = makeService();
    const key = idem('POST /v1/appeals', fileBody(), 'same-key-01');
    const a = await h.service.fileAppeal(citizen, fileBody(), key);
    const b = await h.service.fileAppeal(citizen, fileBody(), key);
    expect(b.body.appeal_id).toBe(a.body.appeal_id);
    expect(b.status).toBe(201);
  });
});

describe('original case is never rewritten except via CMP-015 command port', () => {
  it('records opaque original ids and only mutates a fake case map through the port after commit', async () => {
    const h = makeService();
    const res = await h.service.fileAppeal(
      citizen,
      fileBody({
        original_case_command: {
          command_type: 'ENTER_DECISION_PENDING',
          expected_state: 'REJECTED',
        },
      }),
      idem('POST /v1/appeals'),
    );
    expect(res.body.original_application_id).toBe(APP_1);
    expect(h.caseCommands.calls).toHaveLength(1);
    expect(h.caseCommands.calls[0]?.inTxn).toBe(false);
    expect(h.caseCommands.calls[0]?.command_type).toBe('ENTER_DECISION_PENDING');
    expect(h.caseCommands.cases.get(APP_1)?.state).toBe('ENTER_DECISION_PENDING');
    expect(inDomainTransaction()).toBe(false);
  });

  it('refuses CMP-015 port calls while a domain transaction is open', async () => {
    const { caseCommands } = makeService();
    const { runInDomainTransaction } = await import('../../src/tx-scope.js');
    const { guardOutboundPort } = await import('../../src/tx-scope.js');
    const guarded = guardOutboundPort('cmp-015-command', caseCommands);
    await expect(
      (async () =>
        runInDomainTransaction(() =>
          guarded.apply(officer, {
            application_id: APP_1,
            command_type: 'RECORD_APPROVED',
            expected_state: 'DECISION_PENDING',
            idempotency_key: 'port-in-txn1',
            appeal_id: uuid(9),
          }),
        ))(),
    ).rejects.toMatchObject({ details: [{ code: 'NETWORK_IO_IN_DOMAIN_TX' }] });
    expect(caseCommands.cases.size).toBe(0);
  });
});

describe('workflow is a port, not a second BPMN runtime', () => {
  it('links a workflow instance after OPA and outside the prior file transaction', async () => {
    const { service, workflow, id } = await filed();
    const linked = await service.linkWorkflow(
      officer,
      id,
      { workflow_version_id: WF_VERSION },
      idem('POST /wf'),
    );
    expect(linked.body.workflow_version_id).toBe(WF_VERSION);
    expect(linked.body.workflow_instance_id).toBeTruthy();
    expect(workflow.calls[0]?.inTxn).toBe(false);
  });
});
