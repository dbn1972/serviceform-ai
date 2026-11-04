import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  AUDIT_EVENT,
  call,
  check,
  citizenLogin,
  closeAdmin,
  command,
  createDraft,
  EVENT_ENVELOPE,
  FIXTURE_A,
  HOST_A,
  key,
  officerLogin,
  outboxFor,
  putWorkingData,
  syntheticForm,
  syntheticMobile,
  type App,
  type CitizenSession,
  type OfficerSession,
  must,
  TSB_A,
} from './support/platform.js';

/**
 * INT-004: every CMP-015 command and working-data write commits its domain event and audit row in
 * the same transaction as the state change. Fault injection uses a test-only trigger (schema
 * sf_int_fault, created and dropped here) that fails the outbox insert for one application.
 */

const DOMAIN = 'sf.application-case.events.v1';
const AUDIT = 'sf.audit.ingest.v1';

async function installFault(): Promise<void> {
  await admin().query(`
    CREATE SCHEMA IF NOT EXISTS sf_int_fault;
    CREATE TABLE IF NOT EXISTS sf_int_fault.target (application_id text NOT NULL, event_type text);
    CREATE OR REPLACE FUNCTION sf_int_fault.raise_on_target() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
    BEGIN
      IF EXISTS (SELECT 1 FROM sf_int_fault.target t
                  WHERE t.application_id IN (NEW.aggregate_id::text, NEW.envelope->'data'->>'resource_id')
                    AND (t.event_type IS NULL OR t.event_type = NEW.event_type)) THEN
        RAISE EXCEPTION 'sf_int_fault: injected outbox failure';
      END IF;
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS sf_int_fault_outbox ON sf_application_case.outbox_event;
    CREATE TRIGGER sf_int_fault_outbox BEFORE INSERT ON sf_application_case.outbox_event
      FOR EACH ROW EXECUTE FUNCTION sf_int_fault.raise_on_target();
  `);
}

async function removeFault(): Promise<void> {
  await admin().query(`
    DROP TRIGGER IF EXISTS sf_int_fault_outbox ON sf_application_case.outbox_event;
    DROP SCHEMA IF EXISTS sf_int_fault CASCADE;
  `);
}

async function caseRow(id: string) {
  const r = await admin().query<Record<string, unknown>>(
    'SELECT * FROM sf_application_case.application_case WHERE application_id = $1',
    [id],
  );
  return r.rows[0];
}

async function transitionCount(id: string): Promise<number> {
  const r = await admin().query<{ n: string }>(
    'SELECT count(*) AS n FROM sf_application_case.case_transition WHERE application_id = $1',
    [id],
  );
  return Number(r.rows[0]?.n);
}

describe('INT-004 outbox and audit in the same transaction', () => {
  let citizen: CitizenSession;
  let officer: OfficerSession;
  const tsb = () => TSB_A();

  beforeAll(async () => {
    await removeFault();
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
  });
  afterAll(async () => {
    await removeFault();
    await closeAdmin();
  });

  it('draft, working data and every command write their events atomically; pins equal the published binding', async () => {
    const created = await createDraft(HOST_A(), citizen.token, tsb());
    expect(created.status).toBe(201);
    let app = created.body['application'] as App;
    const published = FIXTURE_A().binding;
    expect(app.pins).toEqual(published.pins);
    const row = await caseRow(app.application_id);
    for (const [k, v] of Object.entries(published.pins)) expect(row?.[k], k).toBe(v);
    expect(row?.['tenant_id']).toBe(FIXTURE_A().placement.tenant_id);
    expect(row?.['applicant_id']).toBe(citizen.citizen_id);

    let rows = await outboxFor(app.application_id);
    expect(rows.map((r) => `${r.topic}|${r.event_type}`)).toEqual([
      `${DOMAIN}|ApplicationDraftCreated`,
      `${AUDIT}|AuditEventSubmitted`,
    ]);
    expect(new Set(rows.map((r) => r.created_at.toISOString())).size).toBe(1);

    const wd = await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0);
    expect(wd.status).toBe(200);
    rows = await outboxFor(app.application_id);
    const wdRows = rows.slice(2);
    expect(
      wdRows.map((r) => r.envelope['data'] && (r.envelope['data'] as { action?: string }).action),
    ).toEqual(['APPLICATION_WORKING_DATA_WRITE']);
    // CCR-M10-001: audit carries hash/revision only, never field values; no domain event carries values.
    expect(JSON.stringify(rows)).not.toContain('Synthetic Locality');

    const steps: [string, string][] = [
      ['MARK_READY_TO_SUBMIT', citizen.token],
      ['SUBMIT', citizen.token],
      ['MARK_RECEIVED', officer.token],
      ['ENTER_SCRUTINY', officer.token],
      ['ENTER_DECISION_PENDING', officer.token],
    ];
    for (const [cmd, token] of steps) {
      const before = (await outboxFor(app.application_id)).length;
      const r = await command(HOST_A(), token, app, cmd);
      expect(r.status, `${cmd}: ${JSON.stringify(r.body)}`).toBe(200);
      app = r.body['application'] as App;
      const added = (await outboxFor(app.application_id)).slice(before);
      expect(
        added.map((x) => x.event_type),
        cmd,
      ).toEqual(['ApplicationStateChanged', 'AuditEventSubmitted']);
      expect(Number(must(added[0]).aggregate_version)).toBe(app.aggregate_version);
      expect(new Set(added.map((x) => x.created_at.toISOString())).size, `${cmd} same txn`).toBe(1);
      expect(new Set(added.map((x) => x.envelope['correlation_id'])).size).toBe(1);
      for (const x of added) {
        const e = check(EVENT_ENVELOPE, x.envelope);
        expect(e.valid, JSON.stringify(e.errors)).toBe(true);
        expect(x.tenant_id).toBe(FIXTURE_A().placement.tenant_id);
      }
      const a = check(AUDIT_EVENT, must(added[1]).envelope['data']);
      expect(a.valid, JSON.stringify(a.errors)).toBe(true);
      expect((must(added[1]).envelope['data'] as { result: string }).result).toBe('SUCCESS');
    }
    const decided = await command(HOST_A(), officer.token, app, 'RECORD_APPROVED', {
      decision: { decision_maker: 'HUMAN' },
    });
    expect(decided.status).toBe(200);
    app = decided.body['application'] as App;
    const last = must((await outboxFor(app.application_id)).at(-1));
    expect((last.envelope['data'] as { action_class: string }).action_class).toBe('DECISION');
    expect(await transitionCount(app.application_id)).toBe(app.aggregate_version);
    const domainEvents = (await outboxFor(app.application_id)).filter((r) => r.topic === DOMAIN);
    expect(domainEvents).toHaveLength(app.aggregate_version);
    const finalRow = await caseRow(app.application_id);
    for (const [k, v] of Object.entries(published.pins)) expect(finalRow?.[k], k).toBe(v);
  });

  it('denied, stale and illegal commands write no domain event and leave the case unchanged', async () => {
    const created = await createDraft(HOST_A(), citizen.token, tsb());
    let app = created.body['application'] as App;
    await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0);
    for (const cmd of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
      app = (await command(HOST_A(), citizen.token, app, cmd)).body['application'] as App;
    }
    const baseline = await outboxFor(app.application_id);
    const baseDomain = baseline.filter((r) => r.topic === DOMAIN).length;

    const denied = await command(HOST_A(), citizen.token, app, 'MARK_RECEIVED');
    expect(denied.status).toBe(403);
    const illegal = await command(HOST_A(), officer.token, app, 'RECORD_APPROVED', {
      decision: { decision_maker: 'HUMAN' },
    });
    expect(illegal.status).toBe(409);
    const stale = await command(
      HOST_A(),
      officer.token,
      { ...app, aggregate_version: 1 },
      'MARK_RECEIVED',
    );
    expect(stale.status).toBe(409);
    const aiDecision = await call(
      HOST_A(),
      'POST',
      `/v1/applications/${app.application_id}/commands`,
      {
        token: officer.token,
        body: {
          command: 'MARK_RECEIVED',
          expected_state: app.state,
          expected_version: app.aggregate_version,
          decision: { decision_maker: 'AI' },
        },
      },
    );
    expect(aiDecision.status).toBeGreaterThanOrEqual(400);

    const after = await outboxFor(app.application_id);
    expect(after.filter((r) => r.topic === DOMAIN)).toHaveLength(baseDomain);
    const newAudit = after.slice(baseline.length);
    for (const r of newAudit) {
      expect(r.topic).toBe(AUDIT);
      expect((r.envelope['data'] as { result: string }).result).toBe('DENIED');
    }
    const row = await caseRow(app.application_id);
    expect(row?.['state']).toBe('SUBMITTED');
    expect(Number(row?.['aggregate_version'])).toBe(app.aggregate_version);
  });

  it('a failing outbox insert rolls back the command; the idempotency key stays unconsumed', async () => {
    const created = await createDraft(HOST_A(), citizen.token, tsb());
    let app = created.body['application'] as App;
    await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0);
    app = (await command(HOST_A(), citizen.token, app, 'MARK_READY_TO_SUBMIT')).body[
      'application'
    ] as App;
    const before = await outboxFor(app.application_id);
    const tBefore = await transitionCount(app.application_id);

    await installFault();
    await admin().query(
      `INSERT INTO sf_int_fault.target (application_id, event_type) VALUES ($1, 'AuditEventSubmitted')`,
      [app.application_id],
    );
    const idem = key();
    const failed = await command(HOST_A(), citizen.token, app, 'SUBMIT', {}, idem);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    const row = await caseRow(app.application_id);
    expect(row?.['state']).toBe('READY_TO_SUBMIT');
    expect(row?.['submitted_at']).toBeNull();
    expect(await transitionCount(app.application_id)).toBe(tBefore);
    expect(await outboxFor(app.application_id)).toHaveLength(before.length);

    await removeFault();
    const retried = await command(HOST_A(), citizen.token, app, 'SUBMIT', {}, idem);
    expect(retried.status).toBe(200);
    expect(retried.headers.get('idempotent-replayed')).toBeNull();
    expect((retried.body['application'] as App).state).toBe('SUBMITTED');
  });

  it('a failing audit insert rolls back the working-data write', async () => {
    const created = await createDraft(HOST_A(), citizen.token, tsb());
    const app = created.body['application'] as App;
    expect((await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0)).status).toBe(
      200,
    );
    await installFault();
    await admin().query(`INSERT INTO sf_int_fault.target (application_id) VALUES ($1)`, [
      app.application_id,
    ]);
    const changed = { ...syntheticForm(), residence_duration_months: 48 };
    const failed = await putWorkingData(HOST_A(), citizen.token, app, changed, 1);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    await removeFault();
    const wd = await admin().query<{ revision: string; data: Record<string, unknown> }>(
      'SELECT revision, data FROM sf_application_case.application_working_data WHERE application_id = $1',
      [app.application_id],
    );
    expect(Number(wd.rows[0]?.revision)).toBe(1);
    expect(wd.rows[0]?.data['residence_duration_months']).toBe(36);
  });
});
