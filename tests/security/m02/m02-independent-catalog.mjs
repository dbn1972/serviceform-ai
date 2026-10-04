#!/usr/bin/env node
/**
 * SF-M02-SEC independent LOGIN-role security catalog.
 * Verifier-owned additive probe under tests/security/m02 — not product code.
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

const TIP = process.env.M02_SEC_TIP_SHA || 'unknown';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUBJECT_T2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CANARY = `CANARY-T2-${T2}`;
const HASH = 'ab'.repeat(32);
const HASH2 = 'cd'.repeat(32);
const pw = 'synth-m02-sec-not-a-secret-' + randomBytes(16).toString('hex');
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
  { id: 'CMP-004', login: 'sf_m02_004_rt', rw: 'sf_cmp004_rw', schema: 'sf_identity' },
  { id: 'CMP-005', login: 'sf_m02_005_rt', rw: 'sf_cmp005_rw', schema: 'sf_citizen_profile' },
];
const ALL_RW = COMPONENTS.map((c) => c.rw);
const COMPONENT_SCHEMAS = COMPONENTS.map((c) => c.schema);

const TENANT_SCOPED = new Set([
  'sf_identity.officer_principal',
  'sf_identity.officer_session',
  'sf_identity.idempotency_record',
  'sf_identity.outbox_event',
  'sf_identity.inbox_event',
  'sf_citizen_profile.citizen_profile',
  'sf_citizen_profile.profile_claim',
  'sf_citizen_profile.idempotency_record',
  'sf_citizen_profile.outbox_event',
  'sf_citizen_profile.inbox_event',
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
        sf_identity.inbox_event,
        sf_identity.inbox_event_platform,
        sf_identity.outbox_event,
        sf_identity.outbox_event_platform,
        sf_identity.idempotency_record,
        sf_identity.idempotency_record_platform,
        sf_identity.account_recovery,
        sf_identity.identity_link,
        sf_identity.citizen_session,
        sf_identity.citizen_otp_challenge,
        sf_identity.session_lookup,
        sf_identity.officer_session,
        sf_identity.officer_principal,
        sf_identity.citizen_principal,
        sf_citizen_profile.inbox_event,
        sf_citizen_profile.inbox_event_platform,
        sf_citizen_profile.outbox_event,
        sf_citizen_profile.outbox_event_platform,
        sf_citizen_profile.idempotency_record,
        sf_citizen_profile.idempotency_record_platform,
        sf_citizen_profile.profile_claim,
        sf_citizen_profile.citizen_profile
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
  rec(pubPriv.rowCount === 0, 'public.table.acl.m02', `rows=${pubPriv.rowCount}`);

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
    'sf_app.no_authoritative_dml.m02',
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
      actor: 'sf_m02_004_rt',
      sql: `SELECT count(*) FROM sf_citizen_profile.citizen_profile`,
      id: 'XCOMP.004.select.005',
    },
    {
      actor: 'sf_m02_005_rt',
      sql: `SELECT count(*) FROM sf_identity.officer_principal`,
      id: 'XCOMP.005.select.004',
    },
    {
      actor: 'sf_m02_004_rt',
      sql: `SELECT count(*) FROM sf_consent_privacy.purpose`,
      id: 'XCOMP.004.select.030',
    },
    {
      actor: 'sf_m02_005_rt',
      sql: `SELECT count(*) FROM sf_tenant_org.tenant`,
      id: 'XCOMP.005.select.002',
    },
    {
      actor: 'sf_m02_004_rt',
      sql: `SELECT count(*) FROM sf_identity.citizen_principal`,
      id: 'OWN.004.select.citizen_principal',
      expectAllow: true,
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
      if (p.expectAllow) rec(!failed, p.id, msg);
      else rec(failed, p.id, msg);
    });
  }

  await asTenant(roleUrl('sf_m02_004_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
       VALUES ($1,$2,$3,'ACTIVE')`,
      [T2, ACTOR, HASH2],
    );
  });
  const leak004 = await asTenant(roleUrl('sf_m02_004_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT idp_subject_hash FROM sf_identity.officer_principal WHERE tenant_id = $1`,
      [T2],
    );
    return { count: leaked.rowCount, body: JSON.stringify(leaked.rows) };
  });
  rec(
    leak004.count === 0 && !leak004.body.includes(CANARY) && !leak004.body.includes(HASH2),
    'TI.004.wrong_tenant_select',
    `count=${leak004.count}`,
    true,
  );
  await expectDenied(
    'TI.004.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m02_004_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
           VALUES ($1,$2,$3,'ACTIVE')`,
          [T2, randomUUID(), HASH],
        );
      }),
    true,
  );

  const profileT2 = randomUUID();
  await asTenant(roleUrl('sf_m02_005_rt'), T2, async (c) => {
    await c.query(
      `INSERT INTO sf_citizen_profile.citizen_profile (
         tenant_id, profile_id, subject_id, status, created_by
       ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
      [T2, profileT2, SUBJECT_T2, ACTOR],
    );
    await c.query(
      `INSERT INTO sf_citizen_profile.profile_claim (
         tenant_id, claim_id, profile_id, subject_id, section_code, claim_code,
         value_sha256, value_text, source_kind, verification_status, purpose_code
       ) VALUES ($1,$2,$3,$4,'IDENTITY','DISPLAY_NAME',$5,$6,'OFFICER','UNVERIFIED','PROFILE_ACCESS')`,
      [T2, randomUUID(), profileT2, SUBJECT_T2, `sha256:${HASH}`, CANARY.slice(0, 40)],
    );
  });
  const leak005 = await asTenant(roleUrl('sf_m02_005_rt'), T1, async (c) => {
    const leaked = await c.query(
      `SELECT profile_id, subject_id FROM sf_citizen_profile.citizen_profile WHERE tenant_id = $1`,
      [T2],
    );
    const claims = await c.query(
      `SELECT value_text FROM sf_citizen_profile.profile_claim WHERE tenant_id = $1`,
      [T2],
    );
    return {
      count: leaked.rowCount + claims.rowCount,
      body: JSON.stringify(leaked.rows) + JSON.stringify(claims.rows),
    };
  });
  rec(
    leak005.count === 0 && !leak005.body.includes(CANARY) && !leak005.body.includes(profileT2),
    'TI.005.wrong_tenant_select',
    `count=${leak005.count}`,
    true,
  );
  await expectDenied(
    'TI.005.wrong_tenant_insert',
    () =>
      asTenant(roleUrl('sf_m02_005_rt'), T1, async (c) => {
        await c.query(
          `INSERT INTO sf_citizen_profile.citizen_profile (
             tenant_id, profile_id, subject_id, status, created_by
           ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
          [T2, randomUUID(), randomUUID(), ACTOR],
        );
      }),
    true,
  );

  await expectDenied('XCOMP.005.insert.004', () =>
    asTenant(roleUrl('sf_m02_005_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
         VALUES ($1,$2,$3,'ACTIVE')`,
        [T1, randomUUID(), HASH],
      );
    }),
  );
  await expectDenied('XCOMP.004.insert.005', () =>
    asTenant(roleUrl('sf_m02_004_rt'), T1, async (c) => {
      await c.query(
        `INSERT INTO sf_citizen_profile.citizen_profile (
           tenant_id, profile_id, subject_id, status, created_by
         ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
        [T1, randomUUID(), randomUUID(), ACTOR],
      );
    }),
  );

  await withClient(roleUrl('sf_m02_004_rt'), async (c) => {
    const unset = await c.query(`SELECT officer_id FROM sf_identity.officer_principal`);
    rec(unset.rowCount === 0, 'TI.004.unset_tenant_zero', `n=${unset.rowCount}`, true);
  });
  await withClient(roleUrl('sf_m02_005_rt'), async (c) => {
    await c.query(`SELECT set_config('app.tenant_id', '', true)`);
    const r = await c.query(`SELECT count(*)::int AS n FROM sf_citizen_profile.citizen_profile`);
    rec(r.rows[0].n === 0, 'TI.005.unset_tenant_zero', `n=${r.rows[0].n}`, true);
  });

  await expectDenied('CLAIM.005.verified_downgrade_prep_denied_peer', () =>
    asTenant(roleUrl('sf_m02_004_rt'), T2, async (c) => {
      await c.query(
        `UPDATE sf_citizen_profile.profile_claim SET verification_status = 'UNVERIFIED'`,
      );
    }),
  );
} finally {
  await admin.end();
}

const summary = {
  tip: TIP,
  task_id: 'SF-M02-SEC',
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

const outDir = join(ROOT, 'evidence/security/m02');
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
