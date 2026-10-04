#!/usr/bin/env node
/**
 * SF-M03-SEC independent LOGIN-role security catalog.
 * Verifier-owned additive probe under tests/security/m03 — not product code.
 * Hard gate: CROSS_TENANT_LEAKAGE=0. Not CERTIFIED. Does not patch production.
 */
import pg from '../../../db/node_modules/pg/esm/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DB_DIR = join(ROOT, 'db');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

const TIP = process.env.M03_SEC_TIP_SHA || 'unknown';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHECKER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CANARY = `CANARY-T2-${T2}`;
const HASH = `sha256:${'ab'.repeat(32)}`;
const pw = 'synth-m03-sec-not-a-secret-' + randomBytes(16).toString('hex');
const findings = [];
const pass = [];
const leakageFindings = [];

function say(line) {
  process.stdout.write(`${line}\n`);
}

function rec(ok, id, detail, leakage = false) {
  (ok ? pass : findings).push({ id, detail });
  if (!ok && leakage) leakageFindings.push({ id, detail });
  say(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
}

async function fmtSql(client, fmt, params) {
  const built = await client.query('SELECT format($1::text, VARIADIC $2::text[]) AS s', [
    fmt,
    params,
  ]);
  return built.rows[0]?.s ?? '';
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
  { id: 'CMP-001', login: 'sf_m03_001_rt', rw: 'sf_cmp001_rw', schema: 'sf_catalogue' },
  { id: 'CMP-033', login: 'sf_m03_033_rt', rw: 'sf_cmp033_rw', schema: 'sf_metadata' },
  { id: 'CMP-034', login: 'sf_m03_034_rt', rw: 'sf_cmp034_rw', schema: 'sf_master_data' },
  { id: 'CMP-051', login: 'sf_m03_051_rt', rw: 'sf_cmp051_rw', schema: 'sf_maker_checker' },
  { id: 'CMP-052', login: 'sf_m03_052_rt', rw: 'sf_cmp052_rw', schema: 'sf_versioning' },
  { id: 'CMP-053', login: 'sf_m03_053_rt', rw: 'sf_cmp053_rw', schema: 'sf_localization' },
];
const ALL_RW = COMPONENTS.map((c) => c.rw);
const COMPONENT_SCHEMAS = COMPONENTS.map((c) => c.schema);
const OUTBOX_TABLES = [
  'outbox_event',
  'outbox_event_platform',
  'inbox_event',
  'inbox_event_platform',
];

const TENANT_SCOPED = new Set([
  'sf_catalogue.offering',
  'sf_catalogue.offering_version',
  'sf_catalogue.offering_binding',
  'sf_catalogue.idempotency_record',
  'sf_catalogue.outbox_event',
  'sf_catalogue.inbox_event',
  'sf_metadata.metadata_document',
  'sf_metadata.metadata_bundle',
  'sf_metadata.idempotency_record',
  'sf_metadata.outbox_event',
  'sf_metadata.inbox_event',
  'sf_master_data.code_set',
  'sf_master_data.code_set_version',
  'sf_master_data.code_value',
  'sf_master_data.code_set_binding',
  'sf_master_data.import_job',
  'sf_master_data.idempotency_record',
  'sf_master_data.outbox_event',
  'sf_master_data.inbox_event',
  'sf_maker_checker.publication_request',
  'sf_maker_checker.idempotency_record',
  'sf_maker_checker.outbox_event',
  'sf_maker_checker.inbox_event',
  'sf_versioning.tenant_service_binding',
  'sf_versioning.artifact_version',
  'sf_versioning.idempotency_record',
  'sf_versioning.outbox_event',
  'sf_versioning.inbox_event',
  'sf_localization.locale',
  'sf_localization.format_profile',
  'sf_localization.catalog',
  'sf_localization.catalog_version',
  'sf_localization.message',
  'sf_localization.idempotency_record',
  'sf_localization.outbox_event',
  'sf_localization.inbox_event',
]);

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
    await c.query(`SELECT set_config('app.cell_id', $1, true)`, ['cell-01']);
    await c.query(`SELECT set_config('app.actor_type', $1, true)`, ['OFFICER']);
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

async function expectDenied(id, fn, leakage = false) {
  try {
    await fn();
    rec(false, id, 'ALLOWED', leakage);
  } catch (e) {
    rec(true, id, e.code || e.message, leakage);
  }
}

say('Migrating for tip ' + TIP + '...');
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
  const present = await admin.query(
    `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])`,
    [COMPONENT_SCHEMAS],
  );
  if (present.rowCount === COMPONENT_SCHEMAS.length) {
    await admin.query(`
      TRUNCATE TABLE
        sf_catalogue.offering_binding,
        sf_catalogue.offering_version,
        sf_catalogue.offering,
        sf_catalogue.idempotency_record,
        sf_catalogue.outbox_event,
        sf_catalogue.inbox_event,
        sf_metadata.metadata_bundle,
        sf_metadata.metadata_document,
        sf_metadata.idempotency_record,
        sf_master_data.code_set_binding,
        sf_master_data.code_value,
        sf_master_data.code_set_version,
        sf_master_data.code_set,
        sf_master_data.import_job,
        sf_master_data.idempotency_record,
        sf_maker_checker.publication_request,
        sf_maker_checker.idempotency_record,
        sf_versioning.artifact_version,
        sf_versioning.tenant_service_binding,
        sf_versioning.idempotency_record,
        sf_localization.message,
        sf_localization.format_profile,
        sf_localization.catalog_version,
        sf_localization.catalog,
        sf_localization.locale,
        sf_localization.idempotency_record
      RESTART IDENTITY CASCADE
    `);
  }


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
  rec(pubPriv.rowCount === 0, 'public.table.acl.m03', `rows=${pubPriv.rowCount}`);

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
    'sf_app.no_authoritative_dml.m03',
    sfAppDml.rows.map((r) => `${r.nspname}.${r.relname}:${r.privilege_type}`).join(', ') || 'none',
  );

  const dbname = (await admin.query('SELECT current_database() AS d')).rows[0].d;
  async function recreateLogin(login, membershipFmt, membershipParams) {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()',
      [login],
    );
    const revokeSql = await fmtSql(admin, 'REVOKE ALL ON DATABASE %I FROM %I', [dbname, login]);
    await admin.query(revokeSql).catch(() => {});
    const dropSql = await fmtSql(
      admin,
      `DO $do$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN
           DROP OWNED BY %I;
           DROP ROLE %I;
         END IF;
       END $do$`,
      [login, login, login],
    );
    await admin.query(dropSql);
    const createSql = await fmtSql(admin, membershipFmt, membershipParams);
    await admin.query(createSql);
    const grantSql = await fmtSql(admin, 'GRANT CONNECT ON DATABASE %I TO %I', [dbname, login]);
    await admin.query(grantSql);
  }

  for (const comp of COMPONENTS) {
    await recreateLogin(
      comp.login,
      'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT IN ROLE sf_app, %I',
      [comp.login, pw, comp.rw],
    );
  }

  for (const comp of COMPONENTS) {
    await withClient(roleUrl(comp.login), async (c) => {
      const id = await c.query(
        `SELECT session_user, current_user, r.rolsuper, r.rolbypassrls
           FROM pg_roles r WHERE r.rolname = session_user`,
      );
      const row = id.rows[0];
      rec(!row.rolsuper && !row.rolbypassrls, `${comp.id}.identity`, JSON.stringify(row));
      rec(
        row.session_user === row.current_user,
        `${comp.id}.session_eq_current`,
        `${row.session_user}/${row.current_user}`,
      );
      const owner = await c.query(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE n.nspname = $1 AND cl.relkind = 'r'`,
        [comp.schema],
      );
      rec(owner.rows[0].ok === false, `${comp.id}.not_owner`, String(owner.rows[0].ok));
      for (const other of ALL_RW.filter((r) => r !== comp.rw)) {
        let setFailed = false;
        try {
          const setSql = await fmtSql(c, 'SET ROLE %I', [other]);
          await c.query(setSql);
        } catch {
          setFailed = true;
        }
        rec(setFailed, `${comp.id}.set_role.${other}`, setFailed ? 'denied' : 'ALLOWED');
      }
    });
  }

  const xcomp = [
    {
      actor: 'sf_m03_001_rt',
      sql: `SELECT count(*) FROM sf_metadata.metadata_document`,
      id: 'XCOMP.001.select.033',
    },
    {
      actor: 'sf_m03_033_rt',
      sql: `SELECT count(*) FROM sf_catalogue.offering`,
      id: 'XCOMP.033.select.001',
    },
    {
      actor: 'sf_m03_001_rt',
      sql: `SELECT count(*) FROM sf_versioning.tenant_service_binding`,
      id: 'XCOMP.001.select.052',
    },
    {
      actor: 'sf_m03_052_rt',
      sql: `SELECT count(*) FROM sf_maker_checker.publication_request`,
      id: 'XCOMP.052.select.051',
    },
    {
      actor: 'sf_m03_051_rt',
      sql: `SELECT count(*) FROM sf_metadata.metadata_document`,
      id: 'XCOMP.051.select.033',
    },
    {
      actor: 'sf_m03_034_rt',
      sql: `SELECT count(*) FROM sf_localization.locale`,
      id: 'XCOMP.034.select.053',
    },
    {
      actor: 'sf_m03_053_rt',
      sql: `SELECT count(*) FROM sf_master_data.code_set`,
      id: 'XCOMP.053.select.034',
    },
    {
      actor: 'sf_m03_033_rt',
      sql: `SELECT count(*) FROM sf_maker_checker.publication_request`,
      id: 'XCOMP.033.select.051',
    },
  ];
  for (const p of xcomp) {
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

  // --- Tenant isolation: localization locales ---
  await asTenant(roleUrl('sf_m03_053_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_localization.locale (
         tenant_id, locale_id, locale_tag, status, created_by
       ) VALUES ($1,$2,'en-IN','ACTIVE',$3)`,
      [T2, randomUUID(), ACTOR],
    );
  });
  const leak053 = await asTenant(roleUrl('sf_m03_053_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT locale_tag FROM sf_localization.locale WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak053.count === 0 && !leak053.body.includes(CANARY),
    'TI.053.wrong_tenant_select',
    `count=${leak053.count}`,
    true,
  );
  await expectDenied(
    'TI.053.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m03_053_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_localization.locale (
             tenant_id, locale_id, locale_tag, status, created_by
           ) VALUES ($1,$2,'ta','ACTIVE',$3)`,
          [T2, randomUUID(), ACTOR],
        );
      }),
    true,
  );

  // --- Master data ---
  await asTenant(roleUrl('sf_m03_034_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_master_data.code_set (
         tenant_id, code_set_id, set_code, localization_key, status, created_by
       ) VALUES ($1,$2,'FAMILY_T2',$3,'ACTIVE',$4)`,
      [T2, randomUUID(), CANARY.slice(0, 40), ACTOR],
    );
  });
  const leak034 = await asTenant(roleUrl('sf_m03_034_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT localization_key FROM sf_master_data.code_set WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak034.count === 0 && !leak034.body.includes(CANARY),
    'TI.034.wrong_tenant_select',
    `count=${leak034.count}`,
    true,
  );

  // --- Metadata ---
  const docT2 = randomUUID();
  await asTenant(roleUrl('sf_m03_033_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_metadata.metadata_document (
         document_id, tenant_id, cell_id, document_key, kind, schema_id, payload, payload_hash,
         status, created_by
       ) VALUES ($1,$2,'cell-01','generic.svc','SERVICE','sf.metadata.kind.service.v1',
                 '{"code":"generic_service","title":"x"}'::jsonb,$3,'DRAFT',$4)`,
      [docT2, T2, HASH, ACTOR],
    );
  });
  const leak033 = await asTenant(roleUrl('sf_m03_033_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT document_id FROM sf_metadata.metadata_document WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount };
  });
  rec(leak033.count === 0, 'TI.033.wrong_tenant_select', `count=${leak033.count}`, true);

  // --- Versioning ---
  const bindT2 = randomUUID();
  await asTenant(roleUrl('sf_m03_052_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_versioning.tenant_service_binding (
         binding_id, tenant_id, cell_id, binding_key, offering_ref, metadata_bundle_ref,
         pins, dependency_graph, artifact_hash, status, created_by
       ) VALUES ($1,$2,'cell-01','generic.offering','off-1','bundle-1','{}'::jsonb,'{}'::jsonb,$3,'DRAFT',$4)`,
      [bindT2, T2, HASH, ACTOR],
    );
  });
  const leak052 = await asTenant(roleUrl('sf_m03_052_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT binding_id FROM sf_versioning.tenant_service_binding WHERE binding_id = $1`,
      [bindT2],
    );
    return { count: leaked.rowCount };
  });
  rec(leak052.count === 0, 'TI.052.wrong_tenant_select', `count=${leak052.count}`, true);

  // --- Maker-checker ---
  const reqT2 = randomUUID();
  await asTenant(roleUrl('sf_m03_051_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_maker_checker.publication_request (
         request_id, tenant_id, cell_id, subject_type, subject_id, proposed_hash, status, maker_principal_id
       ) VALUES ($1,$2,'cell-01','TENANT_SERVICE_BINDING',$3,$4,'DRAFT',$5)`,
      [reqT2, T2, bindT2, HASH, ACTOR],
    );
  });
  const leak051 = await asTenant(roleUrl('sf_m03_051_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT request_id FROM sf_maker_checker.publication_request WHERE request_id = $1`,
      [reqT2],
    );
    return { count: leaked.rowCount };
  });
  rec(leak051.count === 0, 'TI.051.wrong_tenant_select', `count=${leak051.count}`, true);

  // --- Catalogue offering (needs GLOBAL category first) ---
  const catId = randomUUID();
  const svcId = randomUUID();
  const offT2 = randomUUID();
  await asTenant(roleUrl('sf_m03_001_rt'), T1, async (c) => {
    await c.query(
      `INSERT INTO sf_catalogue.category (category_id, category_code, display_label, status, created_by)
       VALUES ($1,'FAMILY_SEC','Family Sec','ACTIVE',$2)
       ON CONFLICT (category_code) DO NOTHING`,
      [catId, ACTOR],
    );
    const cat = await c.query(
      `SELECT category_id FROM sf_catalogue.category WHERE category_code = 'FAMILY_SEC'`,
    );
    const cid = cat.rows[0].category_id;
    await c.query(
      `INSERT INTO sf_catalogue.canonical_service (
         canonical_service_id, service_code, category_id, status, created_by
       ) VALUES ($1,'svc-sec',$2,'DRAFT',$3)
       ON CONFLICT (service_code) DO NOTHING`,
      [svcId, cid, ACTOR],
    );
  });
  const canonical = await asTenant(roleUrl('sf_m03_001_rt'), T1, async (c) => {
    const r = await c.query(
      `SELECT canonical_service_id FROM sf_catalogue.canonical_service WHERE service_code = 'svc-sec'`,
    );
    return r.rows[0].canonical_service_id;
  });
  await asTenant(roleUrl('sf_m03_001_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_catalogue.offering (
         tenant_id, offering_id, canonical_service_id, offering_code, created_by
       ) VALUES ($1,$2,$3,'off-sec',$4)`,
      [T2, offT2, canonical, ACTOR],
    );
    await c.query(
      `INSERT INTO sf_catalogue.offering_version (
         tenant_id, offering_id, version_no, local_name, status, tags, valid_from, created_by
       ) VALUES ($1,$2,1,$3,'DRAFT','{}',now(),$4)`,
      [T2, offT2, CANARY.slice(0, 40), ACTOR],
    );
  });
  const leak001 = await asTenant(roleUrl('sf_m03_001_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT local_name FROM sf_catalogue.offering_version WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak001.count === 0 && !leak001.body.includes(CANARY),
    'TI.001.wrong_tenant_select',
    `count=${leak001.count}`,
    true,
  );

  // Pin INSERT on a FRESH transaction (no 25P02 from a prior abort)
  const offT1 = randomUUID();
  await asTenant(roleUrl('sf_m03_001_rt'), T1, async (c) => {
    await c.query(
      `INSERT INTO sf_catalogue.offering (
         tenant_id, offering_id, canonical_service_id, offering_code, created_by
       ) VALUES ($1,$2,$3,'off-pin',$4)`,
      [T1, offT1, canonical, ACTOR],
    );
    await c.query(
      `INSERT INTO sf_catalogue.offering_version (
         tenant_id, offering_id, version_no, local_name, status, tags, valid_from, created_by
       ) VALUES ($1,$2,1,'Draft','DRAFT','{}',now(),$3)`,
      [T1, offT1, ACTOR],
    );
  });
  let pinCode = 'none';
  try {
    await asTenant(roleUrl('sf_m03_001_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.offering_version (
           tenant_id, offering_id, version_no, local_name, status, tags, published_pin_ref, valid_from, created_by
         ) VALUES ($1,$2,2,'Pinned','DRAFT','{}','pin-1',now(),$3)`,
        [T1, offT1, ACTOR],
      );
    });
  } catch (e) {
    pinCode = e.code || e.message;
  }
  rec(pinCode === '42501', 'PUB.001.pin_insert_fresh_txn', `code=${pinCode}`);

  await expectDenied('PUB.001.offering_version_update', () =>
    asTenant(roleUrl('sf_m03_001_rt'), T1, async (c) => {
      await c.query(`UPDATE sf_catalogue.offering_version SET local_name = 'mutated'`);
    }),
  );

  // Published metadata immutable
  const docT1 = randomUUID();
  await asTenant(roleUrl('sf_m03_033_rt'), T1, async (c) => {
    await c.query(
      `INSERT INTO sf_metadata.metadata_document (
         document_id, tenant_id, cell_id, document_key, kind, schema_id, payload, payload_hash,
         status, created_by
       ) VALUES ($1,$2,'cell-01','generic.pub','SERVICE','sf.metadata.kind.service.v1',
                 '{"code":"generic_service","title":"x"}'::jsonb,$3,'DRAFT',$4)`,
      [docT1, T1, HASH, ACTOR],
    );
    await c.query(
      `UPDATE sf_metadata.metadata_document
          SET status = 'PUBLISHED', published_at = now()
        WHERE document_id = $1`,
      [docT1],
    );
  });
  await expectDenied('PUB.033.published_update', () =>
    asTenant(roleUrl('sf_m03_033_rt'), T1, async (c) => {
      await c.query(
        `UPDATE sf_metadata.metadata_document SET payload = '{"code":"generic_service","title":"y"}'::jsonb WHERE document_id = $1`,
        [docT1],
      );
    }),
  );

  // Published binding immutable
  const bindT1 = randomUUID();
  const verT1 = randomUUID();
  await asTenant(roleUrl('sf_m03_052_rt'), T1, async (c) => {
    await c.query(
      `INSERT INTO sf_versioning.tenant_service_binding (
         binding_id, tenant_id, cell_id, binding_key, offering_ref, metadata_bundle_ref,
         pins, dependency_graph, artifact_hash, status, created_by
       ) VALUES ($1,$2,'cell-01','generic.pub','off-1','bundle-1','{}'::jsonb,'{}'::jsonb,$3,'DRAFT',$4)`,
      [bindT1, T1, HASH, ACTOR],
    );
    await c.query(
      `INSERT INTO sf_versioning.artifact_version (
         version_id, tenant_id, cell_id, artifact_kind, artifact_key, version_no, content_hash,
         dependency_graph, source_binding_id, status, created_by, published_at
       ) VALUES ($1,$2,'cell-01','TENANT_SERVICE_BINDING','generic.pub',1,$3,'{}'::jsonb,$4,'PUBLISHED',$5,now())`,
      [verT1, T1, HASH, bindT1, ACTOR],
    );
    await c.query(
      `UPDATE sf_versioning.tenant_service_binding
          SET status = 'PUBLISHED', published_at = now(), published_version_id = $2
        WHERE binding_id = $1`,
      [bindT1, verT1],
    );
  });
  await expectDenied('PUB.052.published_binding_update', () =>
    asTenant(roleUrl('sf_m03_052_rt'), T1, async (c) => {
      await c.query(
        `UPDATE sf_versioning.tenant_service_binding SET offering_ref = 'mutated' WHERE binding_id = $1`,
        [bindT1],
      );
    }),
  );

  // Maker-checker approved immutable
  const reqT1 = randomUUID();
  await asTenant(roleUrl('sf_m03_051_rt'), T1, async (c) => {
    await c.query(
      `INSERT INTO sf_maker_checker.publication_request (
         request_id, tenant_id, cell_id, subject_type, subject_id, proposed_hash, status, maker_principal_id
       ) VALUES ($1,$2,'cell-01','TENANT_SERVICE_BINDING',$3,$4,'DRAFT',$5)`,
      [reqT1, T1, bindT1, HASH, ACTOR],
    );
    await c.query(
      `UPDATE sf_maker_checker.publication_request
          SET status = 'SUBMITTED', submitted_at = now()
        WHERE request_id = $1`,
      [reqT1],
    );
    await c.query(
      `UPDATE sf_maker_checker.publication_request
          SET status = 'APPROVED', checker_principal_id = $2, decided_at = now(), decision_reason = 'ok'
        WHERE request_id = $1`,
      [reqT1, CHECKER],
    );
  });
  await expectDenied('PUB.051.approved_update', () =>
    asTenant(roleUrl('sf_m03_051_rt'), T1, async (c) => {
      await c.query(
        `UPDATE sf_maker_checker.publication_request SET decision_reason = 'mutated' WHERE request_id = $1`,
        [reqT1],
      );
    }),
  );

  // Unset tenant fail-closed
  await withClient(roleUrl('sf_m03_052_rt'), async (c) => {
    const unset = await c.query(`SELECT binding_id FROM sf_versioning.tenant_service_binding`);
    rec(unset.rowCount === 0, 'TI.052.unset_tenant_zero', `n=${unset.rowCount}`, true);
  });
  await withClient(roleUrl('sf_m03_033_rt'), async (c) => {
    await c.query(`SELECT set_config('app.tenant_id', '', true)`);
    const r = await c.query(`SELECT count(*)::int AS n FROM sf_metadata.metadata_document`);
    rec(r.rows[0].n === 0, 'TI.033.unset_tenant_zero', `n=${r.rows[0].n}`, true);
  });
} finally {
  await admin.end();
}

const summary = {
  tip: TIP,
  task_id: 'SF-M03-SEC',
  pass: pass.length,
  fail: findings.length,
  CROSS_TENANT_LEAKAGE: leakageFindings.length,
  findings,
  leakage_findings: leakageFindings,
  assessed_at: new Date().toISOString(),
  certified: false,
  recommended_gate:
    findings.length === 0 && leakageFindings.length === 0 ? 'V1_SECURITY_PASS' : 'V1_SECURITY_FAIL',
};

const outDir = join(ROOT, 'evidence/security/m03');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'catalog-summary.json'), JSON.stringify(summary, null, 2));
say(
  JSON.stringify({
    CROSS_TENANT_LEAKAGE: summary.CROSS_TENANT_LEAKAGE,
    fail: summary.fail,
    pass: summary.pass,
  }),
);
if (findings.length > 0) process.exit(1);
