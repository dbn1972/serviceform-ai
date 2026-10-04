import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANARY, OFFICER, T1, T2 } from '../doubles/fixtures.js';
import { asTenant, closeHarness, setupHarness, type Harness } from './helpers.js';

const SHA = 'b'.repeat(64);

async function seed(
  h: Harness,
  tenant: string,
  marker = 'cell-01',
): Promise<{ policyId: string; documentId: string }> {
  const policyId = randomUUID();
  const documentId = randomUUID();
  await asTenant(h.rt, tenant, OFFICER, async (c) => {
    await c.query(
      `INSERT INTO sf_upload.upload_policy (tenant_id, policy_id, policy_code, version_no, status,
         allowed_content_types, max_bytes, session_ttl_seconds, max_scan_attempts, classification, created_by)
       VALUES ($1,$2,$3,1,'ACTIVE','{application/pdf}',1000,900,2,'CITIZEN_PRIVATE',$4)`,
      [tenant, policyId, `P_${policyId.slice(0, 8).toUpperCase()}`, OFFICER],
    );
    await c.query(
      `INSERT INTO sf_upload.document_metadata (tenant_id, document_id, cell_id, policy_id,
         classification, owner_actor_id, owner_actor_type, declared_content_type, declared_byte_size,
         declared_checksum_sha256, object_ref, storage_mode, storage_simulation, status)
       VALUES ($1,$2,$3,$4,'CITIZEN_PRIVATE',$5,'CITIZEN','application/pdf',10,$6,$7,'SIMULATED',$8::jsonb,'PENDING_UPLOAD')`,
      [
        tenant,
        documentId,
        marker,
        policyId,
        OFFICER,
        SHA,
        `t/${tenant}/c/cell-01/o/${documentId}/${SHA.slice(0, 12)}`,
        JSON.stringify({ simulation: true, note: tenant === T2 ? CANARY : 'x' }),
      ],
    );
  });
  return { policyId, documentId };
}

describe('CMP-013 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('migration roles: NOLOGIN, NOSUPERUSER, NOBYPASSRLS; runtime login is not owner', async () => {
    const roles = await h.admin.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
        WHERE rolname IN ('sf_cmp013_rw', 'sf_migrator', 'sf_t013u_rt')`,
    );
    for (const r of roles.rows) {
      expect({ role: r.rolname, rolsuper: r.rolsuper, rolbypassrls: r.rolbypassrls }).toEqual({
        role: r.rolname,
        rolsuper: false,
        rolbypassrls: false,
      });
      if (r.rolname !== 'sf_t013u_rt') expect(r.rolcanlogin).toBe(false);
    }
    const owners = await h.admin.query<{
      relname: string;
      owner: string;
      forced: boolean;
      rls: boolean;
    }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
              c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_upload' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(owners.rows.length).toBe(9);
    for (const t of owners.rows) {
      expect({ t: t.relname, owner: t.owner }).toEqual({ t: t.relname, owner: 'sf_migrator' });
      if (!t.relname.endsWith('_platform')) {
        expect({ t: t.relname, rls: t.rls, forced: t.forced }).toEqual({
          t: t.relname,
          rls: true,
          forced: true,
        });
      }
    }
    const client = await h.rt.connect();
    try {
      const member = await client.query<{ ok: boolean }>(
        `SELECT pg_has_role(session_user, 'sf_migrator', 'MEMBER') AS ok`,
      );
      expect(member.rows[0]?.ok).toBe(false);
      await expect(client.query('SET ROLE sf_cmp048_rw')).rejects.toBeTruthy();
      await expect(client.query('SET ROLE sf_migrator')).rejects.toBeTruthy();
    } finally {
      client.release();
    }
  });

  it('column grants: runtime cannot rewrite identity/declared/object_ref columns', async () => {
    const cols = await h.admin.query<{ column_name: string; ok: boolean }>(
      `SELECT column_name, has_column_privilege('sf_cmp013_rw', 'sf_upload.document_metadata', column_name, 'UPDATE') AS ok
         FROM information_schema.columns
        WHERE table_schema = 'sf_upload' AND table_name = 'document_metadata'`,
    );
    const updatable = cols.rows
      .filter((r) => r.ok)
      .map((r) => r.column_name)
      .sort();
    expect(updatable).toEqual(
      [
        'aggregate_version',
        'byte_size',
        'checksum_sha256',
        'detected_content_type',
        'rejection_code',
        'scan_attempts',
        'status',
        'updated_at',
      ].sort(),
    );
    const del = await h.admin.query<{ ok: boolean }>(
      `SELECT has_table_privilege('sf_cmp013_rw', 'sf_upload.document_metadata', 'DELETE') AS ok`,
    );
    expect(del.rows[0]?.ok).toBe(false);
  });

  it('peer-component login is denied on sf_upload', async () => {
    await expect(
      asTenant(h.other, T1, OFFICER, (c) => c.query('SELECT 1 FROM sf_upload.document_metadata')),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('wrong-tenant RLS returns zero rows; CROSS_TENANT_LEAKAGE=0', async () => {
    const t2 = await seed(h, T2);
    await seed(h, T1);
    const leakage = await asTenant(h.rt, T1, OFFICER, async (c) => {
      let leaked = 0;
      for (const sql of [
        'SELECT * FROM sf_upload.document_metadata WHERE tenant_id = $1',
        'SELECT * FROM sf_upload.upload_policy WHERE tenant_id = $1',
        'SELECT * FROM sf_upload.upload_session WHERE tenant_id = $1',
        'SELECT * FROM sf_upload.document_scan_status WHERE tenant_id = $1',
        'SELECT * FROM sf_upload.idempotency_record WHERE tenant_id = $1',
        'SELECT * FROM sf_upload.inbox_event WHERE tenant_id = $1',
      ]) {
        const r = await c.query(sql, [T2]);
        leaked += r.rowCount ?? 0;
      }
      const all = await c.query('SELECT * FROM sf_upload.document_metadata');
      if (JSON.stringify(all.rows).includes(CANARY)) leaked += 1;
      const direct = await c.query(
        'SELECT * FROM sf_upload.document_metadata WHERE document_id = $1',
        [t2.documentId],
      );
      leaked += direct.rowCount ?? 0;
      return leaked;
    });
    expect(leakage).toBe(0);
    const none = await asTenant(h.rt, null, OFFICER, (c) =>
      c.query('SELECT * FROM sf_upload.document_metadata'),
    );
    expect(none.rowCount).toBe(0);
  });

  it('WITH CHECK blocks writing another tenant row and updating across tenants', async () => {
    const t2 = await seed(h, T2);
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `INSERT INTO sf_upload.upload_policy (tenant_id, policy_id, policy_code, version_no, status,
             allowed_content_types, max_bytes, session_ttl_seconds, max_scan_attempts, classification, created_by)
           VALUES ($1,$2,'FORGED',1,'ACTIVE','{application/pdf}',10,900,1,'TENANT_SCOPED',$3)`,
          [T2, randomUUID(), OFFICER],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const updated = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(
        `UPDATE sf_upload.document_metadata SET status = 'REJECTED', rejection_code = 'X_X'
          WHERE document_id = $1`,
        [t2.documentId],
      ),
    );
    expect(updated.rowCount).toBe(0);
  });

  it('DB guard: no AVAILABLE without CLEAN scan; terminal states final; insert-only rows', async () => {
    const { documentId, policyId } = await seed(h, T1);
    const toScanPending = `UPDATE sf_upload.document_metadata
         SET status = 'SCAN_PENDING', checksum_sha256 = $2, byte_size = 10,
             detected_content_type = 'application/pdf'
       WHERE document_id = $1`;
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `UPDATE sf_upload.document_metadata SET status = 'AVAILABLE' WHERE document_id = $1`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await asTenant(h.rt, T1, OFFICER, (c) => c.query(toScanPending, [documentId, SHA]));
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `UPDATE sf_upload.document_metadata SET status = 'AVAILABLE' WHERE document_id = $1`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `UPDATE sf_upload.document_metadata SET checksum_sha256 = $2 WHERE document_id = $1`,
          [documentId, 'c'.repeat(64)],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await asTenant(h.rt, T1, OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_upload.document_scan_status (tenant_id, scan_id, document_id, attempt_no, verdict,
           engine_ref, scanner_mode, simulation, scanned_at)
         VALUES ($1,$2,$3,1,'INFECTED','sim','SIMULATED','{"simulation":true}',now())`,
        [T1, randomUUID(), documentId],
      );
      await c.query(
        `UPDATE sf_upload.document_metadata SET status = 'REJECTED', rejection_code = 'MALWARE_DETECTED'
          WHERE document_id = $1`,
        [documentId],
      );
    });
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `UPDATE sf_upload.document_metadata SET status = 'SCAN_PENDING' WHERE document_id = $1`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    for (const sql of [
      'UPDATE sf_upload.document_scan_status SET verdict = $2 WHERE document_id = $1',
      'DELETE FROM sf_upload.document_scan_status WHERE document_id = $1 AND $2::text IS NOT NULL',
    ]) {
      await expect(
        asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, [documentId, 'CLEAN'])),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(`UPDATE sf_upload.upload_policy SET max_bytes = 99999 WHERE policy_id = $1`, [
          policyId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('DB check refuses traversal object refs and SIMULATED rows without a marker', async () => {
    const { policyId } = await seed(h, T1);
    for (const [ref, sim] of [
      [`t/${T1}/../x`, '{"simulation":true}'],
      [`t/${T1}/%2e/x`, '{"simulation":true}'],
      [`t/${T1}/ok`, null],
    ] as const) {
      await expect(
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `INSERT INTO sf_upload.document_metadata (tenant_id, document_id, cell_id, policy_id,
               classification, owner_actor_id, owner_actor_type, declared_content_type, declared_byte_size,
               declared_checksum_sha256, object_ref, storage_mode, storage_simulation, status)
             VALUES ($1,$2,'cell-01',$3,'TENANT_SCOPED',$4,'CITIZEN','application/pdf',10,$5,$6,'SIMULATED',$7::jsonb,'PENDING_UPLOAD')`,
            [T1, randomUUID(), policyId, OFFICER, SHA, ref, sim],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
});
