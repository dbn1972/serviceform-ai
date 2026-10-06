import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  asTenant,
  caseInsert,
  CMP015_TABLES,
  TABLE_SQL,
  closeHarness,
  HASH,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const TABLES = CMP015_TABLES;

describe('CMP-015 privilege boundary (ADR-0006 condition 10)', () => {
  it('runtime login is not SUPERUSER, not BYPASSRLS, owns no table and cannot create in the schema', async () => {
    const c = await h.rt.connect();
    try {
      const me = await c.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user`,
      );
      expect(me.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
      const owners = await c.query(
        `SELECT bool_or(pg_has_role(session_user, c.relowner, 'MEMBER')) AS owns
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_application_case' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.['owns']).toBe(false);
      const ddl = await c.query(
        `SELECT has_schema_privilege(session_user, 'sf_application_case', 'CREATE') AS ok`,
      );
      expect(ddl.rows[0]?.['ok']).toBe(false);
    } finally {
      c.release();
    }
  });

  it('sf_cmp015_rw is NOLOGIN, NOSUPERUSER, NOBYPASSRLS; every TENANT_SCOPED table has FORCE RLS', async () => {
    const role = await h.admin.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp015_rw'`,
    );
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
    const rls = await h.admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_application_case' AND c.relkind = 'r' ORDER BY 1`,
    );
    const byName = Object.fromEntries(rls.rows.map((r) => [r['relname'], r]));
    for (const t of [...TABLES, 'outbox_event', 'inbox_event']) {
      expect({
        t,
        rls: byName[t]?.['relrowsecurity'],
        force: byName[t]?.['relforcerowsecurity'],
      }).toEqual({ t, rls: true, force: true });
    }
  });

  it('own authorized DML succeeds under tenant context', async () => {
    const [sql, values] = caseInsert(T1);
    await asTenant(h.rt, T1, (c) => c.query(sql, values));
    const n = await asTenant(h.rt, T1, (c) =>
      c.query('SELECT count(*)::int AS n FROM sf_application_case.application_case'),
    );
    expect(Number(n.rows[0]?.['n'])).toBeGreaterThanOrEqual(1);
  });

  it('NEGATIVE: wrong-tenant rows are invisible, cross-tenant insert fails, no context reads nothing', async () => {
    const id = randomUUID();
    const [sql, values] = caseInsert(T1, id);
    await asTenant(h.rt, T1, (c) => c.query(sql, values));
    const asT2 = await asTenant(h.rt, T2, (c) =>
      c.query('SELECT * FROM sf_application_case.application_case WHERE application_id = $1', [id]),
    );
    expect(asT2.rows).toEqual([]);
    const upd = await asTenant(h.rt, T2, (c) =>
      c.query(
        `UPDATE sf_application_case.application_case SET state = 'READY_TO_SUBMIT', aggregate_version = 2 WHERE application_id = $1`,
        [id],
      ),
    );
    expect(upd.rowCount).toBe(0);
    const [xsql, xvalues] = caseInsert(T1);
    await expect(asTenant(h.rt, T2, (c) => c.query(xsql, xvalues))).rejects.toThrow(
      /row-level security/,
    );
    const none = await asTenant(h.rt, null, (c) =>
      c.query('SELECT count(*)::int AS n FROM sf_application_case.application_case'),
    );
    expect(Number(none.rows[0]?.['n'])).toBe(0);
  });

  it('NEGATIVE: a peer component login cannot SELECT/INSERT/UPDATE/DELETE CMP-015 tables', async () => {
    for (const t of TABLES) {
      await expect(asTenant(h.peer, T1, (c) => c.query(TABLE_SQL[t].select1))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asTenant(h.peer, T1, (c) => c.query(TABLE_SQL[t].deleteAll))).rejects.toThrow(
        /permission denied/,
      );
    }
    const [sql, values] = caseInsert(T1);
    await expect(asTenant(h.peer, T1, (c) => c.query(sql, values))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asTenant(h.peer, T1, (c) =>
        c.query(`UPDATE sf_application_case.application_case SET state = 'CLOSED'`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('NEGATIVE: sf_app alone holds no DML on CMP-015 authoritative tables', async () => {
    const [sql, values] = caseInsert(T1);
    await expect(asTenant(h.appOnly, T1, (c) => c.query(sql, values))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asTenant(h.appOnly, T1, (c) => c.query('SELECT 1 FROM sf_application_case.application_case')),
    ).rejects.toThrow(/permission denied/);
  });

  it('NEGATIVE: runtime cannot SET ROLE into another component role nor TRUNCATE / DELETE cases', async () => {
    await expect(asTenant(h.rt, T1, (c) => c.query('SET ROLE sf_cmp009_rw'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asTenant(h.rt, T1, (c) => c.query('TRUNCATE sf_application_case.application_case')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(h.rt, T1, (c) => c.query('DELETE FROM sf_application_case.application_case')),
    ).rejects.toThrow(/permission denied/);
    const member = await h.admin.query(`SELECT pg_has_role($1, 'sf_cmp009_rw', 'MEMBER') AS m`, [
      'sf_t015_rt',
    ]);
    expect(member.rows[0]?.['m']).toBe(false);
  });
});

describe('CMP-015 database-enforced state machine (defence in depth)', () => {
  async function newCase(): Promise<string> {
    const id = randomUUID();
    const [sql, values] = caseInsert(T1, id);
    await asTenant(h.rt, T1, (c) => c.query(sql, values));
    return id;
  }

  it('NEGATIVE: WITHDRAWAL_REQUESTED / CANCELLATION_REQUESTED are refused as a case state by the CHECK', async () => {
    const id = await newCase();
    for (const s of ['WITHDRAWAL_REQUESTED', 'CANCELLATION_REQUESTED']) {
      await expect(
        asTenant(h.rt, T1, (c) =>
          c.query(
            `UPDATE sf_application_case.application_case SET state = $1, aggregate_version = 2 WHERE application_id = $2`,
            [s, id],
          ),
        ),
      ).rejects.toMatchObject({ hint: 'SF_INVALID_TRANSITION' });
      // The CHECK holds on its own even with the transition trigger disabled (rolled back).
      await expect(
        asTenant(h.admin, T1, async (c) => {
          await c.query(
            'ALTER TABLE sf_application_case.application_case DISABLE TRIGGER application_case_transition_guard',
          );
          await c.query(
            `UPDATE sf_application_case.application_case SET state = $1 WHERE application_id = $2`,
            [s, id],
          );
        }),
      ).rejects.toThrow(/check constraint/);
    }
  });

  it('NEGATIVE: a case can only be created as DRAFT v1; illegal transitions and version skips are refused', async () => {
    const [sql, values] = caseInsert(T1);
    await expect(
      asTenant(h.rt, T1, (c) => c.query(sql.replace("'DRAFT',1", "'SUBMITTED',1"), values)),
    ).rejects.toMatchObject({ hint: 'SF_INVALID_TRANSITION' });
    const id = await newCase();
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.application_case SET state = 'APPROVED', aggregate_version = 2 WHERE application_id = $1`,
          [id],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_INVALID_TRANSITION' });
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.application_case SET state = 'READY_TO_SUBMIT', aggregate_version = 5 WHERE application_id = $1`,
          [id],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_STALE_VERSION' });
    const ok = await asTenant(h.rt, T1, (c) =>
      c.query(
        `UPDATE sf_application_case.application_case SET state = 'READY_TO_SUBMIT', aggregate_version = 2 WHERE application_id = $1`,
        [id],
      ),
    );
    expect(ok.rowCount).toBe(1);
  });

  it('NEGATIVE: WITHDRAWN without a committed, consumed request construct is refused by the trigger', async () => {
    const id = await newCase();
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.application_case SET state = 'WITHDRAWN', aggregate_version = 2 WHERE application_id = $1`,
          [id],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_REQUEST_NOT_COMMITTED' });
    const rid = randomUUID();
    await asTenant(h.rt, T1, (c) =>
      c.query(
        `INSERT INTO sf_application_case.case_request_reference (request_id, tenant_id, application_id, kind, status, case_state_at_request, created_by, created_at, updated_at, last_correlation_id)
         VALUES ($1,$2,$3,'WITHDRAWAL','SUBMITTED','DRAFT',$4,now(),now(),$4)`,
        [rid, T1, id, ACTOR],
      ),
    );
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.case_request_reference SET consumed_at_version = 2 WHERE request_id = $1`,
          [rid],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.application_case SET state = 'WITHDRAWN', aggregate_version = 2 WHERE application_id = $1`,
          [id],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_REQUEST_NOT_COMMITTED' });
    await asTenant(h.rt, T1, async (c) => {
      await c.query(
        `UPDATE sf_application_case.case_request_reference SET status = 'COMMITTED' WHERE request_id = $1`,
        [rid],
      );
      await c.query(
        `UPDATE sf_application_case.case_request_reference SET consumed_at_version = 2 WHERE request_id = $1`,
        [rid],
      );
      await c.query(
        `UPDATE sf_application_case.application_case SET state = 'WITHDRAWN', aggregate_version = 2 WHERE application_id = $1`,
        [id],
      );
    });
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.case_request_reference SET consumed_at_version = 3 WHERE request_id = $1`,
          [rid],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_INVALID_TRANSITION' });
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.case_request_reference SET status = 'REJECTED' WHERE request_id = $1`,
          [rid],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_INVALID_TRANSITION' });
  });

  it('NEGATIVE: pinned versions and identity are immutable; transitions are append-only', async () => {
    const id = await newCase();
    await expect(
      asTenant(h.rt, T1, (c) =>
        c
          .query(
            `UPDATE sf_application_case.application_case SET state = 'READY_TO_SUBMIT', aggregate_version = 2, updated_at = now() WHERE application_id = $1`,
            [id],
          )
          .then(() =>
            c.query(
              `UPDATE sf_application_case.application_case SET rule_version_id = $2 WHERE application_id = $1`,
              [id, randomUUID()],
            ),
          ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(h.admin, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.application_case SET rule_version_id = $2, aggregate_version = aggregate_version + 1 WHERE application_id = $1`,
          [id, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_PIN_IMMUTABLE' });
    await expect(
      asTenant(h.admin, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.application_case SET applicant_id = $2 WHERE application_id = $1`,
          [id, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_RECORD_IMMUTABLE' });
    await expect(
      asTenant(h.admin, T1, (c) =>
        c.query(`DELETE FROM sf_application_case.application_case WHERE application_id = $1`, [id]),
      ),
    ).rejects.toMatchObject({ hint: 'SF_RECORD_IMMUTABLE' });
    await asTenant(h.rt, T1, (c) =>
      c.query(
        `INSERT INTO sf_application_case.case_transition (transition_id, tenant_id, application_id, command, from_state, to_state, transition_key, transition_class, aggregate_version, idempotency_key, authz_decision_id, authz_policy_revision, correlation_id, actor_type, actor_id, occurred_at)
         VALUES ($1,$2,$3,'CREATE_DRAFT',NULL,'DRAFT',NULL,NULL,1,'idem-key-0001',$4,'rev-1',$4,'CITIZEN',$4,now())`,
        [randomUUID(), T1, id, ACTOR],
      ),
    );
    await expect(
      asTenant(h.admin, T1, (c) =>
        c.query(
          `UPDATE sf_application_case.case_transition SET to_state = 'CLOSED' WHERE application_id = $1`,
          [id],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'SF_RECORD_IMMUTABLE' });
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `INSERT INTO sf_application_case.case_transition (transition_id, tenant_id, application_id, command, from_state, to_state, transition_key, transition_class, aggregate_version, idempotency_key, authz_decision_id, authz_policy_revision, correlation_id, actor_type, actor_id, occurred_at)
           VALUES ($1,$2,$3,'COMMIT_WITHDRAWAL','DRAFT','WITHDRAWN','DRAFT>WITHDRAWN','POLICY_GATED_WITHDRAWAL',2,'idem-key-0002',$4,'rev-1',$4,'SYSTEM',$4,now())`,
          [randomUUID(), T1, id, ACTOR],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
    expect(HASH).toMatch(/^sha256:/);
  });
});
