#!/usr/bin/env node
/**
 * SF-M01-G4-003 independent LOGIN-role security catalog (W1+W2).
 * Verifier-owned additive probe under tests/security/** — not product code.
 * Hard gate: CROSS_TENANT_LEAKAGE=0. Not CERTIFIED.
 */
import pg from '../../db/node_modules/pg/esm/index.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DB_DIR = join(ROOT, 'db');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const TIP = process.env.G4_TIP_SHA || 'ab8359f0ffe96834bdf61318d1db7877433e7dcc';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANARY = `CANARY-T2-${T2}`;
const pw = 'synth-g4-not-a-secret-' + randomBytes(16).toString('hex');
const findings = [];
const pass = [];

function rec(ok, id, detail) {
  (ok ? pass : findings).push({ id, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
}

function migrate() {
  execFileSync(
    'pnpm',
    [
      'exec',
      'node-pg-migrate',
      'up',
      '--migrations-dir',
      'migrations',
      '--migrations-table',
      'sf_schema_migrations',
      '--migrations-schema',
      'sf_platform',
      '--create-migrations-schema',
      '--check-order',
    ],
    { cwd: DB_DIR, env: process.env, stdio: 'pipe' },
  );
}

function roleUrl(user) {
  const u = new URL(url);
  u.username = user;
  u.password = pw;
  return u.toString();
}

const COMPONENTS = [
  { id: 'CMP-002', login: 'sf_g4_002_rt', rw: 'sf_cmp002_rw', schema: 'sf_tenant_org' },
  { id: 'CMP-003', login: 'sf_g4_003_rt', rw: 'sf_cmp003_rw', schema: 'sf_jurisdiction' },
  { id: 'CMP-030', login: 'sf_g4_030_rt', rw: 'sf_cmp030_rw', schema: 'sf_consent_privacy' },
  { id: 'CMP-031', login: 'sf_g4_031_rt', rw: 'sf_cmp031_rw', schema: 'sf_audit' },
  { id: 'CMP-032', login: 'sf_g4_032_rt', rw: 'sf_cmp032_rw', schema: 'sf_storage' },
  { id: 'CMP-037', login: 'sf_g4_037_rt', rw: 'sf_cmp037_rw', schema: 'sf_integration_hub' },
  { id: 'CMP-038', login: 'sf_g4_038_rt', rw: 'sf_cmp038_rw', schema: 'sf_event_bus' },
  { id: 'CMP-048', login: 'sf_g4_048_rt', rw: 'sf_cmp048_rw', schema: 'sf_security' },
];
const ALL_RW = COMPONENTS.map((c) => c.rw);
const OUTBOX_TABLES = [
  'outbox_event',
  'outbox_event_platform',
  'inbox_event',
  'inbox_event_platform',
];

const TENANT_SCOPED = new Set([
  'sf_tenant_org.tenant',
  'sf_tenant_org.tenant_cell_binding',
  'sf_tenant_org.tenant_placement_proposal',
  'sf_tenant_org.organisation',
  'sf_tenant_org.organisation_version',
  'sf_tenant_org.organisation_relation',
  'sf_tenant_org.office',
  'sf_tenant_org.idempotency_record',
  'sf_tenant_org.outbox_event',
  'sf_tenant_org.inbox_event',
  'sf_security.privileged_access_record',
  'sf_security.idempotency_record',
  'sf_security.outbox_event',
  'sf_security.inbox_event',
  'sf_audit.audit_event',
  'sf_audit.audit_event_key',
  'sf_audit.audit_chain_head',
  'sf_audit.outbox_event',
  'sf_audit.inbox_event',
  'sf_event_bus.outbox_event',
  'sf_event_bus.inbox_event',
  'sf_integration_hub.connector_binding',
  'sf_integration_hub.connector_transaction',
  'sf_integration_hub.outbox_event',
  'sf_integration_hub.inbox_event',
  'sf_jurisdiction.jurisdiction_type',
  'sf_jurisdiction.jurisdiction',
  'sf_jurisdiction.jurisdiction_version',
  'sf_jurisdiction.jurisdiction_relation',
  'sf_jurisdiction.jurisdiction_binding',
  'sf_jurisdiction.idempotency_record',
  'sf_jurisdiction.outbox_event',
  'sf_jurisdiction.inbox_event',
  'sf_consent_privacy.purpose',
  'sf_consent_privacy.privacy_notice',
  'sf_consent_privacy.consent',
  'sf_consent_privacy.consent_event',
  'sf_consent_privacy.idempotency_record',
  'sf_consent_privacy.outbox_event',
  'sf_consent_privacy.inbox_event',
  'sf_storage.storage_policy',
  'sf_storage.object_metadata',
  'sf_storage.idempotency_record',
  'sf_storage.outbox_event',
  'sf_storage.inbox_event',
]);

const COMPONENT_SCHEMAS = [
  'sf_tenant_org',
  'sf_security',
  'sf_audit',
  'sf_event_bus',
  'sf_integration_hub',
  'sf_jurisdiction',
  'sf_consent_privacy',
  'sf_storage',
];

async function withClient(cs, fn) {
  const c = new pg.Client({ connectionString: cs });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function asTenant(cs, tenantId, fn) {
  return withClient(cs, async (c) => {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await c.query(`SELECT set_config('app.actor_id', $1, true)`, [ACTOR]);
    try {
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

console.log(`Migrating for tip ${TIP}...`);
migrate();
const admin = new pg.Client({ connectionString: url });
await admin.connect();

try {
  await admin.query(`
    DO $$ DECLARE r record;
    BEGIN
      FOR r IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'sf_%' LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO CURRENT_USER', r.nspname);
      END LOOP;
    END $$;
  `);

  const groupRoles = ['sf_app', 'sf_migrator', 'sf_outbox_publisher', ...ALL_RW];
  const roles = await admin.query(
    `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
       FROM pg_roles
      WHERE rolname = ANY($1::text[])
      ORDER BY 1`,
    [groupRoles],
  );
  for (const row of roles.rows) {
    rec(!row.rolsuper, `role.super.${row.rolname}`, `rolsuper=${row.rolsuper}`);
    rec(!row.rolbypassrls, `role.bypass.${row.rolname}`, `rolbypassrls=${row.rolbypassrls}`);
    rec(!row.rolcanlogin, `role.nologin.${row.rolname}`, `rolcanlogin=${row.rolcanlogin}`);
  }
  rec(roles.rowCount === groupRoles.length, 'role.catalog.complete', `found=${roles.rowCount}`);

  const tenantTables = await admin.query(
    `
    SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1::text[])
       AND c.relkind = 'r'
     ORDER BY 1,2
  `,
    [COMPONENT_SCHEMAS],
  );

  for (const t of tenantTables.rows) {
    const fq = `${t.nspname}.${t.relname}`;
    rec(t.owner === 'sf_migrator', `owner.${fq}`, `owner=${t.owner}`);
    if (TENANT_SCOPED.has(fq)) {
      rec(t.relrowsecurity, `rls.enable.${fq}`, `relrowsecurity=${t.relrowsecurity}`);
      rec(t.relforcerowsecurity, `rls.force.${fq}`, `relforcerowsecurity=${t.relforcerowsecurity}`);
    }
  }

  const policies = await admin.query(
    `
    SELECT schemaname, tablename, policyname, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = ANY($1::text[])
  `,
    [COMPONENT_SCHEMAS],
  );
  for (const p of policies.rows) {
    rec(
      !p.roles.includes('public'),
      `policy.public.${p.schemaname}.${p.tablename}.${p.policyname}`,
      `roles=${p.roles}`,
    );
    const fq = `${p.schemaname}.${p.tablename}`;
    if (TENANT_SCOPED.has(fq)) {
      const txt = `${p.qual || ''} ${p.with_check || ''}`;
      const isPublisherTrue =
        String(p.policyname).includes('publisher') &&
        (String(p.roles).includes('sf_outbox_publisher') ||
          txt.trim() === 'true true' ||
          txt.trim() === 'true');
      if (isPublisherTrue) {
        rec(
          true,
          `policy.publisher_residual.${fq}.${p.policyname}`,
          'USING true (SF-CON-OUTBOX residual)',
        );
      } else {
        rec(
          txt.includes('current_tenant_id'),
          `policy.accessor.${fq}.${p.policyname}`,
          txt.slice(0, 120),
        );
      }
    }
  }

  const pubPriv = await admin.query(
    `
    SELECT n.nspname, c.relname, acl.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl ON true
      JOIN pg_roles r ON r.oid = acl.grantee
     WHERE n.nspname = ANY($1::text[])
       AND c.relkind = 'r' AND r.rolname = 'public'
  `,
    [COMPONENT_SCHEMAS],
  );
  rec(pubPriv.rowCount === 0, 'public.table.acl.m01', `rows=${pubPriv.rowCount}`);

  const sfAppDml = await admin.query(
    `
    SELECT n.nspname, c.relname, acl.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl ON true
      JOIN pg_roles r ON r.oid = acl.grantee
     WHERE n.nspname = ANY($1::text[])
       AND c.relkind = 'r'
       AND r.rolname = 'sf_app'
       AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
       AND c.relname NOT IN ('outbox_event','outbox_event_platform','inbox_event','inbox_event_platform')
     ORDER BY 1,2,3
  `,
    [COMPONENT_SCHEMAS],
  );
  rec(
    sfAppDml.rowCount === 0,
    'sf_app.no_authoritative_dml.m01',
    sfAppDml.rows.map((r) => `${r.nspname}.${r.relname}:${r.privilege_type}`).join(', ') || 'none',
  );

  const frozenOutbox = await admin.query(
    `
    SELECT n.nspname, c.relname, acl.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl ON true
      JOIN pg_roles r ON r.oid = acl.grantee
     WHERE n.nspname = ANY($1::text[])
       AND c.relkind = 'r'
       AND r.rolname = 'sf_app'
       AND c.relname = ANY($2::text[])
     ORDER BY 1,2,3
  `,
    [COMPONENT_SCHEMAS, OUTBOX_TABLES],
  );
  rec(
    frozenOutbox.rowCount > 0,
    'sf-con-outbox.sf_app.insert_residual.m01',
    frozenOutbox.rows.map((r) => `${r.nspname}.${r.relname}:${r.privilege_type}`).join(', '),
  );

  const dbname = (await admin.query('SELECT current_database() AS d')).rows[0].d;
  async function recreateLogin(login, inRolesSql) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()`,
      [login],
    );
    await admin.query(`REVOKE ALL ON DATABASE "${dbname}" FROM ${login}`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${login}`);
    await admin.query(
      `CREATE ROLE ${login} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT IN ROLE ${inRolesSql}`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE "${dbname}" TO ${login}`);
  }
  for (const comp of COMPONENTS) {
    await recreateLogin(comp.login, `sf_app, ${comp.rw}`);
  }
  await recreateLogin('sf_g4_pub', 'sf_outbox_publisher');

  for (const comp of COMPONENTS) {
    await withClient(roleUrl(comp.login), async (c) => {
      const id = await c.query(
        `SELECT session_user, current_user, r.rolsuper, r.rolbypassrls
           FROM pg_roles r WHERE r.rolname = session_user`,
      );
      const row = id.rows[0];
      rec(
        row.session_user === row.current_user,
        `${comp.id}.session_eq_current`,
        `${row.session_user}/${row.current_user}`,
      );
      rec(!row.rolsuper && !row.rolbypassrls, `${comp.id}.identity`, JSON.stringify(row));
      const mem = await c.query(
        `SELECT pg_has_role(session_user,'sf_app','MEMBER') AS app,
                pg_has_role(session_user,$1,'MEMBER') AS own`,
        [comp.rw],
      );
      rec(
        mem.rows[0].app && mem.rows[0].own,
        `${comp.id}.membership_own`,
        JSON.stringify(mem.rows[0]),
      );
      for (const other of ALL_RW.filter((r) => r !== comp.rw)) {
        const m = await c.query(`SELECT pg_has_role(session_user,$1,'MEMBER') AS m`, [other]);
        rec(!m.rows[0].m, `${comp.id}.not_member.${other}`, String(m.rows[0].m));
        let setFailed = false;
        try {
          await c.query(`SET ROLE ${other}`);
        } catch {
          setFailed = true;
        }
        rec(setFailed, `${comp.id}.set_role.${other}`, setFailed ? 'denied' : 'ALLOWED');
      }
      const owner = await c.query(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE n.nspname = $1 AND cl.relkind = 'r'`,
        [comp.schema],
      );
      rec(owner.rows[0].ok === false, `${comp.id}.not_owner`, String(owner.rows[0].ok));
    });
  }

  const probes = [
    {
      actor: 'sf_g4_002_rt',
      sql: `SELECT count(*) FROM sf_security.privileged_access_record`,
      id: 'XCOMP.002.select.048',
    },
    {
      actor: 'sf_g4_048_rt',
      sql: `SELECT count(*) FROM sf_tenant_org.tenant`,
      id: 'XCOMP.048.select.002',
    },
    {
      actor: 'sf_g4_002_rt',
      sql: `SELECT count(*) FROM sf_audit.audit_event`,
      id: 'XCOMP.002.select.031',
    },
    {
      actor: 'sf_g4_031_rt',
      sql: `SELECT count(*) FROM sf_event_bus.topic`,
      id: 'XCOMP.031.select.038',
    },
    {
      actor: 'sf_g4_038_rt',
      sql: `SELECT count(*) FROM sf_integration_hub.connector_binding`,
      id: 'XCOMP.038.select.037',
    },
    {
      actor: 'sf_g4_037_rt',
      sql: `SELECT count(*) FROM sf_audit.audit_event`,
      id: 'XCOMP.037.select.031',
    },
    {
      actor: 'sf_g4_003_rt',
      sql: `SELECT count(*) FROM sf_consent_privacy.purpose`,
      id: 'XCOMP.003.select.030',
    },
    {
      actor: 'sf_g4_030_rt',
      sql: `SELECT count(*) FROM sf_jurisdiction.jurisdiction_type`,
      id: 'XCOMP.030.select.003',
    },
    {
      actor: 'sf_g4_003_rt',
      sql: `SELECT count(*) FROM sf_storage.object_metadata`,
      id: 'XCOMP.003.select.032',
    },
    {
      actor: 'sf_g4_032_rt',
      sql: `SELECT count(*) FROM sf_jurisdiction.jurisdiction`,
      id: 'XCOMP.032.select.003',
    },
    {
      actor: 'sf_g4_030_rt',
      sql: `SELECT count(*) FROM sf_storage.storage_policy`,
      id: 'XCOMP.030.select.032',
    },
    {
      actor: 'sf_g4_032_rt',
      sql: `SELECT count(*) FROM sf_consent_privacy.consent`,
      id: 'XCOMP.032.select.030',
    },
    {
      actor: 'sf_g4_002_rt',
      sql: `SELECT count(*) FROM sf_jurisdiction.jurisdiction_type`,
      id: 'XCOMP.002.select.003',
    },
    {
      actor: 'sf_g4_048_rt',
      sql: `SELECT count(*) FROM sf_consent_privacy.purpose`,
      id: 'XCOMP.048.select.030',
    },
    {
      actor: 'sf_g4_003_rt',
      sql: `SELECT count(*) FROM sf_security.privileged_access_record`,
      id: 'XCOMP.003.select.048',
    },
    {
      actor: 'sf_g4_032_rt',
      sql: `SELECT count(*) FROM sf_tenant_org.tenant`,
      id: 'XCOMP.032.select.002',
    },
    {
      actor: 'sf_g4_037_rt',
      sql: `SELECT count(*) FROM sf_storage.object_metadata`,
      id: 'XCOMP.037.select.032',
    },
    {
      actor: 'sf_g4_pub',
      sql: `SELECT count(*) FROM sf_tenant_org.tenant`,
      id: 'XCOMP.publisher.select.002',
    },
    {
      actor: 'sf_g4_pub',
      sql: `SELECT count(*) FROM sf_event_bus.topic`,
      id: 'XCOMP.publisher.select.038_registry',
    },
  ];

  for (const p of probes) {
    await withClient(roleUrl(p.actor), async (c) => {
      let failed = false;
      let msg = 'succeeded';
      try {
        await c.query(p.sql);
      } catch (e) {
        failed = true;
        msg = e.code || e.message;
      }
      rec(failed, p.id, msg);
    });
  }

  // --- Tenant isolation probes (LOGIN roles) ---
  await asTenant(roleUrl('sf_g4_002_rt'), T1, async (c) => {
    await c.query(
      `INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by)
       VALUES ($1,'iso-t1','ISO T1','ACTIVE',$2)`,
      [T1, ACTOR],
    );
  });
  await asTenant(roleUrl('sf_g4_002_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by)
       VALUES ($1,'iso-t2',$2,'ACTIVE',$3)`,
      [T2, CANARY, ACTOR],
    );
  });
  const leak002 = await asTenant(roleUrl('sf_g4_002_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT code, display_name FROM sf_tenant_org.tenant WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak002.count === 0 && !leak002.body.includes(CANARY),
    'TI.002.wrong_tenant_select',
    `count=${leak002.count}`,
  );
  let insertDenied002 = false;
  try {
    await asTenant(roleUrl('sf_g4_002_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by)
         VALUES ($1,'forged','FORGED','ACTIVE',$2)`,
        [T2, ACTOR],
      );
    });
  } catch {
    insertDenied002 = true;
  }
  rec(insertDenied002, 'TI.002.wrong_tenant_insert', insertDenied002 ? 'denied' : 'ALLOWED');

  const typeIdT2 = randomUUID();
  await asTenant(roleUrl('sf_g4_003_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_jurisdiction.jurisdiction_type (
         tenant_id, jurisdiction_type_id, type_code, display_label, status, created_by
       ) VALUES ($1,$2,'LEVEL_X',$3,'ACTIVE',$4)`,
      [T2, typeIdT2, CANARY, ACTOR],
    );
  });
  const leak003 = await asTenant(roleUrl('sf_g4_003_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT display_label FROM sf_jurisdiction.jurisdiction_type WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak003.count === 0 && !leak003.body.includes(CANARY),
    'TI.003.wrong_tenant_select',
    `count=${leak003.count}`,
  );
  let insertDenied003 = false;
  try {
    await asTenant(roleUrl('sf_g4_003_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_jurisdiction.jurisdiction_type (
           tenant_id, jurisdiction_type_id, type_code, display_label, status, created_by
         ) VALUES ($1,$2,'LEAK_T2','x','ACTIVE',$3)`,
        [T2, randomUUID(), ACTOR],
      );
    });
  } catch {
    insertDenied003 = true;
  }
  rec(insertDenied003, 'TI.003.wrong_tenant_insert', insertDenied003 ? 'denied' : 'ALLOWED');

  const purposeT2 = randomUUID();
  await asTenant(roleUrl('sf_g4_030_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_consent_privacy.purpose (
         tenant_id, purpose_id, code, label, status, requires_consent, created_by
       ) VALUES ($1,$2,'T2_ONLY',$3,'ACTIVE',true,$4)`,
      [T2, purposeT2, CANARY, ACTOR],
    );
  });
  const leak030 = await asTenant(roleUrl('sf_g4_030_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT label FROM sf_consent_privacy.purpose WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak030.count === 0 && !leak030.body.includes(CANARY),
    'TI.030.wrong_tenant_select',
    `count=${leak030.count}`,
  );
  let insertDenied030 = false;
  try {
    await asTenant(roleUrl('sf_g4_030_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_consent_privacy.purpose (
           tenant_id, purpose_id, code, label, status, requires_consent, created_by
         ) VALUES ($1,$2,'LEAK_T2','x','ACTIVE',true,$3)`,
        [T2, randomUUID(), ACTOR],
      );
    });
  } catch {
    insertDenied030 = true;
  }
  rec(insertDenied030, 'TI.030.wrong_tenant_insert', insertDenied030 ? 'denied' : 'ALLOWED');

  const policyT2 = randomUUID();
  await asTenant(roleUrl('sf_g4_032_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_storage.storage_policy (
         policy_id, tenant_id, encryption_algorithm, kms_key_ref, max_object_bytes,
         allowed_content_types, retention_class, status
       ) VALUES ($1,$2,'AES_256_GCM','local://g4-sec-key',1048576,ARRAY['application/pdf'],'STANDARD','ACTIVE')`,
      [policyT2, T2],
    );
  });
  const leak032 = await asTenant(roleUrl('sf_g4_032_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT policy_id FROM sf_storage.storage_policy WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount };
  });
  rec(leak032.count === 0, 'TI.032.wrong_tenant_select', `count=${leak032.count}`);
  let insertDenied032 = false;
  try {
    await asTenant(roleUrl('sf_g4_032_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_storage.storage_policy (
           policy_id, tenant_id, encryption_algorithm, kms_key_ref, max_object_bytes,
           allowed_content_types, retention_class, status
         ) VALUES ($1,$2,'AES_256_GCM','local://g4-sec-key',1048576,ARRAY['application/pdf'],'STANDARD','ACTIVE')`,
        [randomUUID(), T2],
      );
    });
  } catch {
    insertDenied032 = true;
  }
  rec(insertDenied032, 'TI.032.wrong_tenant_insert', insertDenied032 ? 'denied' : 'ALLOWED');

  const defId = randomUUID();
  const bindId = randomUUID();
  await withClient(roleUrl('sf_g4_037_rt'), async (c) => {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO sf_integration_hub.connector_definition (
         connector_definition_id, connector_type, adapter_key, display_name, supported_modes, timeout_ms, status
       ) VALUES ($1,'DEPARTMENT_API','echo-g4','echo',ARRAY['SIMULATED']::text[],1000,'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [defId],
    );
    await c.query('COMMIT');
  });
  await asTenant(roleUrl('sf_g4_037_rt'), T1, async (c) => {
    await c.query(
      `INSERT INTO sf_integration_hub.connector_binding (
         connector_binding_id, tenant_id, connector_definition_id, connector_type, mode, environment, critical, secret_ref, simulator_version, enabled
       ) VALUES ($1,$2,$3,'DEPARTMENT_API','SIMULATED','SIT',true,'vault://sim/echo-webhook','echo-1.0.0',true)`,
      [bindId, T1, defId],
    );
  });
  const leak037 = await asTenant(roleUrl('sf_g4_037_rt'), T2, async (c) => {
    const leaked = await c.query(`SELECT tenant_id FROM sf_integration_hub.connector_binding`);
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(leak037.count === 0, 'TI.037.wrong_tenant_select', `count=${leak037.count}`);
  let insertDenied037 = false;
  try {
    await asTenant(roleUrl('sf_g4_037_rt'), T2, async (c) => {
      await c.query(
        `INSERT INTO sf_integration_hub.connector_binding (
           connector_binding_id, tenant_id, connector_definition_id, connector_type, mode, environment, critical, secret_ref, simulator_version, enabled
         ) VALUES ($1,$2,$3,'DEPARTMENT_API','SIMULATED','SIT',true,'vault://sim/echo-webhook','echo-1.0.0',true)`,
        [randomUUID(), T1, defId],
      );
    });
  } catch {
    insertDenied037 = true;
  }
  rec(insertDenied037, 'TI.037.wrong_tenant_insert', insertDenied037 ? 'denied' : 'ALLOWED');

  // Unset tenant fail-closed
  await withClient(roleUrl('sf_g4_002_rt'), async (c) => {
    const unset = await c.query(`SELECT code FROM sf_tenant_org.tenant`);
    rec(unset.rowCount === 0, 'TI.002.unset_tenant_zero', `n=${unset.rowCount}`);
  });
  await withClient(roleUrl('sf_g4_003_rt'), async (c) => {
    await c.query(`SELECT set_config('app.tenant_id', '', true)`);
    const r = await c.query(`SELECT count(*)::int AS n FROM sf_jurisdiction.jurisdiction_type`);
    rec(r.rows[0].n === 0, 'TI.003.unset_tenant_zero', `n=${r.rows[0].n}`);
  });

  // Outbox tenant mismatch (CMP-038)
  await withClient(roleUrl('sf_g4_038_rt'), async (c) => {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);
    const env = {
      event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: T2,
      event_type: 'Example.Created',
      occurred_at: '2026-01-01T00:00:00.000Z',
      producer: 'sf.cmp038',
      schema_version: 1,
      aggregate_type: 'Example',
      aggregate_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      payload: {},
    };
    let mismatch = false;
    try {
      await c.query(
        `INSERT INTO sf_event_bus.outbox_event
           (event_id, tenant_id, topic, partition_key, event_type, schema_version,
            aggregate_type, aggregate_id, aggregate_version, envelope)
         VALUES ($1::uuid, $2::uuid, 'sf.example.events', 'k', 'Example.Created', 1,
                 'Example', $1::uuid, 1, $3::jsonb)`,
        [env.event_id, T2, JSON.stringify(env)],
      );
    } catch {
      mismatch = true;
    }
    rec(mismatch, 'TI.038.outbox.tenant_mismatch', mismatch ? 'denied' : 'LEAK');
    await c.query('ROLLBACK');
  });

  // ADR-0006 #9 residual: cross-schema outbox INSERT via sf_app may succeed — accepted residual, not leakage
  let residualOutbox = false;
  try {
    await asTenant(roleUrl('sf_g4_003_rt'), T1, async (c) => {
      const eid = randomUUID();
      const agg = randomUUID();
      await c.query(
        `INSERT INTO sf_storage.outbox_event (
           event_id, tenant_id, topic, partition_key, event_type, schema_version,
           aggregate_type, aggregate_id, aggregate_version, envelope
         ) VALUES (
           $1,$2,'cmp-032.probe.v1',$1::text,'StorageProbe',1,
           'StorageObject',$3,1,
           jsonb_build_object(
             'event_id',$1::text,
             'tenant_id',$2::text,
             'aggregate_id',$3::text,
             'event_type','StorageProbe'
           )
         )`,
        [eid, T1, agg],
      );
    });
    residualOutbox = true;
  } catch (e) {
    residualOutbox = false;
    console.log('NOTE ADR-0006#9 probe did not insert:', e.code || e.message);
  }
  rec(
    true,
    'ADR0006.9.outbox_cross_schema_residual',
    residualOutbox
      ? 'INSERT TO peer outbox allowed (CCR residual; not CROSS_TENANT_LEAKAGE)'
      : 'peer outbox insert not allowed on this tip (stricter than frozen residual)',
  );

  const leakageFindings = findings.filter(
    (f) => f.id.startsWith('TI.') || f.id.startsWith('XCOMP.') || f.id.startsWith('TENANT.'),
  );
  const summary = {
    tip: TIP,
    task_id: 'SF-M01-G4-003',
    pass: pass.length,
    fail: findings.length,
    CROSS_TENANT_LEAKAGE: leakageFindings.length,
    findings,
    assessed_at: new Date().toISOString(),
    certified: false,
  };
  const outPath = process.env.CATALOG_SUMMARY || 'catalog-summary.json';
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (findings.length) process.exitCode = 1;
} finally {
  await admin.end();
}
