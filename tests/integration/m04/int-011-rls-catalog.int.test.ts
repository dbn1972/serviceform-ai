import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  CANARY,
  M04_RW_ROLES,
  M04_SCHEMAS,
  OFFICER_T1,
  T1,
  T2,
  asTenant,
  createLogin,
  dropRoles,
  ensurePeerGroupRoles,
  inFreshTx,
  migrateUp,
  rolePassword,
  runtimePool,
  withAdmin,
} from './pg-harness.js';

const ROLES = [
  'sf_m04rls_039',
  'sf_m04rls_008',
  'sf_m04rls_011',
  'sf_m04rls_013',
  'sf_m04rls_009',
  'sf_m04rls_014',
  'sf_m04rls_peer',
] as const;

const ROLE_TO_RW = {
  sf_m04rls_039: 'sf_cmp039_rw',
  sf_m04rls_008: 'sf_cmp008_rw',
  sf_m04rls_011: 'sf_cmp011_rw',
  sf_m04rls_013: 'sf_cmp013_rw',
  sf_m04rls_009: 'sf_cmp009_rw',
  sf_m04rls_014: 'sf_cmp014_rw',
} as const;

function requirePool(
  map: Map<string, ReturnType<typeof runtimePool>>,
  login: string,
): ReturnType<typeof runtimePool> {
  const pool = map.get(login);
  if (pool === undefined) {
    throw new Error(`missing LOGIN pool ${login}`);
  }
  return pool;
}

const SCHEMA_PROBE: Record<(typeof M04_SCHEMAS)[number], string> = {
  sf_ai_gateway: 'model_registry',
  sf_rules: 'rule_pack_snapshot',
  sf_evidence: 'evidence_policy',
  sf_upload: 'upload_policy',
  sf_forms: 'form_definition_snapshot',
  sf_docintel: 'extraction_policy',
};

describe('INT-011 M04 LOGIN RLS catalog (independent)', () => {
  const password = rolePassword();
  const leaks: string[] = [];
  const pools = new Map<string, ReturnType<typeof runtimePool>>();

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await dropRoles(c, ROLES);
    });
    migrateUp();
    await withAdmin(async (c) => {
      await ensurePeerGroupRoles(c);
      for (const [login, rw] of Object.entries(ROLE_TO_RW)) {
        await createLogin(c, login, rw, password);
      }
      await createLogin(c, 'sf_m04rls_peer', 'sf_cmp048_rw', password);
    });
    for (const login of Object.keys(ROLE_TO_RW)) {
      pools.set(login, runtimePool(login, password));
    }
    pools.set('sf_m04rls_peer', runtimePool('sf_m04rls_peer', password));
  }, 180_000);

  afterAll(async () => {
    await Promise.all([...pools.values()].map((p) => p.end()));
    const leakage = leaks.length;
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakage);
    mkdirSync('test-results/m04-int', { recursive: true });
    writeFileSync(
      'test-results/m04-int/cross-tenant.json',
      JSON.stringify(
        {
          CROSS_TENANT_LEAKAGE: leakage,
          leaks,
          commit_sha: process.env['M04_COMMIT_SHA'] ?? '',
          production_base: process.env['M04_PRODUCTION_BASE'] ?? '',
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('runtime identities are non-owner, not SUPERUSER, no BYPASSRLS; M04 schemas FORCE RLS', async () => {
    for (const login of Object.keys(ROLE_TO_RW)) {
      const pool = requirePool(pools, login);
      const client = await pool.connect();
      try {
        const id = await client.query<{
          rolsuper: boolean;
          rolbypassrls: boolean;
          session_user: string;
        }>(
          `SELECT r.rolsuper, r.rolbypassrls, session_user
             FROM pg_roles r WHERE r.rolname = session_user`,
        );
        expect(id.rows[0]?.rolsuper, login).toBe(false);
        expect(id.rows[0]?.rolbypassrls, login).toBe(false);
        expect(id.rows[0]?.session_user).toBe(login);
        const member = await client.query<{ ok: boolean }>(
          "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
        );
        expect(member.rows[0]?.ok).toBe(true);
      } finally {
        client.release();
      }
    }

    await withAdmin(async (c) => {
      for (const schema of M04_SCHEMAS) {
        const rows = await c.query<{ relname: string; forced: boolean; rls: boolean }>(
          `SELECT c.relname, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = $2`,
          [schema, SCHEMA_PROBE[schema]],
        );
        expect(rows.rows[0]?.rls, schema).toBe(true);
        expect(rows.rows[0]?.forced, schema).toBe(true);
      }
      for (const role of M04_RW_ROLES) {
        const r = await c.query<{ rolcanlogin: boolean; rolbypassrls: boolean }>(
          `SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = $1`,
          [role],
        );
        expect(r.rows[0]?.rolcanlogin, role).toBe(false);
        expect(r.rows[0]?.rolbypassrls, role).toBe(false);
      }
    });
  });

  it('tenant-scoped M04 tables hide T1 rows from T2 LOGIN sessions (CROSS_TENANT_LEAKAGE=0)', async () => {
    const p039 = requirePool(pools, 'sf_m04rls_039');
    const p008 = requirePool(pools, 'sf_m04rls_008');
    const p011 = requirePool(pools, 'sf_m04rls_011');
    const p013 = requirePool(pools, 'sf_m04rls_013');
    const p009 = requirePool(pools, 'sf_m04rls_009');
    const p014 = requirePool(pools, 'sf_m04rls_014');

    const modelId = randomUUID();
    await asTenant(p039, T1, OFFICER_T1, async (c) => {
      await c.query(
        `INSERT INTO sf_ai_gateway.model_registry (
           model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
           max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
         ) VALUES ($1,$2,'cell-01','sim','m','v',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`,
        [modelId, T1, OFFICER_T1],
      );
    });
    const seen039 = await asTenant(p039, T2, OFFICER_T1, async (c) => {
      const r = await c.query(
        `SELECT model_entry_id FROM sf_ai_gateway.model_registry WHERE model_entry_id = $1`,
        [modelId],
      );
      return r.rowCount ?? 0;
    });
    if (seen039 > 0) leaks.push('CMP-039 model_registry');

    const snapId = randomUUID();
    const hash = `sha256:${'ab'.repeat(32)}`;
    await asTenant(p008, T1, OFFICER_T1, async (c) => {
      await c.query(
        `INSERT INTO sf_rules.rule_pack_snapshot (
           snapshot_id, tenant_id, cell_id, pack_key, content_hash, payload_digest, payload, created_by
         ) VALUES ($1,$2,'cell-01','generic.pack',$3,$3,'{}'::jsonb,$4)`,
        [snapId, T1, hash, OFFICER_T1],
      );
    });
    const seen008 = await asTenant(p008, T2, OFFICER_T1, async (c) => {
      const r = await c.query(
        `SELECT snapshot_id FROM sf_rules.rule_pack_snapshot WHERE snapshot_id = $1`,
        [snapId],
      );
      return r.rowCount ?? 0;
    });
    if (seen008 > 0) leaks.push('CMP-008 rule_pack_snapshot');

    const policyId = randomUUID();
    await asTenant(p011, T1, OFFICER_T1, async (c) => {
      await c.query(
        `INSERT INTO sf_evidence.evidence_policy (
           policy_id, tenant_id, cell_id, policy_key, status, definition, content_hash, created_by
         ) VALUES ($1,$2,'cell-01','generic.policy','DRAFT','{}'::jsonb,$3,$4)`,
        [policyId, T1, hash, OFFICER_T1],
      );
    });
    const seen011 = await asTenant(p011, T2, OFFICER_T1, async (c) => {
      const r = await c.query(
        `SELECT policy_id FROM sf_evidence.evidence_policy WHERE policy_id = $1`,
        [policyId],
      );
      return r.rowCount ?? 0;
    });
    if (seen011 > 0) leaks.push('CMP-011 evidence_policy');

    const upPolicy = randomUUID();
    await asTenant(p013, T1, OFFICER_T1, async (c) => {
      await c.query(
        `INSERT INTO sf_upload.upload_policy (
           tenant_id, policy_id, policy_code, version_no, status, allowed_content_types, max_bytes,
           session_ttl_seconds, max_scan_attempts, classification, created_by
         ) VALUES ($1,$2,'P_T1',1,'ACTIVE','{application/pdf}',1000,900,2,'CITIZEN_PRIVATE',$3)`,
        [T1, upPolicy, OFFICER_T1],
      );
    });
    const seen013 = await asTenant(p013, T2, OFFICER_T1, async (c) => {
      const r = await c.query(
        `SELECT policy_id FROM sf_upload.upload_policy WHERE policy_id = $1`,
        [upPolicy],
      );
      return r.rowCount ?? 0;
    });
    if (seen013 > 0) leaks.push('CMP-013 upload_policy');

    const formSnap = randomUUID();
    await asTenant(p009, T1, OFFICER_T1, async (c) => {
      await c.query(
        `INSERT INTO sf_forms.form_definition_snapshot (
           snapshot_id, tenant_id, cell_id, form_key, content_hash, payload_digest, payload, created_by
         ) VALUES ($1,$2,'cell-01','generic.form',$3,$3,'{}'::jsonb,$4)`,
        [formSnap, T1, hash, OFFICER_T1],
      );
    });
    const seen009 = await asTenant(p009, T2, OFFICER_T1, async (c) => {
      const r = await c.query(
        `SELECT snapshot_id FROM sf_forms.form_definition_snapshot WHERE snapshot_id = $1`,
        [formSnap],
      );
      return r.rowCount ?? 0;
    });
    if (seen009 > 0) leaks.push('CMP-009 form_definition_snapshot');

    const extractPolicy = randomUUID();
    await asTenant(p014, T1, OFFICER_T1, async (c) => {
      await c.query(
        `INSERT INTO sf_docintel.extraction_policy (
           tenant_id, policy_id, policy_code, version_no, status, allowed_content_types, min_confidence,
           max_excerpt_chars, gateway_policy_id, gateway_policy_version, latency_budget_ms, created_by
         ) VALUES ($1,$2,'EXTRACT_T1',1,'ACTIVE','{application/pdf}',0.8,2000,'extract-fields',1,4000,$3)`,
        [T1, extractPolicy, OFFICER_T1],
      );
    });
    const seen014 = await asTenant(p014, T2, OFFICER_T1, async (c) => {
      const r = await c.query(
        `SELECT policy_id FROM sf_docintel.extraction_policy WHERE policy_id = $1`,
        [extractPolicy],
      );
      return r.rowCount ?? 0;
    });
    if (seen014 > 0) leaks.push('CMP-014 extraction_policy');
    if (
      JSON.stringify({ CANARY, seen039, seen008, seen011, seen013, seen009, seen014 }).includes(
        CANARY,
      ) &&
      seen014 > 0
    ) {
      leaks.push('canary echoed with leak');
    }

    expect(leaks).toEqual([]);
    expect(leaks.length).toBe(0);
  });

  it('privilege boundaries: peer denied; SET ROLE denied; wrong-tenant INSERT is 42501 in a fresh tx', async () => {
    const peer = requirePool(pools, 'sf_m04rls_peer');
    const p008 = requirePool(pools, 'sf_m04rls_008');
    const p013 = requirePool(pools, 'sf_m04rls_013');

    await expect(
      asTenant(peer, T1, ACTOR, async (c) => {
        await c.query('SELECT * FROM sf_rules.evaluation_record');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(peer, T1, ACTOR, async (c) => {
        await c.query('SELECT * FROM sf_upload.document_metadata');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(p008, T1, OFFICER_T1, async (c) => {
        await c.query('SELECT * FROM sf_upload.document_metadata');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(p013, T1, OFFICER_T1, async (c) => {
        await c.query('SELECT * FROM sf_rules.evaluation_record');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(p008, T1, OFFICER_T1, async (c) => {
        await c.query('SET ROLE sf_cmp048_rw');
      }),
    ).rejects.toBeTruthy();

    // Fresh transaction after expected RLS denial (avoid 25P02 false negatives).
    await expect(
      inFreshTx(p008, T1, OFFICER_T1, async (c) => {
        await c.query(
          `INSERT INTO sf_rules.rule_pack_snapshot (
             snapshot_id, tenant_id, cell_id, pack_key, content_hash, payload_digest, payload, created_by
           ) VALUES ($1,$2,'cell-01','forged.pack',$3,$3,'{}'::jsonb,$4)`,
          [randomUUID(), T2, `sha256:${'cd'.repeat(32)}`, OFFICER_T1],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      inFreshTx(p013, T1, OFFICER_T1, async (c) => {
        await c.query(
          `INSERT INTO sf_upload.upload_policy (
             tenant_id, policy_id, policy_code, version_no, status, allowed_content_types, max_bytes,
             session_ttl_seconds, max_scan_attempts, classification, created_by
           ) VALUES ($1,$2,'P_FORGED',1,'ACTIVE','{application/pdf}',1000,900,2,'CITIZEN_PRIVATE',$3)`,
          [T2, randomUUID(), OFFICER_T1],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });

    // Subsequent assertion still works after prior 42501 (fresh tx).
    const ok = await inFreshTx(p008, T1, OFFICER_T1, async (c) => {
      const r = await c.query(`SELECT count(*)::int AS n FROM sf_rules.rule_pack_snapshot`);
      return r.rows[0]?.n ?? -1;
    });
    expect(ok).toBeGreaterThanOrEqual(0);
  });
});
