import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  call,
  citizenLogin,
  closeAdmin,
  command,
  createDraft,
  FIXTURE_A,
  FIXTURE_B,
  HOST_A,
  HOST_B,
  officerLogin,
  putWorkingData,
  syntheticForm,
  syntheticMobile,
  type App,
  type CitizenSession,
  type OfficerSession,
  TSB_A,
} from './support/platform.js';

/**
 * SF-M10-B-3 (CCR-M10-003): HUMAN approval → SYSTEM issuance (CMP-022/024) → SIMULATED DigiLocker
 * publish (CMP-012) on the wired path (host → CMP-004 session → OPA → PostgreSQL). Not G6.
 */
describe('post-approval issuance and SIMULATED DigiLocker publish on the platform path', () => {
  let citizen: CitizenSession;
  let other: CitizenSession;
  let officer: OfficerSession;

  async function advance(app: App, token: string, cmd: string, extra = {}): Promise<App> {
    const r = await command(HOST_A(), token, app, cmd, extra);
    expect(r.status, `${cmd} ${JSON.stringify(r.body)}`).toBe(200);
    return r.body['application'] as App;
  }

  async function toDecision(): Promise<App> {
    let app = (await createDraft(HOST_A(), citizen.token, TSB_A())).body['application'] as App;
    expect((await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0)).status).toBe(
      200,
    );
    for (const cmd of ['MARK_READY_TO_SUBMIT', 'SUBMIT'])
      app = await advance(app, citizen.token, cmd);
    for (const cmd of ['MARK_RECEIVED', 'ENTER_SCRUTINY', 'ENTER_DECISION_PENDING']) {
      app = await advance(app, officer.token, cmd);
    }
    return app;
  }

  async function approved(): Promise<App> {
    return advance(await toDecision(), officer.token, 'RECORD_APPROVED', {
      decision: { decision_maker: 'HUMAN' },
    });
  }

  const issuance = (id: string, token: string, method: 'GET' | 'POST' = 'GET') =>
    call(HOST_A(), method, `/v1/applications/${id}/issuance`, {
      token,
      ...(method === 'POST' ? { body: {}, idem: false as const } : {}),
    });

  beforeAll(async () => {
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    other = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
  });
  afterAll(closeAdmin);

  it('APPROVED (HUMAN) → SIGNING_PENDING → ISSUED with a SIMULATED DigiLocker publish', async () => {
    const app = await approved();
    const before = await issuance(app.application_id, citizen.token);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      case_state: 'APPROVED',
      credential: null,
      digilocker: { mode: 'SIMULATED', status: 'NOT_REQUESTED' },
      simulation: true,
      g6_issued: false,
    });

    const run = await issuance(app.application_id, officer.token, 'POST');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body['issuance_error']).toBeUndefined();
    expect(run.body).toMatchObject({
      application_id: app.application_id,
      case_state: 'ISSUED',
      credential: { lifecycle_status: 'ISSUED' },
      digilocker: { mode: 'SIMULATED', status: 'PUBLISHED' },
      g6_issued: false,
    });
    const credential = run.body['credential'] as { credential_id: string };
    const dl = run.body['digilocker'] as {
      publish_request_id: string;
      provider_transaction_ref: string;
    };
    expect(dl.provider_transaction_ref).toMatch(/^sim:/);

    const seen = await issuance(app.application_id, citizen.token);
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual(run.body);

    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: citizen.token,
    });
    const rows = tr.body['transitions'] as {
      transition_id: string;
      transition_key: string;
      actor_type: string;
    }[];
    const by = (k: string) => rows.find((t) => t.transition_key === k);
    expect(by('DECISION_PENDING>APPROVED')?.actor_type).toBe('OFFICER');
    expect(by('APPROVED>SIGNING_PENDING')?.actor_type).toBe('SYSTEM');
    expect(by('SIGNING_PENDING>ISSUED')?.actor_type).toBe('SYSTEM');

    const db = admin();
    const cred = await db.query(
      `SELECT lifecycle_status, approval_decision_ref, actor_type FROM sf_credential.credential
        WHERE application_id = $1`,
      [app.application_id],
    );
    expect(cred.rows).toEqual([
      {
        lifecycle_status: 'ISSUED',
        approval_decision_ref: `cmp015.transition:${by('DECISION_PENDING>APPROVED')?.transition_id}`,
        actor_type: 'SYSTEM',
      },
    ]);
    const reg = await db.query(
      'SELECT current_status FROM sf_credential_registry.credential_registry_entry WHERE credential_id = $1',
      [credential.credential_id],
    );
    expect(reg.rows.map((r) => r.current_status)).toEqual(['REGISTERED']);
    const pub = await db.query(
      `SELECT publish_status, connector_mode, purpose_code, simulation_marker->>'environment' AS env
         FROM sf_digilocker.publish_record WHERE credential_id = $1`,
      [credential.credential_id],
    );
    expect(pub.rows).toEqual([
      {
        publish_status: 'PUBLISHED',
        connector_mode: 'SIMULATED',
        purpose_code: 'SAMPLE_LAB_CREDENTIAL_PUBLISH',
        env: 'LOCAL',
      },
    ]);
    const outcome = await db.query(
      'SELECT channel, outcome, outcome_ref FROM sf_credential.downstream_outcome WHERE credential_id = $1',
      [credential.credential_id],
    );
    expect(outcome.rows).toEqual([
      {
        channel: 'DIGILOCKER_PUBLISH',
        outcome: 'SUCCEEDED',
        outcome_ref: `cmp012.publish:${dl.publish_request_id}`,
      },
    ]);
  });

  it('is idempotent: a repeated run resumes and never re-issues or re-publishes', async () => {
    const app = await approved();
    const first = await issuance(app.application_id, officer.token, 'POST');
    const again = await issuance(app.application_id, officer.token, 'POST');
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const id = (first.body['credential'] as { credential_id: string }).credential_id;
    const counts = await admin().query(
      `SELECT (SELECT count(*) FROM sf_credential.credential WHERE application_id = $1)::int AS c,
              (SELECT count(*) FROM sf_digilocker.publish_record WHERE credential_id = $2)::int AS p`,
      [app.application_id, id],
    );
    expect(counts.rows[0]).toEqual({ c: 1, p: 1 });
  });

  it('only an officer may run it, and only after a recorded approval', async () => {
    const pending = await toDecision();
    expect((await issuance(pending.application_id, officer.token, 'POST')).status).toBe(409);
    const rejected = await advance(pending, officer.token, 'RECORD_REJECTED', {
      decision: { decision_maker: 'HUMAN' },
      reason_code: 'SAMPLE_LAB_REJECT',
    });
    expect((await issuance(rejected.application_id, officer.token, 'POST')).status).toBe(409);
    const none = await issuance(rejected.application_id, citizen.token);
    expect(none.body).toMatchObject({ credential: null, digilocker: { status: 'NOT_REQUESTED' } });

    const app = await approved();
    expect((await issuance(app.application_id, citizen.token, 'POST')).status).toBe(403);
    expect(
      (
        await call(HOST_A(), 'POST', `/v1/applications/${app.application_id}/issuance`, {
          body: {},
          idem: false,
        })
      ).status,
    ).toBe(401);
    const injected = await call(
      HOST_A(),
      'POST',
      `/v1/applications/${app.application_id}/issuance`,
      {
        token: officer.token,
        body: { tenant_id: FIXTURE_B().placement.tenant_id },
        idem: false,
      },
    );
    expect(injected.status).toBe(400);
    const latest = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}`, {
      token: officer.token,
    });
    expect((latest.body['application'] as App).state).toBe('APPROVED');
  });

  it('another citizen cannot read the projection', async () => {
    const app = await approved();
    expect((await issuance(app.application_id, officer.token, 'POST')).status).toBe(200);
    expect([403, 404]).toContain((await issuance(app.application_id, other.token)).status);
  });

  it('portal principals cannot drive or read M07 components directly (role-granted to the workload only)', async () => {
    const app = await approved();
    const run = await issuance(app.application_id, officer.token, 'POST');
    const id = (run.body['credential'] as { credential_id: string }).credential_id;
    for (const token of [citizen.token, officer.token]) {
      const issue = await call(HOST_A(), 'POST', '/v1/credentials', {
        token,
        body: { application_id: app.application_id, issuance_key: 'forged-issuance-key' },
      });
      expect(issue.status).toBe(403);
      const publish = await call(HOST_A(), 'POST', '/v1/digilocker-publish', {
        token,
        body: {
          credential_id: id,
          consent_ref: '0d15ba00-0c30-4000-8000-0d15ba000c30',
          purpose_code: 'SAMPLE_LAB_CREDENTIAL_PUBLISH',
          document_type_ref: 'sample-lab.credential',
        },
      });
      expect(publish.status).toBe(403);
      const read = await call(HOST_A(), 'GET', `/v1/digilocker-publish?credential_id=${id}`, {
        token,
      });
      expect(read.status).toBe(403);
    }
  });

  it('tenant B cannot run or read tenant A issuance', async () => {
    const app = await approved();
    const officerB = await officerLogin(HOST_B(), FIXTURE_B().officer.subject);
    const run = await call(HOST_B(), 'POST', `/v1/applications/${app.application_id}/issuance`, {
      token: officerB.token,
      body: {},
      idem: false,
    });
    expect([403, 404]).toContain(run.status);
    const read = await call(HOST_B(), 'GET', `/v1/applications/${app.application_id}/issuance`, {
      token: officerB.token,
    });
    expect([403, 404]).toContain(read.status);
    const still = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}`, {
      token: officer.token,
    });
    expect((still.body['application'] as App).state).toBe('APPROVED');
  });
});
