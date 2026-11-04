import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  citizenLogin,
  closeAdmin,
  command,
  createDraft,
  FIXTURE_A,
  HOST_A,
  key,
  officerLogin,
  putWorkingData,
  syntheticForm,
  syntheticMobile,
  type App,
  type CitizenSession,
  type OfficerSession,
  TSB_A,
} from './support/platform.js';

/** Full CMP-015 journey on the wired path (host → CMP-004 session → OPA → PostgreSQL). */
describe('journey state machine on the platform path', () => {
  let citizen: CitizenSession;
  let officer: OfficerSession;
  const tsb = () => TSB_A();

  async function submitted(): Promise<App> {
    let app = (await createDraft(HOST_A(), citizen.token, tsb())).body['application'] as App;
    expect((await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0)).status).toBe(
      200,
    );
    for (const cmd of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
      const r = await command(HOST_A(), citizen.token, app, cmd);
      expect(r.status, cmd).toBe(200);
      app = r.body['application'] as App;
    }
    return app;
  }

  async function step(
    app: App,
    token: string,
    cmd: string,
    to: string,
    extra: Record<string, unknown> = {},
  ): Promise<App> {
    const r = await command(HOST_A(), token, app, cmd, extra);
    expect(r.status, `${app.state} -${cmd}-> ${JSON.stringify(r.body)}`).toBe(200);
    const next = r.body['application'] as App;
    expect(next.state).toBe(to);
    expect(next.aggregate_version).toBe(app.aggregate_version + 1);
    return next;
  }

  beforeAll(async () => {
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
  });
  afterAll(closeAdmin);

  it('draft → ready → submitted → received → scrutiny → decision_pending → approved', async () => {
    let app = await submitted();
    expect(app.state).toBe('SUBMITTED');
    expect(app['submitted_at']).toBeTruthy();
    app = await step(app, officer.token, 'MARK_RECEIVED', 'RECEIVED');
    app = await step(app, officer.token, 'ENTER_SCRUTINY', 'UNDER_SCRUTINY');
    app = await step(app, officer.token, 'ENTER_DECISION_PENDING', 'DECISION_PENDING');
    app = await step(app, officer.token, 'RECORD_APPROVED', 'APPROVED', {
      decision: { decision_maker: 'HUMAN' },
    });
    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: citizen.token,
    });
    expect(tr.status).toBe(200);
    const keys = (tr.body['transitions'] as { transition_key: string | null }[]).map(
      (t) => t.transition_key,
    );
    expect(keys).toEqual([
      null,
      'DRAFT>READY_TO_SUBMIT',
      'READY_TO_SUBMIT>SUBMITTED',
      'SUBMITTED>RECEIVED',
      'RECEIVED>UNDER_SCRUTINY',
      'UNDER_SCRUTINY>DECISION_PENDING',
      'DECISION_PENDING>APPROVED',
    ]);
    for (const t of tr.body['transitions'] as { authz_policy_revision: string }[]) {
      expect(t.authz_policy_revision).toBe('m10-b1');
    }
    const late = await command(HOST_A(), officer.token, app, 'RECORD_REJECTED', {
      decision: { decision_maker: 'HUMAN' },
      reason_code: 'LATE',
    });
    expect(late.status).toBe(409);
  });

  it('… → decision_pending → rejected → closed', async () => {
    let app = await submitted();
    app = await step(app, officer.token, 'MARK_RECEIVED', 'RECEIVED');
    app = await step(app, officer.token, 'ENTER_SCRUTINY', 'UNDER_SCRUTINY');
    app = await step(app, officer.token, 'ENTER_DECISION_PENDING', 'DECISION_PENDING');
    app = await step(app, officer.token, 'RECORD_REJECTED', 'REJECTED', {
      decision: { decision_maker: 'HUMAN' },
      reason_code: 'SAMPLE_LAB_REJECT',
    });
    await step(app, officer.token, 'CLOSE', 'CLOSED');
  });

  it('deficiency loop: officer raises, citizen edits working data and responds, scrutiny resumes', async () => {
    let app = await submitted();
    app = await step(app, officer.token, 'MARK_RECEIVED', 'RECEIVED');
    app = await step(app, officer.token, 'ENTER_SCRUTINY', 'UNDER_SCRUTINY');
    app = await step(app, officer.token, 'RAISE_DEFICIENCY', 'DEFICIENCY_RAISED', {
      reason_code: 'SAMPLE_LAB_DEFICIENCY',
    });
    const wd = await putWorkingData(
      HOST_A(),
      citizen.token,
      app,
      { ...syntheticForm(), residence_duration_months: 40 },
      1,
    );
    expect(wd.status).toBe(200);
    app = await step(app, citizen.token, 'RECORD_CITIZEN_RESPONSE', 'CITIZEN_RESPONSE');
    app = await step(app, officer.token, 'ENTER_SCRUTINY', 'UNDER_SCRUTINY');
  });

  it('illegal transitions and wrong actors are refused', async () => {
    const draft = (await createDraft(HOST_A(), citizen.token, tsb())).body['application'] as App;
    expect((await command(HOST_A(), citizen.token, draft, 'SUBMIT')).status).toBe(409);
    expect((await command(HOST_A(), citizen.token, draft, 'CLOSE')).status).toBe(403);

    const app = await submitted();
    const cases: [string, string, Record<string, unknown>, number[]][] = [
      [officer.token, 'RECORD_APPROVED', { decision: { decision_maker: 'HUMAN' } }, [409]],
      [officer.token, 'ENTER_SCRUTINY', {}, [409]],
      [citizen.token, 'RETURN_TO_DRAFT', {}, [409]],
      [citizen.token, 'MARK_RECEIVED', {}, [403]],
      [citizen.token, 'RECORD_APPROVED', { decision: { decision_maker: 'HUMAN' } }, [403, 409]],
      [officer.token, 'SUBMIT', {}, [403, 409]],
    ];
    for (const [token, cmd, extra, codes] of cases) {
      const r = await command(HOST_A(), token, app, cmd, extra);
      expect(codes, `${cmd} -> ${r.status} ${JSON.stringify(r.body)}`).toContain(r.status);
    }
    const ai = await command(HOST_A(), officer.token, app, 'MARK_RECEIVED', {
      decision: { decision_maker: 'AI' },
    });
    expect(ai.status).toBeGreaterThanOrEqual(400);
    const officerWd = await putWorkingData(HOST_A(), officer.token, app, syntheticForm(), 1);
    expect([403, 409]).toContain(officerWd.status);
    const afterSubmit = await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 1);
    expect(afterSubmit.status).toBe(409);
    const get = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}`, {
      token: citizen.token,
    });
    expect((get.body['application'] as App).state).toBe('SUBMITTED');
  });

  it('stale expected_version / expected_state / expected_revision are refused', async () => {
    const app = await submitted();
    expect(
      (
        await command(
          HOST_A(),
          officer.token,
          { ...app, aggregate_version: app.aggregate_version - 1 },
          'MARK_RECEIVED',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await command(
          HOST_A(),
          officer.token,
          { ...app, aggregate_version: app.aggregate_version + 5 },
          'MARK_RECEIVED',
        )
      ).status,
    ).toBe(409);
    expect(
      (await command(HOST_A(), officer.token, { ...app, state: 'RECEIVED' }, 'ENTER_SCRUTINY'))
        .status,
    ).toBe(409);

    const draft = (await createDraft(HOST_A(), citizen.token, tsb())).body['application'] as App;
    expect((await putWorkingData(HOST_A(), citizen.token, draft, syntheticForm(), 0)).status).toBe(
      200,
    );
    const stale = await putWorkingData(HOST_A(), citizen.token, draft, syntheticForm(), 0);
    expect(stale.status).toBe(409);
    expect(JSON.stringify(stale.body)).toContain('STALE_REVISION');
    const wrongForm = await call(
      HOST_A(),
      'PUT',
      `/v1/applications/${draft.application_id}/working-data`,
      {
        token: citizen.token,
        body: {
          form_version_id: '00000000-0000-4000-8000-000000000000',
          data: syntheticForm(),
          expected_revision: 1,
        },
      },
    );
    expect(wrongForm.status).toBeGreaterThanOrEqual(400);
    expect(wrongForm.status).toBeLessThan(500);
  });

  it('idempotent replays return Idempotent-Replayed with the original body; key reuse with a different body is refused', async () => {
    const createKey = key();
    const c1 = await call(HOST_A(), 'POST', '/v1/applications', {
      token: citizen.token,
      idem: createKey,
      body: { tenant_service_binding_id: tsb() },
    });
    const c2 = await call(HOST_A(), 'POST', '/v1/applications', {
      token: citizen.token,
      idem: createKey,
      body: { tenant_service_binding_id: tsb() },
    });
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(201);
    expect(c1.headers.get('idempotent-replayed')).toBeNull();
    expect(c2.headers.get('idempotent-replayed')).toBe('true');
    expect((c2.body['application'] as App).application_id).toBe(
      (c1.body['application'] as App).application_id,
    );
    let app = c1.body['application'] as App;

    const wdKey = key();
    const wdBody = {
      form_version_id: app.pins['form_version_id'],
      data: syntheticForm(),
      expected_revision: 0,
    };
    const path = `/v1/applications/${app.application_id}/working-data`;
    const w1 = await call(HOST_A(), 'PUT', path, {
      token: citizen.token,
      idem: wdKey,
      body: wdBody,
    });
    const w2 = await call(HOST_A(), 'PUT', path, {
      token: citizen.token,
      idem: wdKey,
      body: wdBody,
    });
    expect(w1.status).toBe(200);
    expect(w2.status).toBe(200);
    expect(w2.headers.get('idempotent-replayed')).toBe('true');

    const cmdKey = key();
    const r1 = await command(HOST_A(), citizen.token, app, 'MARK_READY_TO_SUBMIT', {}, cmdKey);
    const r2 = await command(HOST_A(), citizen.token, app, 'MARK_READY_TO_SUBMIT', {}, cmdKey);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.headers.get('idempotent-replayed')).toBe('true');
    expect((r2.body['transition'] as { transition_id: string }).transition_id).toBe(
      (r1.body['transition'] as { transition_id: string }).transition_id,
    );
    expect(r2.body['workflow_advance']).toBeUndefined();
    app = r1.body['application'] as App;

    const reuse = await command(HOST_A(), citizen.token, app, 'SUBMIT', {}, cmdKey);
    expect(reuse.status).toBe(409);
    const otherActor = await command(
      HOST_A(),
      officer.token,
      app,
      'MARK_READY_TO_SUBMIT',
      {},
      cmdKey,
    );
    expect(otherActor.headers.get('idempotent-replayed')).toBeNull();
    expect(otherActor.status).toBeGreaterThanOrEqual(400);

    const missing = await call(
      HOST_A(),
      'POST',
      `/v1/applications/${app.application_id}/commands`,
      {
        token: citizen.token,
        idem: false,
        body: {
          command: 'SUBMIT',
          expected_state: app.state,
          expected_version: app.aggregate_version,
        },
      },
    );
    expect(missing.status).toBe(400);
  });

  it("another citizen reusing an idempotency key never receives the first citizen's replay", async () => {
    const shared = key();
    const first = await call(HOST_A(), 'POST', '/v1/applications', {
      token: citizen.token,
      idem: shared,
      body: { tenant_service_binding_id: tsb() },
    });
    expect(first.status).toBe(201);
    const other = await citizenLogin(HOST_A(), syntheticMobile());
    const second = await call(HOST_A(), 'POST', '/v1/applications', {
      token: other.token,
      idem: shared,
      body: { tenant_service_binding_id: tsb() },
    });
    expect(second.headers.get('idempotent-replayed')).toBeNull();
    const leaked = second.body['application'] as App | undefined;
    if (leaked) {
      expect(leaked.application_id).not.toBe((first.body['application'] as App).application_id);
    }
  });

  it('concurrent commands on the same expected_version: exactly one wins', async () => {
    const app = await submitted();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => command(HOST_A(), officer.token, app, 'MARK_RECEIVED')),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c !== 200).every((c) => c === 409)).toBe(true);
    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: officer.token,
    });
    expect((tr.body['transitions'] as unknown[]).length).toBe(app.aggregate_version + 1);
  });
});
