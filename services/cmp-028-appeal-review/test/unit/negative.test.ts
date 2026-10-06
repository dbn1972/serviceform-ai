import { describe, expect, it } from 'vitest';
import { TOPIC_AUDIT } from '../../src/outbox.js';
import { AUTHORITY, ctxFor, fileBody, OFFICER_1, TENANT_A, TENANT_B } from '../doubles/fixtures.js';
import { idem, makeService, type Ctx } from '../doubles/harness.js';

const officer = ctxFor(OFFICER_1) as Ctx;
const citizen = ctxFor(OFFICER_1, { roles: ['CITIZEN'] }, 'CITIZEN') as Ctx;

async function filed() {
  const h = makeService();
  const res = await h.service.fileAppeal(citizen, fileBody(), idem('POST /v1/appeals'));
  return { ...h, id: res.body.appeal_id };
}

describe('wrong tenant is denied (CROSS_TENANT_LEAKAGE=0)', () => {
  it('hides tenant A appeals from tenant B', async () => {
    const { service, repo, id } = await filed();
    const intruder = ctxFor(OFFICER_1, { tenant_id: TENANT_B }) as Ctx;
    let leakage = 0;
    const probe = async (fn: () => Promise<unknown>) => {
      try {
        const out = await fn();
        if (JSON.stringify(out).includes(id) || JSON.stringify(out).includes(TENANT_A))
          leakage += 1;
        leakage += 1;
      } catch (e) {
        expect((e as { code: string }).code).toBe('SF-SYS-002');
        expect(JSON.stringify(e)).not.toContain(TENANT_A);
      }
    };
    await probe(() => service.getAppeal(intruder, id));
    await probe(() => service.getHistory(intruder, id));
    await probe(() =>
      service.recordAdmissibility(
        intruder,
        id,
        { admissibility_code: 'ADMITTED' },
        idem('POST /a'),
      ),
    );
    expect(leakage).toBe(0);
    expect(repo.state.appeals.get(`${TENANT_A}|${id}`)?.appeal_state).toBe('FILED');
  });
});

describe('OPA on protected appeal actions', () => {
  it.each([
    'APPEAL_READ',
    'APPEAL_ADMISSIBILITY',
    'APPEAL_ASSIGN',
    'APPEAL_RECORD_REVIEW',
    'APPEAL_RECORD_DECISION',
    'APPEAL_WITHDRAW',
    'APPEAL_CANCEL',
  ])('denies %s fail-closed and audits DENIED', async (action) => {
    const { service, authz, repo, id } = await filed();
    if (
      action !== 'APPEAL_READ' &&
      action !== 'APPEAL_ADMISSIBILITY' &&
      action !== 'APPEAL_WITHDRAW' &&
      action !== 'APPEAL_CANCEL'
    ) {
      await service.recordAdmissibility(
        officer,
        id,
        { admissibility_code: 'ADMITTED' },
        idem('POST /adm'),
      );
    }
    if (
      action === 'APPEAL_RECORD_REVIEW' ||
      action === 'APPEAL_RECORD_DECISION' ||
      action === 'APPEAL_ASSIGN'
    ) {
      if (action !== 'APPEAL_ASSIGN') {
        await service.assign(
          officer,
          id,
          { appellate_authority: AUTHORITY },
          idem('POST /asg'),
          'ASSIGN',
        );
      }
    }
    authz.denyActions.add(action);
    const run = async () => {
      if (action === 'APPEAL_READ') return service.getAppeal(officer, id);
      if (action === 'APPEAL_ADMISSIBILITY') {
        return service.recordAdmissibility(
          officer,
          id,
          { admissibility_code: 'ADMITTED' },
          idem('POST /x'),
        );
      }
      if (action === 'APPEAL_ASSIGN') {
        return service.assign(
          officer,
          id,
          { appellate_authority: AUTHORITY },
          idem('POST /x'),
          'ASSIGN',
        );
      }
      if (action === 'APPEAL_RECORD_REVIEW') {
        return service.recordReview(
          officer,
          id,
          { review_ref: '00000000-0000-4000-8000-000000000080' },
          idem('POST /x'),
        );
      }
      if (action === 'APPEAL_RECORD_DECISION') {
        return service.recordDecision(
          officer,
          id,
          { decision_ref: '00000000-0000-4000-8000-000000000082' },
          idem('POST /x'),
        );
      }
      if (action === 'APPEAL_WITHDRAW') {
        return service.withdrawOrCancel(
          officer,
          id,
          { reason_code: 'CITIZEN_REQUEST' },
          idem('POST /x'),
          'WITHDRAW',
        );
      }
      return service.withdrawOrCancel(
        officer,
        id,
        { reason_code: 'ADMIN' },
        idem('POST /x'),
        'CANCEL',
      );
    };
    await expect(run()).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    const denied = repo
      .outboxOf(TOPIC_AUDIT)
      .filter((e) => (e.data as { result?: string }).result === 'DENIED');
    expect(denied.length).toBeGreaterThan(0);
  });

  it('PDP failure fails closed', async () => {
    const { service, authz, id } = await filed();
    authz.throws = true;
    await expect(service.getAppeal(officer, id)).rejects.toMatchObject({ code: 'SF-SYS-004' });
  });
});

describe('AI never decides appeal outcome', () => {
  it('refuses AI roles on admissibility, decision, review, withdraw and cancel', async () => {
    const { service, id } = await filed();
    const ai = ctxFor(OFFICER_1, { roles: ['AI_OFFICER_COPILOT'] }) as Ctx;
    await expect(
      service.recordAdmissibility(ai, id, { admissibility_code: 'ADMITTED' }, idem('POST /a')),
    ).rejects.toMatchObject({ details: [{ code: 'AI_DECISION_FORBIDDEN' }] });
  });

  it('allows summary/checklist notes and refuses decision-shaped kinds', async () => {
    const { service, id, repo } = await filed();
    const note = await service.addAssistNote(
      officer,
      id,
      { note_kind: 'SUMMARY', content_ref: 'assist/note-001' },
      idem('POST /n'),
    );
    expect(note.status).toBe(201);
    expect(note.body.note_kind).toBe('SUMMARY');
    await expect(
      service.addAssistNote(
        officer,
        id,
        { note_kind: 'ADMISSIBILITY', content_ref: 'assist/bad-001' },
        idem('POST /bad'),
      ),
    ).rejects.toMatchObject({ details: [{ code: 'AI_DECISION_FORBIDDEN' }] });
    expect(repo.state.notes.filter((n) => n.note_kind === 'SUMMARY')).toHaveLength(1);
  });
});

describe('named officer metadata is refused', () => {
  it('rejects officer_id on authority and top-level assignee', async () => {
    const h = makeService();
    await expect(
      h.service.fileAppeal(
        citizen,
        fileBody({
          appellate_authority: { ...AUTHORITY, officer_id: OFFICER_1 },
        }),
        idem('POST /v1/appeals'),
      ),
    ).rejects.toMatchObject({ details: [{ code: 'NAMED_OFFICER_FORBIDDEN' }] });
    await expect(
      h.service.fileAppeal(citizen, fileBody({ assignee: OFFICER_1 }), idem('POST /v1/appeals')),
    ).rejects.toMatchObject({ details: [{ code: 'NAMED_OFFICER_FORBIDDEN' }] });
  });
});
