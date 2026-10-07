#!/usr/bin/env node
/**
 * SF-M05-SEC independent LOGIN-role security catalog.
 * Verifier-owned additive probe under tests/security/m05 — not product code.
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

const TIP = process.env.M05_SEC_TIP_SHA || 'unknown';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANARY = `CANARY-T2-${T2}`;
const HASH = `sha256:${'ab'.repeat(32)}`;
const pw = 'synth-m05-sec-not-a-secret-' + randomBytes(16).toString('hex');
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
  { id: 'CMP-015', login: 'sf_m05_015_rt', rw: 'sf_cmp015_rw', schema: 'sf_application_case' },
  { id: 'CMP-016', login: 'sf_m05_016_rt', rw: 'sf_cmp016_rw', schema: 'sf_workflow' },
  { id: 'CMP-017', login: 'sf_m05_017_rt', rw: 'sf_cmp017_rw', schema: 'sf_tasks' },
  { id: 'CMP-018', login: 'sf_m05_018_rt', rw: 'sf_cmp018_rw', schema: 'sf_inspection' },
  { id: 'CMP-019', login: 'sf_m05_019_rt', rw: 'sf_cmp019_rw', schema: 'sf_deficiency' },
  { id: 'CMP-027', login: 'sf_m05_027_rt', rw: 'sf_cmp027_rw', schema: 'sf_grievance' },
  { id: 'CMP-028', login: 'sf_m05_028_rt', rw: 'sf_cmp028_rw', schema: 'sf_appeal' },
  { id: 'CMP-029', login: 'sf_m05_029_rt', rw: 'sf_cmp029_rw', schema: 'sf_sla' },
];
const ALL_RW = COMPONENTS.map((c) => c.rw);
const COMPONENT_SCHEMAS = COMPONENTS.map((c) => c.schema);

const TENANT_SCOPED = new Set([
  'sf_application_case.application_case',
  'sf_application_case.case_request_reference',
  'sf_application_case.case_transition',
  'sf_application_case.idempotency_record',
  'sf_application_case.outbox_event',
  'sf_application_case.inbox_event',
  'sf_workflow.workflow_definition',
  'sf_workflow.workflow_version',
  'sf_workflow.migration_plan',
  'sf_workflow.workflow_instance',
  'sf_workflow.workflow_request',
  'sf_workflow.idempotency_record',
  'sf_workflow.outbox_event',
  'sf_workflow.inbox_event',
  'sf_tasks.human_task',
  'sf_tasks.task_history',
  'sf_tasks.idempotency_record',
  'sf_tasks.outbox_event',
  'sf_tasks.inbox_event',
  'sf_inspection.inspection',
  'sf_inspection.inspection_history',
  'sf_inspection.checklist_item',
  'sf_inspection.observation',
  'sf_inspection.evidence_ref',
  'sf_inspection.finding',
  'sf_inspection.idempotency_record',
  'sf_inspection.outbox_event',
  'sf_inspection.inbox_event',
  'sf_deficiency.deficiency_notice',
  'sf_deficiency.requested_item',
  'sf_deficiency.citizen_response',
  'sf_deficiency.evidence_ref',
  'sf_deficiency.deficiency_event',
  'sf_deficiency.idempotency_record',
  'sf_deficiency.outbox_event',
  'sf_deficiency.inbox_event',
  'sf_grievance.grievance',
  'sf_grievance.grievance_transition',
  'sf_grievance.grievance_response',
  'sf_grievance.assignment_request',
  'sf_grievance.ai_assist_record',
  'sf_grievance.idempotency_record',
  'sf_grievance.outbox_event',
  'sf_grievance.inbox_event',
  'sf_appeal.appeal',
  'sf_appeal.appeal_history',
  'sf_appeal.assist_note',
  'sf_appeal.idempotency_record',
  'sf_appeal.outbox_event',
  'sf_appeal.inbox_event',
  'sf_sla.sla_calendar',
  'sf_sla.sla_policy',
  'sf_sla.sla_clock',
  'sf_sla.sla_clock_event',
  'sf_sla.idempotency_record',
  'sf_sla.outbox_event',
  'sf_sla.inbox_event',
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
        sf_application_case.case_transition,
        sf_application_case.case_request_reference,
        sf_application_case.application_case,
        sf_application_case.idempotency_record,
        sf_workflow.workflow_request,
        sf_workflow.workflow_instance,
        sf_workflow.migration_plan,
        sf_workflow.workflow_version,
        sf_workflow.workflow_definition,
        sf_workflow.idempotency_record,
        sf_tasks.task_history,
        sf_tasks.human_task,
        sf_tasks.idempotency_record,
        sf_inspection.finding,
        sf_inspection.evidence_ref,
        sf_inspection.observation,
        sf_inspection.checklist_item,
        sf_inspection.inspection_history,
        sf_inspection.inspection,
        sf_inspection.idempotency_record,
        sf_deficiency.evidence_ref,
        sf_deficiency.citizen_response,
        sf_deficiency.requested_item,
        sf_deficiency.deficiency_event,
        sf_deficiency.deficiency_notice,
        sf_deficiency.idempotency_record,
        sf_grievance.ai_assist_record,
        sf_grievance.assignment_request,
        sf_grievance.grievance_response,
        sf_grievance.grievance_transition,
        sf_grievance.grievance,
        sf_grievance.idempotency_record,
        sf_appeal.assist_note,
        sf_appeal.appeal_history,
        sf_appeal.appeal,
        sf_appeal.idempotency_record,
        sf_sla.sla_clock_event,
        sf_sla.sla_clock,
        sf_sla.sla_policy,
        sf_sla.sla_calendar,
        sf_sla.idempotency_record
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

  let forceRlsEnable = 0;
  let forceRlsForce = 0;
  for (const t of tenantTables.rows) {
    const fq = `${t.nspname}.${t.relname}`;
    rec(t.owner === 'sf_migrator', `owner.${fq}`, `owner=${t.owner}`);
    if (TENANT_SCOPED.has(fq)) {
      rec(t.relrowsecurity, `rls.enable.${fq}`, `relrowsecurity=${t.relrowsecurity}`);
      rec(t.relforcerowsecurity, `rls.force.${fq}`, `relforcerowsecurity=${t.relforcerowsecurity}`);
      if (t.relrowsecurity) forceRlsEnable += 1;
      if (t.relforcerowsecurity) forceRlsForce += 1;
    }
  }
  rec(
    forceRlsForce === TENANT_SCOPED.size,
    'rls.force.count',
    `force=${forceRlsForce}/enable=${forceRlsEnable}/expected=${TENANT_SCOPED.size}`,
  );

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
  rec(pubPriv.rowCount === 0, 'public.table.acl.m05', `rows=${pubPriv.rowCount}`);

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
    'sf_app.no_authoritative_dml.m05',
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
      actor: 'sf_m05_015_rt',
      sql: `SELECT count(*) FROM sf_tasks.human_task`,
      id: 'XCOMP.015.select.017',
    },
    {
      actor: 'sf_m05_017_rt',
      sql: `SELECT count(*) FROM sf_application_case.application_case`,
      id: 'XCOMP.017.select.015',
    },
    {
      actor: 'sf_m05_019_rt',
      sql: `SELECT count(*) FROM sf_application_case.application_case`,
      id: 'XCOMP.019.select.015',
    },
    {
      actor: 'sf_m05_019_rt',
      sql: `SELECT count(*) FROM sf_sla.sla_clock`,
      id: 'XCOMP.019.select.029',
    },
    {
      actor: 'sf_m05_028_rt',
      sql: `SELECT count(*) FROM sf_application_case.application_case`,
      id: 'XCOMP.028.select.015',
    },
    {
      actor: 'sf_m05_016_rt',
      sql: `SELECT count(*) FROM sf_application_case.application_case`,
      id: 'XCOMP.016.select.015',
    },
    {
      actor: 'sf_m05_029_rt',
      sql: `SELECT count(*) FROM sf_deficiency.deficiency_notice`,
      id: 'XCOMP.029.select.019',
    },
    {
      actor: 'sf_m05_018_rt',
      sql: `SELECT count(*) FROM sf_appeal.appeal`,
      id: 'XCOMP.018.select.028',
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

  // --- CMP-015 case ---
  const app015 = randomUUID();
  const u = () => randomUUID();
  await asTenant(roleUrl('sf_m05_015_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_application_case.application_case (
         application_id, tenant_id, cell_id, service_id, applicant_id, state, aggregate_version,
         tenant_service_binding_id, form_version_id, rule_version_id, workflow_version_id,
         evidence_policy_version_id, sla_policy_version_id, pin_graph_hash, created_by, created_at,
         updated_at, last_correlation_id
       ) VALUES ($1,$2,'cell-01',$3,$4,'DRAFT',1,$5,$6,$7,$8,$9,$10,$11,$4,now(),now(),$12)`,
      [app015, T2, u(), ACTOR, u(), u(), u(), u(), u(), u(), HASH, u()],
    );
  });
  const leak015 = await asTenant(roleUrl('sf_m05_015_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT application_id FROM sf_application_case.application_case WHERE application_id = $1`,
      [app015],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak015.count === 0 && !leak015.body.includes(CANARY),
    'TI.015.wrong_tenant_select',
    `count=${leak015.count}`,
    true,
  );
  await expectDenied(
    'TI.015.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m05_015_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_application_case.application_case (
             application_id, tenant_id, cell_id, service_id, applicant_id, state, aggregate_version,
             tenant_service_binding_id, form_version_id, rule_version_id, workflow_version_id,
             evidence_policy_version_id, sla_policy_version_id, pin_graph_hash, created_by, created_at,
             updated_at, last_correlation_id
           ) VALUES ($1,$2,'cell-01',$3,$4,'DRAFT',1,$5,$6,$7,$8,$9,$10,$11,$4,now(),now(),$12)`,
          [randomUUID(), T2, u(), ACTOR, u(), u(), u(), u(), u(), u(), HASH, u()],
        );
      }),
    true,
  );
  const upd015 = await asTenant(roleUrl('sf_m05_015_rt'), T1, async (c) => {
    const r = await c.query(
      `UPDATE sf_application_case.application_case SET state = 'READY_TO_SUBMIT', aggregate_version = 2 WHERE application_id = $1`,
      [app015],
    );
    return r.rowCount ?? 0;
  });
  rec(upd015 === 0, 'TI.015.wrong_tenant_update', `rowCount=${upd015}`, true);

  // --- CMP-016 workflow definition ---
  const def016 = randomUUID();
  await asTenant(roleUrl('sf_m05_016_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_workflow.workflow_definition (definition_id, tenant_id, cell_id, definition_key, created_by)
       VALUES ($1,$2,'cell-01',$3,$4)`,
      [def016, T2, 'canary.m05.sec.probe', ACTOR],
    );
  });
  const leak016 = await asTenant(roleUrl('sf_m05_016_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT definition_id FROM sf_workflow.workflow_definition WHERE definition_id = $1`,
      [def016],
    );
    return { count: leaked.rowCount };
  });
  rec(leak016.count === 0, 'TI.016.wrong_tenant_select', `count=${leak016.count}`, true);

  // --- CMP-017 tasks ---
  const task017 = randomUUID();
  const app017 = randomUUID();
  const org017 = randomUUID();
  const jur017 = randomUUID();
  await asTenant(roleUrl('sf_m05_017_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_tasks.human_task (tenant_id, task_id, application_id, workflow_node_id, cell_id,
         task_state, role_code, organisation_id, jurisdiction_id, created_by, correlation_id)
       VALUES ($1,$2,$3,$4,'cell-01','OPEN','SCRUTINY_OFFICER',$5,$6,$7,$8)`,
      [T2, task017, app017, 'NODE1', org017, jur017, ACTOR, randomUUID()],
    );
  });
  const leak017 = await asTenant(roleUrl('sf_m05_017_rt'), T1, async (c) => {
    const leaked = await c.query(`SELECT task_id FROM sf_tasks.human_task WHERE task_id = $1`, [
      task017,
    ]);
    return { count: leaked.rowCount };
  });
  rec(leak017.count === 0, 'TI.017.wrong_tenant_select', `count=${leak017.count}`, true);

  // --- CMP-018 inspection ---
  const insp018 = randomUUID();
  await asTenant(roleUrl('sf_m05_018_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_inspection.inspection (tenant_id, inspection_id, application_id, workflow_node_id, cell_id,
         inspection_state, role_code, organisation_id, jurisdiction_id, created_by, correlation_id)
       VALUES ($1,$2,$3,$4,'cell-01','REQUESTED','INSPECTION_OFFICER',$5,$6,$7,$8)`,
      [T2, insp018, randomUUID(), 'INODE', org017, jur017, ACTOR, randomUUID()],
    );
  });
  const leak018 = await asTenant(roleUrl('sf_m05_018_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT inspection_id FROM sf_inspection.inspection WHERE inspection_id = $1`,
      [insp018],
    );
    return { count: leaked.rowCount };
  });
  rec(leak018.count === 0, 'TI.018.wrong_tenant_select', `count=${leak018.count}`, true);

  // --- CMP-019 deficiency ---
  const def019 = randomUUID();
  await asTenant(roleUrl('sf_m05_019_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_deficiency.deficiency_notice (
         tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
         instruction_ref, opened_at, opened_by, correlation_id
       ) VALUES ($1,$2,$3,'cell-01','OPEN','MISSING_PROOF','N1','ref:x',now(),$4,$5)`,
      [T2, def019, randomUUID(), ACTOR, randomUUID()],
    );
  });
  const leak019 = await asTenant(roleUrl('sf_m05_019_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT deficiency_id FROM sf_deficiency.deficiency_notice WHERE deficiency_id = $1`,
      [def019],
    );
    return { count: leaked.rowCount };
  });
  rec(leak019.count === 0, 'TI.019.wrong_tenant_select', `count=${leak019.count}`, true);
  await expectDenied(
    'TI.019.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m05_019_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_deficiency.deficiency_notice (
             tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
             instruction_ref, opened_at, opened_by, correlation_id
           ) VALUES ($1,$2,$3,'cell-01','OPEN','MISSING_PROOF','N2','ref:y',now(),$4,$5)`,
          [T2, randomUUID(), randomUUID(), ACTOR, randomUUID()],
        );
      }),
    true,
  );

  // --- CMP-027 grievance ---
  const g027 = randomUUID();
  const ref027 = `GF-${g027.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  await asTenant(roleUrl('sf_m05_027_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_grievance.grievance (
         grievance_id, tenant_id, cell_id, kind, status, aggregate_version, reference_code,
         filer_id, created_by, created_at, updated_at, last_correlation_id
       ) VALUES ($1,$2,'cell-01','GRIEVANCE','FILED',1,$3,$4,$4,now(),now(),$5)`,
      [g027, T2, ref027, ACTOR, randomUUID()],
    );
  });
  const leak027 = await asTenant(roleUrl('sf_m05_027_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT grievance_id FROM sf_grievance.grievance WHERE grievance_id = $1`,
      [g027],
    );
    return { count: leaked.rowCount };
  });
  rec(leak027.count === 0, 'TI.027.wrong_tenant_select', `count=${leak027.count}`, true);

  // --- CMP-028 appeal ---
  const a028 = randomUUID();
  await asTenant(roleUrl('sf_m05_028_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_appeal.appeal (
         tenant_id, appeal_id, original_application_id, cell_id, appeal_state, grounds_code,
         admissibility_code, role_code, organisation_id, jurisdiction_id, created_by, correlation_id
       ) VALUES ($1,$2,$3,'cell-01','FILED','PROCEDURAL_ERROR','PENDING','APPELLATE_AUTHORITY',$4,$5,$6,$7)`,
      [T2, a028, randomUUID(), org017, jur017, ACTOR, randomUUID()],
    );
  });
  const leak028 = await asTenant(roleUrl('sf_m05_028_rt'), T1, async (c) => {
    const leaked = await c.query(`SELECT appeal_id FROM sf_appeal.appeal WHERE appeal_id = $1`, [
      a028,
    ]);
    return { count: leaked.rowCount };
  });
  rec(leak028.count === 0, 'TI.028.wrong_tenant_select', `count=${leak028.count}`, true);
  await expectDenied(
    'TI.028.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m05_028_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_appeal.appeal (
             tenant_id, appeal_id, original_application_id, cell_id, appeal_state, grounds_code,
             admissibility_code, role_code, organisation_id, jurisdiction_id, created_by, correlation_id
           ) VALUES ($1,$2,$3,'cell-01','FILED','PROCEDURAL_ERROR','PENDING','APPELLATE_AUTHORITY',$4,$5,$6,$7)`,
          [T2, randomUUID(), randomUUID(), org017, jur017, ACTOR, randomUUID()],
        );
      }),
    true,
  );

  // --- CMP-029 SLA calendar ---
  const cal029 = randomUUID();
  await asTenant(roleUrl('sf_m05_029_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_sla.sla_calendar (tenant_id, calendar_id, calendar_code, version_no, utc_offset_minutes,
         working_weekdays, window_start_minute, window_end_minute, holidays, effective_from, created_by)
       VALUES ($1,$2,$3,1,0,'{1,2,3,4,5}',540,1020,'{}',now(),$4)`,
      [T2, cal029, 'CANARY_CAL', ACTOR],
    );
  });
  const leak029 = await asTenant(roleUrl('sf_m05_029_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT calendar_id FROM sf_sla.sla_calendar WHERE calendar_id = $1`,
      [cal029],
    );
    return { count: leaked.rowCount };
  });
  rec(leak029.count === 0, 'TI.029.wrong_tenant_select', `count=${leak029.count}`, true);

  // Unset tenant context → zero rows
  const unset015 = await withClient(roleUrl('sf_m05_015_rt'), async (c) => {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', '', true)`);
    const r = await c.query(`SELECT count(*)::int AS n FROM sf_application_case.application_case`);
    await c.query('ROLLBACK');
    return Number(r.rows[0].n);
  });
  rec(unset015 === 0, 'TI.015.unset_tenant', `n=${unset015}`, true);
} finally {
  await admin.end();
}

const summary = {
  tip: TIP,
  pass: pass.length,
  fail: findings.length,
  CROSS_TENANT_LEAKAGE: leakageFindings.length,
  SUPERUSER_findings: findings.filter((f) => f.id.includes('role.super')).length,
  BYPASSRLS_findings: findings.filter((f) => f.id.includes('role.bypass')).length,
  runtime_ownership_violations: findings.filter(
    (f) => f.id.includes('not_owner') || f.id.startsWith('owner.'),
  ).length,
  force_rls_enable_probes: pass.filter((p) => p.id.startsWith('rls.enable.')).length,
  force_rls_force_probes: pass.filter((p) => p.id.startsWith('rls.force.')).length,
  cross_tenant_probes: [...pass, ...findings].filter((p) => p.id.startsWith('TI.')).length,
  cross_component_sql_probes: [...pass, ...findings].filter((p) => p.id.startsWith('XCOMP.'))
    .length,
  findings,
  leakageFindings,
};

const outDir = join(ROOT, 'evidence/SF-M05-SEC/summary');
mkdirSync(outDir, { recursive: true });
mkdirSync(join(ROOT, 'evidence/security/m05'), { recursive: true });
writeFileSync(join(outDir, 'catalog-summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(
  join(ROOT, 'evidence/security/m05/catalog-summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
);

say(
  `SUMMARY pass=${summary.pass} fail=${summary.fail} CROSS_TENANT_LEAKAGE=${summary.CROSS_TENANT_LEAKAGE}`,
);
if (summary.fail > 0 || summary.CROSS_TENANT_LEAKAGE > 0) process.exit(1);
