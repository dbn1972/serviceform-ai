#!/usr/bin/env node
/**
 * SF-M04-SEC independent LOGIN-role security catalog.
 * Verifier-owned additive probe under tests/security/m04 — not product code.
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

const TIP = process.env.M04_SEC_TIP_SHA || 'unknown';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANARY = `CANARY-T2-${T2}`;
const HASH = `sha256:${'ab'.repeat(32)}`;
const SHA = 'ab'.repeat(32);
const pw = 'synth-m04-sec-not-a-secret-' + randomBytes(16).toString('hex');
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
  { id: 'CMP-039', login: 'sf_m04_039_rt', rw: 'sf_cmp039_rw', schema: 'sf_ai_gateway' },
  { id: 'CMP-008', login: 'sf_m04_008_rt', rw: 'sf_cmp008_rw', schema: 'sf_rules' },
  { id: 'CMP-011', login: 'sf_m04_011_rt', rw: 'sf_cmp011_rw', schema: 'sf_evidence' },
  { id: 'CMP-013', login: 'sf_m04_013_rt', rw: 'sf_cmp013_rw', schema: 'sf_upload' },
  { id: 'CMP-009', login: 'sf_m04_009_rt', rw: 'sf_cmp009_rw', schema: 'sf_forms' },
  { id: 'CMP-014', login: 'sf_m04_014_rt', rw: 'sf_cmp014_rw', schema: 'sf_docintel' },
];
const ALL_RW = COMPONENTS.map((c) => c.rw);
const COMPONENT_SCHEMAS = COMPONENTS.map((c) => c.schema);

const TENANT_SCOPED = new Set([
  'sf_ai_gateway.model_registry',
  'sf_ai_gateway.ai_policy',
  'sf_ai_gateway.ai_request_metadata',
  'sf_ai_gateway.idempotency_record',
  'sf_ai_gateway.outbox_event',
  'sf_ai_gateway.inbox_event',
  'sf_rules.rule_pack_snapshot',
  'sf_rules.evaluation_record',
  'sf_rules.idempotency_record',
  'sf_rules.outbox_event',
  'sf_rules.inbox_event',
  'sf_evidence.evidence_policy',
  'sf_evidence.evidence_resolution',
  'sf_evidence.idempotency_record',
  'sf_evidence.outbox_event',
  'sf_evidence.inbox_event',
  'sf_upload.upload_policy',
  'sf_upload.document_metadata',
  'sf_upload.upload_session',
  'sf_upload.document_scan_status',
  'sf_upload.idempotency_record',
  'sf_upload.outbox_event',
  'sf_upload.inbox_event',
  'sf_forms.form_definition_snapshot',
  'sf_forms.form_execution_record',
  'sf_forms.idempotency_record',
  'sf_forms.outbox_event',
  'sf_forms.inbox_event',
  'sf_docintel.extraction_policy',
  'sf_docintel.intelligence_job',
  'sf_docintel.idempotency_record',
  'sf_docintel.outbox_event',
  'sf_docintel.inbox_event',
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
        sf_ai_gateway.ai_request_metadata,
        sf_ai_gateway.ai_policy,
        sf_ai_gateway.model_registry,
        sf_ai_gateway.idempotency_record,
        sf_ai_gateway.outbox_event,
        sf_ai_gateway.inbox_event,
        sf_rules.evaluation_record,
        sf_rules.rule_pack_snapshot,
        sf_rules.idempotency_record,
        sf_evidence.evidence_resolution,
        sf_evidence.evidence_policy,
        sf_evidence.idempotency_record,
        sf_upload.document_scan_status,
        sf_upload.upload_session,
        sf_upload.document_metadata,
        sf_upload.upload_policy,
        sf_upload.idempotency_record,
        sf_forms.form_execution_record,
        sf_forms.form_definition_snapshot,
        sf_forms.idempotency_record,
        sf_docintel.intelligence_job,
        sf_docintel.extraction_policy,
        sf_docintel.idempotency_record
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

  let forceRlsCount = 0;
  for (const t of tenantTables.rows) {
    const fq = `${t.nspname}.${t.relname}`;
    rec(t.owner === 'sf_migrator', `owner.${fq}`, `owner=${t.owner}`);
    if (TENANT_SCOPED.has(fq)) {
      rec(t.relrowsecurity, `rls.enable.${fq}`, `relrowsecurity=${t.relrowsecurity}`);
      rec(t.relforcerowsecurity, `rls.force.${fq}`, `relforcerowsecurity=${t.relforcerowsecurity}`);
      if (t.relforcerowsecurity) forceRlsCount += 1;
    }
  }
  rec(forceRlsCount === TENANT_SCOPED.size, 'rls.force.count', `force=${forceRlsCount}`);

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
  rec(pubPriv.rowCount === 0, 'public.table.acl.m04', `rows=${pubPriv.rowCount}`);

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
    'sf_app.no_authoritative_dml.m04',
    sfAppDml.rows.map((r) => `${r.nspname}.${r.relname}:${r.privilege_type}`).join(', ') || 'none',
  );

  const statutoryCols = await admin.query(
    `
    SELECT n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1::text[])
       AND pg_get_constraintdef(con.oid) ILIKE '%statutory_decision%'
  `,
    [COMPONENT_SCHEMAS],
  );
  rec(
    statutoryCols.rowCount >= 2,
    'statutory.check.present',
    `constraints=${statutoryCols.rowCount}`,
  );
  for (const row of statutoryCols.rows) {
    rec(
      /NOT\s+statutory_decision/i.test(row.def),
      `statutory.check.${row.nspname}.${row.relname}`,
      row.def.slice(0, 120),
    );
  }

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
      actor: 'sf_m04_039_rt',
      sql: `SELECT count(*) FROM sf_rules.rule_pack_snapshot`,
      id: 'XCOMP.039.select.008',
    },
    {
      actor: 'sf_m04_008_rt',
      sql: `SELECT count(*) FROM sf_ai_gateway.model_registry`,
      id: 'XCOMP.008.select.039',
    },
    {
      actor: 'sf_m04_011_rt',
      sql: `SELECT count(*) FROM sf_upload.document_metadata`,
      id: 'XCOMP.011.select.013',
    },
    {
      actor: 'sf_m04_013_rt',
      sql: `SELECT count(*) FROM sf_evidence.evidence_policy`,
      id: 'XCOMP.013.select.011',
    },
    {
      actor: 'sf_m04_009_rt',
      sql: `SELECT count(*) FROM sf_docintel.intelligence_job`,
      id: 'XCOMP.009.select.014',
    },
    {
      actor: 'sf_m04_014_rt',
      sql: `SELECT count(*) FROM sf_forms.form_definition_snapshot`,
      id: 'XCOMP.014.select.009',
    },
    {
      actor: 'sf_m04_014_rt',
      sql: `SELECT count(*) FROM sf_ai_gateway.ai_request_metadata`,
      id: 'XCOMP.014.select.039',
    },
    {
      actor: 'sf_m04_039_rt',
      sql: `SELECT count(*) FROM sf_docintel.extraction_policy`,
      id: 'XCOMP.039.select.014',
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

  // --- CMP-008 rules ---
  const snap008 = randomUUID();
  await asTenant(roleUrl('sf_m04_008_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_rules.rule_pack_snapshot (
         snapshot_id, tenant_id, cell_id, pack_key, content_hash, payload_digest, payload, created_by
       ) VALUES ($1,$2,'cell-01','canary.pack',$3,$3,$4::jsonb,$5)`,
      [snap008, T2, HASH, JSON.stringify({ note: CANARY }), ACTOR],
    );
  });
  const leak008 = await asTenant(roleUrl('sf_m04_008_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT payload FROM sf_rules.rule_pack_snapshot WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak008.count === 0 && !leak008.body.includes(CANARY),
    'TI.008.wrong_tenant_select',
    `count=${leak008.count}`,
    true,
  );
  await expectDenied(
    'TI.008.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m04_008_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_rules.rule_pack_snapshot (
             snapshot_id, tenant_id, cell_id, pack_key, content_hash, payload_digest, payload, created_by
           ) VALUES ($1,$2,'cell-01','forged.pack',$3,$3,'{}'::jsonb,$4)`,
          [randomUUID(), T2, HASH, ACTOR],
        );
      }),
    true,
  );

  // --- CMP-009 forms ---
  const snap009 = randomUUID();
  await asTenant(roleUrl('sf_m04_009_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_forms.form_definition_snapshot (
         snapshot_id, tenant_id, cell_id, form_key, content_hash, payload_digest, payload, created_by
       ) VALUES ($1,$2,'cell-01','canary.form',$3,$3,$4::jsonb,$5)`,
      [snap009, T2, HASH, JSON.stringify({ note: CANARY }), ACTOR],
    );
  });
  const leak009 = await asTenant(roleUrl('sf_m04_009_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT form_key FROM sf_forms.form_definition_snapshot WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(leak009.count === 0, 'TI.009.wrong_tenant_select', `count=${leak009.count}`, true);

  // --- CMP-011 evidence ---
  const pol011 = randomUUID();
  await asTenant(roleUrl('sf_m04_011_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_evidence.evidence_policy (
         policy_id, tenant_id, cell_id, policy_key, status, definition, content_hash, created_by
       ) VALUES ($1,$2,'cell-01','canary.policy','DRAFT',$3::jsonb,$4,$5)`,
      [pol011, T2, JSON.stringify({ note: CANARY }), HASH, ACTOR],
    );
  });
  const leak011 = await asTenant(roleUrl('sf_m04_011_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT policy_id FROM sf_evidence.evidence_policy WHERE policy_id = $1`,
      [pol011],
    );
    return { count: leaked.rowCount };
  });
  rec(leak011.count === 0, 'TI.011.wrong_tenant_select', `count=${leak011.count}`, true);
  // Wrong-tenant UPDATE is denied by FORCE RLS as zero matching rows (not an exception).
  const upd011 = await asTenant(roleUrl('sf_m04_011_rt'), T1, async (c) => {
    const r = await c.query(
      `UPDATE sf_evidence.evidence_policy SET definition = '{"mutated":true}'::jsonb WHERE policy_id = $1`,
      [pol011],
    );
    return r.rowCount ?? 0;
  });
  const still011 = await asTenant(roleUrl('sf_m04_011_rt'), T2, async (c) => {
    const r = await c.query(
      `SELECT definition FROM sf_evidence.evidence_policy WHERE policy_id = $1`,
      [pol011],
    );
    return r.rows[0]?.definition;
  });
  rec(
    upd011 === 0 && JSON.stringify(still011).includes(CANARY),
    'TI.011.wrong_tenant_update',
    `updated=${upd011}`,
    true,
  );

  // --- CMP-013 upload ---
  const pol013 = randomUUID();
  const doc013 = randomUUID();
  await asTenant(roleUrl('sf_m04_013_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_upload.upload_policy (
         tenant_id, policy_id, policy_code, version_no, status, allowed_content_types,
         max_bytes, session_ttl_seconds, max_scan_attempts, classification, created_by
       ) VALUES ($1,$2,'P_CANARY',1,'ACTIVE','{application/pdf}',1000,900,2,'CITIZEN_PRIVATE',$3)`,
      [T2, pol013, ACTOR],
    );
    await c.query(
      `INSERT INTO sf_upload.document_metadata (
         tenant_id, document_id, cell_id, policy_id, classification, owner_actor_id, owner_actor_type,
         declared_content_type, declared_byte_size, declared_checksum_sha256, object_ref,
         storage_mode, storage_simulation, status
       ) VALUES ($1,$2,'cell-01',$3,'CITIZEN_PRIVATE',$4,'CITIZEN','application/pdf',10,$5,$6,
                 'SIMULATED',$7::jsonb,'PENDING_UPLOAD')`,
      [
        T2,
        doc013,
        pol013,
        ACTOR,
        SHA,
        `t/${T2}/c/cell-01/o/${doc013}/${SHA.slice(0, 12)}`,
        JSON.stringify({ simulation: true, note: CANARY }),
      ],
    );
  });
  const leak013 = await asTenant(roleUrl('sf_m04_013_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT storage_simulation FROM sf_upload.document_metadata WHERE document_id = $1`,
      [doc013],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak013.count === 0 && !leak013.body.includes(CANARY),
    'TI.013.wrong_tenant_select',
    `count=${leak013.count}`,
    true,
  );
  await expectDenied(
    'TI.013.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m04_013_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_upload.upload_policy (
             tenant_id, policy_id, policy_code, version_no, status, allowed_content_types,
             max_bytes, session_ttl_seconds, max_scan_attempts, classification, created_by
           ) VALUES ($1,$2,'P_FORGED',1,'ACTIVE','{application/pdf}',1000,900,2,'CITIZEN_PRIVATE',$3)`,
          [T2, randomUUID(), ACTOR],
        );
      }),
    true,
  );
  await expectDenied('TI.013.traversal_object_ref', () =>
    asTenant(roleUrl('sf_m04_013_rt'), T1, async (c) => {
      const pid = randomUUID();
      await c.query(
        `INSERT INTO sf_upload.upload_policy (
             tenant_id, policy_id, policy_code, version_no, status, allowed_content_types,
             max_bytes, session_ttl_seconds, max_scan_attempts, classification, created_by
           ) VALUES ($1,$2,'P_TRAV',1,'ACTIVE','{application/pdf}',1000,900,2,'CITIZEN_PRIVATE',$3)`,
        [T1, pid, ACTOR],
      );
      await c.query(
        `INSERT INTO sf_upload.document_metadata (
             tenant_id, document_id, cell_id, policy_id, classification, owner_actor_id, owner_actor_type,
             declared_content_type, declared_byte_size, declared_checksum_sha256, object_ref,
             storage_mode, status
           ) VALUES ($1,$2,'cell-01',$3,'CITIZEN_PRIVATE',$4,'CITIZEN','application/pdf',10,$5,
                     '../etc/passwd','SIMULATED','PENDING_UPLOAD')`,
        [T1, randomUUID(), pid, ACTOR, SHA],
      );
    }),
  );

  // --- CMP-014 docintel ---
  const pol014 = randomUUID();
  const job014 = randomUUID();
  await asTenant(roleUrl('sf_m04_014_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_docintel.extraction_policy (
         tenant_id, policy_id, policy_code, version_no, status, allowed_content_types,
         min_confidence, max_excerpt_chars, gateway_policy_id, gateway_policy_version,
         latency_budget_ms, created_by
       ) VALUES ($1,$2,'P_CANARY',1,'ACTIVE','{application/pdf}',0.8,1000,'extract-fields',1,4000,$3)`,
      [T2, pol014, ACTOR],
    );
    await c.query(
      `INSERT INTO sf_docintel.intelligence_job (
         tenant_id, job_id, cell_id, policy_id, source_document_id, source_checksum_sha256,
         source_content_type, purpose, data_classification, status, ocr_mode, simulation
       ) VALUES ($1,$2,'cell-01',$3,$4,$5,'application/pdf','assistive extraction','INTERNAL',
                 'ACCEPTED','SIMULATED',$6::jsonb)`,
      [
        T2,
        job014,
        pol014,
        randomUUID(),
        SHA,
        JSON.stringify({
          simulation: true,
          scenario: 'ocr_simulated',
          test_run_id: 'm04-sec',
          connector_binding_id: '01401401-4014-4014-8014-014014014014',
          environment: 'CI',
          note: CANARY,
        }),
      ],
    );
  });
  const leak014 = await asTenant(roleUrl('sf_m04_014_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT simulation FROM sf_docintel.intelligence_job WHERE job_id = $1`,
      [job014],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak014.count === 0 && !leak014.body.includes(CANARY),
    'TI.014.wrong_tenant_select',
    `count=${leak014.count}`,
    true,
  );
  await expectDenied('TI.014.statutory_true', () =>
    asTenant(roleUrl('sf_m04_014_rt'), T1, async (c) => {
      const pid = randomUUID();
      await c.query(
        `INSERT INTO sf_docintel.extraction_policy (
             tenant_id, policy_id, policy_code, version_no, status, allowed_content_types,
             min_confidence, max_excerpt_chars, gateway_policy_id, gateway_policy_version,
             latency_budget_ms, created_by
           ) VALUES ($1,$2,'P_STAT',1,'ACTIVE','{application/pdf}',0.8,1000,'extract-fields',1,4000,$3)`,
        [T1, pid, ACTOR],
      );
      await c.query(
        `INSERT INTO sf_docintel.intelligence_job (
             tenant_id, job_id, cell_id, policy_id, source_document_id, source_checksum_sha256,
             source_content_type, purpose, data_classification, status, ocr_mode, simulation,
             statutory_decision
           ) VALUES ($1,$2,'cell-01',$3,$4,$5,'application/pdf','assistive','INTERNAL','ACCEPTED',
                     'SIMULATED',$6::jsonb,true)`,
        [
          T1,
          randomUUID(),
          pid,
          randomUUID(),
          SHA,
          JSON.stringify({
            simulation: true,
            scenario: 'ocr_simulated',
            test_run_id: 'm04-sec',
            connector_binding_id: '01401401-4014-4014-8014-014014014014',
            environment: 'CI',
          }),
        ],
      );
    }),
  );

  // --- CMP-039 AI gateway ---
  const model039 = randomUUID();
  await asTenant(roleUrl('sf_m04_039_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_ai_gateway.model_registry (
         model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
         max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
       ) VALUES ($1,$2,'cell-01','sim-primary','canary-model','v1',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`,
      [model039, T2, ACTOR],
    );
  });
  const leak039 = await asTenant(roleUrl('sf_m04_039_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT model_id FROM sf_ai_gateway.model_registry WHERE model_entry_id = $1`,
      [model039],
    );
    return { count: leaked.rowCount };
  });
  rec(leak039.count === 0, 'TI.039.wrong_tenant_select', `count=${leak039.count}`, true);
  await expectDenied(
    'TI.039.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m04_039_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_ai_gateway.model_registry (
             model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
             max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
           ) VALUES ($1,$2,'cell-01','sim-primary','forged','v1',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`,
          [randomUUID(), T2, ACTOR],
        );
      }),
    true,
  );
  await expectDenied('TI.039.statutory_task_kind', () =>
    asTenant(roleUrl('sf_m04_039_rt'), T1, async (c) => {
      const mid = randomUUID();
      await c.query(
        `INSERT INTO sf_ai_gateway.model_registry (
             model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
             max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
           ) VALUES ($1,$2,'cell-01','sim-primary','m-stat','v1',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`,
        [mid, T1, ACTOR],
      );
      await c.query(
        `INSERT INTO sf_ai_gateway.ai_policy (
             tenant_id, cell_id, policy_id, policy_version, task_kind, operation, template_body, template_hash,
             variable_names, allowed_tools, model_entry_ids, max_data_classification, max_output_tokens,
             latency_budget_ms, fallback_behavior, evaluation_ref, status, registered_by
           ) VALUES ($1,'cell-01','decide-all',1,'ELIGIBILITY_DECISION','INVOKE','x',$2,'{}','[]',ARRAY[$3::uuid],
             'INTERNAL',10,500,'DENY','{"dataset_id":"d","dataset_version":"1","threshold":0.9,"result":"PASSED"}','ACTIVE',$4)`,
        [T1, HASH, mid, ACTOR],
      );
    }),
  );
  await expectDenied('TI.039.floating_latest_pin', () =>
    asTenant(roleUrl('sf_m04_039_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_ai_gateway.model_registry (
             model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
             max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
           ) VALUES ($1,$2,'cell-01','sim-primary','m2','latest',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`,
        [randomUUID(), T1, ACTOR],
      );
    }),
  );

  // Unset tenant fail-closed
  await withClient(roleUrl('sf_m04_039_rt'), async (c) => {
    const unset = await c.query(`SELECT model_entry_id FROM sf_ai_gateway.model_registry`);
    rec(unset.rowCount === 0, 'TI.039.unset_tenant_zero', `n=${unset.rowCount}`, true);
  });
  await withClient(roleUrl('sf_m04_013_rt'), async (c) => {
    await c.query(`SELECT set_config('app.tenant_id', '', true)`);
    const r = await c.query(`SELECT count(*)::int AS n FROM sf_upload.document_metadata`);
    rec(r.rows[0].n === 0, 'TI.013.unset_tenant_zero', `n=${r.rows[0].n}`, true);
  });
  await withClient(roleUrl('sf_m04_008_rt'), async (c) => {
    const r = await c.query(`SELECT count(*)::int AS n FROM sf_rules.rule_pack_snapshot`);
    rec(r.rows[0].n === 0, 'TI.008.unset_tenant_zero', `n=${r.rows[0].n}`, true);
  });
} finally {
  await admin.end();
}

const summary = {
  tip: TIP,
  task_id: 'SF-M04-SEC',
  production_base: 'afc8e253d4c566a4a18b1e01d9b0a1163f9d6adf',
  production_code_modified: false,
  pass: pass.length,
  fail: findings.length,
  CROSS_TENANT_LEAKAGE: leakageFindings.length,
  SUPERUSER: findings.filter((f) => f.id.startsWith('role.super.')).length,
  BYPASSRLS: findings.filter((f) => f.id.startsWith('role.bypass.')).length,
  findings,
  leakage_findings: leakageFindings,
  assessed_at: new Date().toISOString(),
  certified: false,
  recommended_gate:
    findings.length === 0 && leakageFindings.length === 0 ? 'V1_SECURITY_PASS' : 'V1_SECURITY_FAIL',
};

const outDir = join(ROOT, 'evidence/security/m04');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'catalog-summary.json'), JSON.stringify(summary, null, 2));
say(
  JSON.stringify({
    CROSS_TENANT_LEAKAGE: summary.CROSS_TENANT_LEAKAGE,
    fail: summary.fail,
    pass: summary.pass,
    SUPERUSER: summary.SUPERUSER,
    BYPASSRLS: summary.BYPASSRLS,
  }),
);
if (findings.length > 0) process.exit(1);
