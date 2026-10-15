import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asTenant,
  CITIZEN,
  closeHarness,
  MIGRATION_FILES,
  OFFICER,
  resetData,
  RUNTIME_ROLE,
  setupHarness,
  T1,
  T2,
  VERIFIER,
  withIsolatedDatabase,
  type Harness,
  type PgClient,
} from './helpers.js';

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

async function insertSession(
  c: PgClient,
  tenant: string,
  over: Partial<{
    id: string;
    channel: string;
    by: string;
    for: string;
    status: string;
    version: number;
  }> = {},
): Promise<string> {
  const id = over.id ?? randomUUID();
  await c.query(
    `INSERT INTO sf_assisted.assisted_session (
       tenant_id, session_id, channel, applied_by_actor_id, applied_by_actor_type,
       applied_for_citizen_id, lifecycle_status, session_version, idempotency_key,
       started_at, updated_at, last_correlation_id
     ) VALUES ($1,$2,$3,$4,'OFFICER',$5,$6,$7,$8,now(),now(),$9)`,
    [
      tenant,
      id,
      over.channel ?? 'COUNTER',
      over.by ?? OFFICER,
      over.for ?? CITIZEN,
      over.status ?? 'STARTED',
      over.version ?? 1,
      `idem-${id.slice(0, 8)}`,
      randomUUID(),
    ],
  );
  return id;
}

describe('CMP-057 privilege boundary (ADR-0006), FORCE RLS and distinctness guards (INT-011/015)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 180_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  beforeEach(async () => {
    await resetData(h.admin);
  });

  it('sf_cmp057_rw is NOLOGIN NOSUPERUSER NOBYPASSRLS; runtime inherits it', async () => {
    const roles = await h.admin.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname IN ('sf_cmp057_rw', $1)`,
      [RUNTIME_ROLE],
    );
    const priv = roles.rows.find((r) => r.rolname === 'sf_cmp057_rw');
    const rt = roles.rows.find((r) => r.rolname === RUNTIME_ROLE);
    expect(priv?.rolcanlogin).toBe(false);
    expect(priv?.rolsuper).toBe(false);
    expect(priv?.rolbypassrls).toBe(false);
    expect(rt?.rolcanlogin).toBe(true);
    const members = await h.admin.query<{ roleid: string }>(
      `SELECT r.rolname AS roleid FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid
         JOIN pg_roles u ON u.oid = m.member
        WHERE u.rolname = $1`,
      [RUNTIME_ROLE],
    );
    expect(members.rows.map((r) => r.roleid).sort()).toEqual(['sf_app', 'sf_cmp057_rw'].sort());
  });

  it('FORCE RLS hides cross-tenant rows from the runtime role', async () => {
    await asTenant(h.rt, T1, OFFICER, (c) => insertSession(c, T1));
    await asTenant(h.rt, T2, OFFICER, (c) => insertSession(c, T2));
    const seen = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query<{ n: string }>('SELECT session_id AS n FROM sf_assisted.assisted_session'),
    );
    expect(seen.rows).toHaveLength(1);
  });

  it('peer privilege role cannot SELECT or INSERT into sf_assisted', async () => {
    expect(
      await denied(() =>
        asTenant(h.peer, T1, OFFICER, (c) => c.query('SELECT 1 FROM sf_assisted.assisted_session')),
      ),
    ).toBe('42501');
    expect(await denied(() => asTenant(h.peer, T1, OFFICER, (c) => insertSession(c, T1)))).toBe(
      '42501',
    );
  });

  it('database refuses applied_by == applied_for', async () => {
    const code = await denied(() =>
      asTenant(h.rt, T1, OFFICER, (c) => insertSession(c, T1, { by: CITIZEN, for: CITIZEN })),
    );
    expect(['23514', 'P0001']).toContain(code);
  });

  it('database refuses inventing statutory marker flip', async () => {
    const code = await denied(() =>
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_assisted.assisted_session (
             tenant_id, session_id, channel, applied_by_actor_id, applied_by_actor_type,
             applied_for_citizen_id, invented_statutory_policy_forbidden, lifecycle_status,
             session_version, idempotency_key, started_at, updated_at, last_correlation_id
           ) VALUES ($1,$2,'COUNTER',$3,'OFFICER',$4,false,'STARTED',1,'idem-statute-1',now(),now(),$5)`,
          [T1, randomUUID(), OFFICER, CITIZEN, randomUUID()],
        );
      }),
    );
    expect(['23514', 'P0001']).toContain(code);
  });

  it('representation channel requires third-party verifier + opaque ref', async () => {
    const sessionId = await asTenant(h.rt, T1, OFFICER, (c) =>
      insertSession(c, T1, { channel: 'AUTHORIZED_REPRESENTATIVE' }),
    );
    await asTenant(h.rt, T1, OFFICER, async (c) => {
      await c.query(
        `UPDATE sf_assisted.assisted_session
            SET lifecycle_status = 'APPLICANT_BOUND', session_version = 2,
                applicant_assurance_ref = 'assurance:x', updated_at = now()
          WHERE tenant_id = $1 AND session_id = $2`,
        [T1, sessionId],
      );
    });
    const self = await denied(() =>
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `INSERT INTO sf_assisted.representation_authority (
             tenant_id, representation_id, session_id, representation_authority_ref,
             verified_by_actor_id, verified_by_actor_type, verified_at
           ) VALUES ($1,$2,$3,'authority:ref',$4,'OFFICER',now())`,
          [T1, randomUUID(), sessionId, OFFICER],
        ),
      ),
    );
    expect(self).toBe('P0001');
    await asTenant(h.rt, T1, VERIFIER, (c) =>
      c.query(
        `INSERT INTO sf_assisted.representation_authority (
           tenant_id, representation_id, session_id, representation_authority_ref,
           verified_by_actor_id, verified_by_actor_type, verified_at
         ) VALUES ($1,$2,$3,'authority:ref',$4,'OFFICER',now())`,
        [T1, randomUUID(), sessionId, VERIFIER],
      ),
    );
  });

  it('no-tenant session cannot see rows (FORCE RLS)', async () => {
    await asTenant(h.rt, T1, OFFICER, (c) => insertSession(c, T1));
    const seen = await asTenant(h.rt, null, OFFICER, (c) =>
      c.query('SELECT session_id FROM sf_assisted.assisted_session'),
    );
    expect(seen.rows).toHaveLength(0);
  });

  it('migration pair reverses cleanly on an isolated chain', async () => {
    await withIsolatedDatabase(h.admin, async (_iso, migrateIso) => {
      migrateIso('up');
      const down = migrateIso('down', MIGRATION_FILES.length);
      expect(down.toLowerCase()).toMatch(/down/);
      migrateIso('up');
    });
  }, 180_000);
});
