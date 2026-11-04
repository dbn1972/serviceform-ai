import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_DB,
  citizenOnHost,
  db,
  labEnv,
  OTHER_TENANT,
  SAMPLE_FORM,
  submittedCase,
  TENANT_A,
  type CitizenSession,
} from './lib/lab';

let admin: Client;
let cmp015: Client;
let cmp004: Client;
let citizen: CitizenSession;
let caseId: string;

beforeAll(async () => {
  const env = labEnv();
  admin = await db(ADMIN_DB);
  cmp015 = await db(env['DATABASE_URL_CMP015'] as string);
  cmp004 = await db(env['DATABASE_URL_CMP004'] as string);
  citizen = await citizenOnHost();
  caseId = (await submittedCase(citizen)).application_id;
});

afterAll(async () => {
  await Promise.all([admin.end(), cmp015.end(), cmp004.end()]);
});

async function asTenant<T>(c: Client, tenant: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    if (tenant) await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant]);
    return await fn();
  } finally {
    await c.query('ROLLBACK');
  }
}

const CASE_TABLES = [
  'application_case',
  'application_working_data',
  'case_transition',
  'idempotency_record',
];

describe('SEC-RLS runtime logins created by the bootstrap', () => {
  it('runtime logins are NOSUPERUSER and NOBYPASSRLS', async () => {
    const r = await admin.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('sf_lab_cmp004','sf_lab_cmp015') ORDER BY 1",
    );
    expect(r.rows).toEqual([
      { rolname: 'sf_lab_cmp004', rolsuper: false, rolbypassrls: false },
      { rolname: 'sf_lab_cmp015', rolsuper: false, rolbypassrls: false },
    ]);
  });

  for (const table of CASE_TABLES) {
    it(`placement-tenant rows in sf_application_case.${table} are invisible under another tenant and with no tenant`, async () => {
      const q = `SELECT count(*)::int AS n FROM sf_application_case.${table} WHERE tenant_id = $1`;
      const own = await asTenant(cmp015, TENANT_A, () =>
        cmp015.query<{ n: number }>(q, [TENANT_A]),
      );
      expect(own.rows[0]?.n).toBeGreaterThan(0);
      const other = await asTenant(cmp015, OTHER_TENANT, () =>
        cmp015.query<{ n: number }>(q, [TENANT_A]),
      );
      expect(other.rows[0]?.n).toBe(0);
      const none = await asTenant(cmp015, null, () => cmp015.query<{ n: number }>(q, [TENANT_A]));
      expect(none.rows[0]?.n).toBe(0);
    });
  }

  it('the case written through the API is visible only under the placement tenant', async () => {
    const q =
      'SELECT count(*)::int AS n FROM sf_application_case.application_case WHERE application_id = $1';
    expect(
      (await asTenant(cmp015, TENANT_A, () => cmp015.query<{ n: number }>(q, [caseId]))).rows[0]?.n,
    ).toBe(1);
    expect(
      (await asTenant(cmp015, OTHER_TENANT, () => cmp015.query<{ n: number }>(q, [caseId]))).rows[0]
        ?.n,
    ).toBe(0);
  });

  it('another tenant cannot update or delete placement-tenant rows (0 rows affected)', async () => {
    const upd = await asTenant(cmp015, OTHER_TENANT, () =>
      cmp015.query(
        "UPDATE sf_application_case.application_working_data SET data = '{}'::jsonb WHERE application_id = $1",
        [caseId],
      ),
    );
    expect(upd.rowCount).toBe(0);
    const st = await asTenant(cmp015, OTHER_TENANT, () =>
      cmp015.query(
        "UPDATE sf_application_case.application_case SET state = 'APPROVED' WHERE application_id = $1",
        [caseId],
      ),
    );
    expect(st.rowCount).toBe(0);
    await expect(
      asTenant(cmp015, TENANT_A, () =>
        cmp015.query('DELETE FROM sf_application_case.case_transition WHERE application_id = $1', [
          caseId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('the outbox is insert-only for the runtime login (no read-back of events) and FORCE RLS', async () => {
    await expect(
      asTenant(cmp015, TENANT_A, () =>
        cmp015.query('SELECT 1 FROM sf_application_case.outbox_event LIMIT 1'),
      ),
    ).rejects.toThrow(/permission denied/);
    const r = await admin.query<{ f: boolean }>(
      "SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'sf_application_case.outbox_event'::regclass",
    );
    expect(r.rows[0]?.f).toBe(true);
  });

  it('tenant_id cannot be rewritten by the runtime login (column privilege + WITH CHECK)', async () => {
    await expect(
      asTenant(cmp015, TENANT_A, () =>
        cmp015.query(
          `UPDATE sf_application_case.application_case SET tenant_id = $1 WHERE application_id = $2`,
          [OTHER_TENANT, caseId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('the cmp015 login cannot read CMP-004 tables and vice versa (no cross-component SQL)', async () => {
    await expect(cmp015.query('SELECT 1 FROM sf_identity.session_lookup LIMIT 1')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      cmp015.query('SELECT 1 FROM sf_identity.citizen_principal LIMIT 1'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(cmp004, TENANT_A, () =>
        cmp004.query('SELECT 1 FROM sf_application_case.application_case LIMIT 1'),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('runtime logins cannot disable RLS or alter policies', async () => {
    await expect(
      cmp015.query('ALTER TABLE sf_application_case.application_case DISABLE ROW LEVEL SECURITY'),
    ).rejects.toThrow();
    await expect(cmp015.query('SET row_security = off')).resolves.toBeDefined();
    const r = await asTenant(cmp015, null, () =>
      cmp015.query('SELECT count(*)::int AS n FROM sf_application_case.application_case'),
    ).catch((e: Error) => e);
    if (!(r instanceof Error)) expect((r.rows[0] as { n: number }).n).toBe(0);
    await cmp015.query('RESET row_security');
  });
});

describe('SEC-PII no applicant PII in outbox/audit rows', () => {
  const markers = [
    SAMPLE_FORM.applicant_name,
    SAMPLE_FORM.residence_address.house_no_or_name,
    SAMPLE_FORM.residence_address.locality,
    SAMPLE_FORM.applicant_dob,
    'applicant_name',
  ];

  it('no working-data values or mobile numbers in any outbox, inbox or audit table', async () => {
    const tables = await admin.query<{ s: string; t: string }>(
      `SELECT table_schema AS s, table_name AS t FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND (table_name LIKE 'outbox_event%' OR table_name LIKE 'inbox_event%' OR table_name LIKE 'audit_event%')
          AND table_schema LIKE 'sf\\_%'`,
    );
    expect(tables.rows.length).toBeGreaterThan(5);
    const hits: string[] = [];
    for (const { s, t } of tables.rows) {
      const ident = await admin.query<{ q: string }>(
        'SELECT format($1::text, $2::text, $3::text) AS q',
        ['SELECT r::text AS row FROM %I.%I r', s, t],
      );
      const rows = await admin.query<{ row: string }>(String(ident.rows[0]?.q));
      for (const { row } of rows.rows) {
        for (const m of [...markers, citizen.mobile]) {
          if (row.includes(m)) hits.push(`${s}.${t}:${m === citizen.mobile ? '<mobile>' : m}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('working data PII lives only in the RLS-protected working-data table', async () => {
    const r = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sf_application_case.application_working_data WHERE application_id = $1 AND data->>$2 = $3',
      [caseId, 'applicant_name', SAMPLE_FORM.applicant_name],
    );
    expect(r.rows[0]?.n).toBe(1);
  });

  it('CMP-004 stores channel and token only as hashes', async () => {
    const r = await admin.query<{ row: string }>(
      `SELECT p::text AS row FROM sf_identity.citizen_principal p WHERE citizen_id = $1
       UNION ALL SELECT s::text FROM sf_identity.citizen_session s WHERE citizen_id = $1
       UNION ALL SELECT l::text FROM sf_identity.session_lookup l WHERE subject_id = $1`,
      [citizen.citizen_id],
    );
    expect(r.rows.length).toBeGreaterThan(2);
    for (const { row } of r.rows) {
      expect(row).not.toContain(citizen.mobile);
      expect(row).not.toContain(citizen.token);
    }
  });
});
