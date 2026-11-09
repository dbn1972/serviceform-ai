// SAMPLE_LAB platform host bootstrap (SF-M10-B-2). Local/CI only.
// Applies migrations with the admin DATABASE_URL, (re)creates one runtime LOGIN role per composed
// component (ADR-0006: sf_app + that component's _rw role only; NOSUPERUSER, NOBYPASSRLS) and writes
// a gitignored env file. Generated secrets are never printed.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const adminUrl = process.env.DATABASE_URL;
const environment = process.env.SF_ENVIRONMENT ?? 'LOCAL';
const outFile = resolve(process.env.SF_PLATFORM_LAB_ENV_FILE ?? join(ROOT, '.platform-lab/env'));
const opaUrl = process.env.SF_OPA_URL ?? 'http://127.0.0.1:8181';
const temporalAddress =
  process.env.SF_TEMPORAL_ADDRESS ?? `127.0.0.1:${process.env.SF_TEMPORAL_PORT ?? '7233'}`;

if (!adminUrl) {
  console.error('platform-lab-bootstrap: DATABASE_URL (admin) is required');
  process.exit(1);
}
if (!['LOCAL', 'CI'].includes(environment)) {
  console.error(`platform-lab-bootstrap: refused in ${environment} (SAMPLE_LAB is LOCAL/CI only)`);
  process.exit(1);
}

const ROLES = [
  { login: 'sf_lab_cmp004', member: 'sf_cmp004_rw', env: 'DATABASE_URL_CMP004' },
  { login: 'sf_lab_cmp009', member: 'sf_cmp009_rw', env: 'DATABASE_URL_CMP009' },
  { login: 'sf_lab_cmp015', member: 'sf_cmp015_rw', env: 'DATABASE_URL_CMP015' },
  { login: 'sf_lab_cmp016', member: 'sf_cmp016_rw', env: 'DATABASE_URL_CMP016' },
  { login: 'sf_lab_cmp022', member: 'sf_cmp022_rw', env: 'DATABASE_URL_CMP022' },
  { login: 'sf_lab_cmp024', member: 'sf_cmp024_rw', env: 'DATABASE_URL_CMP024' },
  { login: 'sf_lab_cmp012', member: 'sf_cmp012_rw', env: 'DATABASE_URL_CMP012' },
  { login: 'sf_lab_cmp005', member: 'sf_cmp005_rw', env: 'DATABASE_URL_CMP005' },
  { login: 'sf_lab_cmp030', member: 'sf_cmp030_rw', env: 'DATABASE_URL_CMP030' },
  // SF-M10-B-4: CMP-033 Metadata, CMP-051 Maker-Checker, CMP-052 Versioning
  { login: 'sf_lab_cmp033', member: 'sf_cmp033_rw', env: 'DATABASE_URL_CMP033' },
  { login: 'sf_lab_cmp051', member: 'sf_cmp051_rw', env: 'DATABASE_URL_CMP051' },
  { login: 'sf_lab_cmp052', member: 'sf_cmp052_rw', env: 'DATABASE_URL_CMP052' },
];

function previous() {
  if (!existsSync(outFile)) return {};
  return Object.fromEntries(
    readFileSync(outFile, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

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
  { cwd: join(ROOT, 'db'), stdio: ['ignore', 'ignore', 'inherit'], env: process.env },
);

const prior = previous();
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
const out = {
  SF_ENVIRONMENT: environment,
  SF_PLATFORM_LAB_DIR: join(ROOT, 'fixtures/lab/platform'),
  SF_OPA_URL: opaUrl,
  SF_OPA_TOKEN: 'pep',
  // CMP-016 sequencing (B-2c): Temporal dev server started by scripts/dev/platform-lab.sh.
  SF_TEMPORAL_ADDRESS: temporalAddress,
  SF_TEMPORAL_NAMESPACE: 'default',
  SF_TEMPORAL_TASK_QUEUE: process.env.SF_TEMPORAL_TASK_QUEUE ?? 'sf-sample-lab-workflow',
  // Lab-sized limits: all portal traffic reaches the host from the BFF address (one key per IP).
  SF_IDENTITY_RATE_LIMIT_MAX: '3000',
  SF_FORMS_RATE_LIMIT_MAX: '3000',
  SF_PROFILE_RATE_LIMIT_MAX: '3000',
  SF_GATEWAY_RATE_LIMIT_MAX: '20000',
  // A stable pepper keeps the same synthetic mobile mapped to the same citizen across restarts.
  SF_CMP004_PEPPER: prior.SF_CMP004_PEPPER ?? randomBytes(32).toString('hex'),
};
try {
  const base = new URL(adminUrl);
  for (const role of ROLES) {
    const password = randomBytes(18).toString('hex');
    // One guarded DO block (no CREATE ROLE IF NOT EXISTS in PostgreSQL): create or re-key the login.
    const built = await admin.query(
      `SELECT format(
         $f$DO $do$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %1$L) THEN
             ALTER ROLE %1$I LOGIN PASSWORD %2$L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
           ELSE
             CREATE ROLE %1$I LOGIN PASSWORD %2$L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
           END IF;
         END $do$$f$, $1::text, $2::text) AS s`,
      [role.login, password],
    );
    await admin.query(String(built.rows[0].s));
    const grant = await admin.query('SELECT format($1::text, $2::text, $3::text) AS s', [
      'GRANT sf_app, %I TO %I',
      role.member,
      role.login,
    ]);
    await admin.query(String(grant.rows[0].s));
    const url = new URL(base.href);
    url.username = role.login;
    url.password = password;
    out[role.env] = url.href;
  }
} finally {
  await admin.end();
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `${Object.entries(out)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`,
  { mode: 0o600 },
);
console.log(
  `platform-lab-bootstrap: migrations applied; ${ROLES.length} runtime logins; env written`,
);

// SF-M10-B-4: seed SAMPLE_LAB published TSB in CMP-052 so the host can resolve bindings
// through the in-process CMP-052 adapter (falls back to SimulatedPublishedBindingPort if absent).
// Idempotent: ON CONFLICT DO NOTHING. No PII. Synthetic UUIDs match published-bindings.json.
if (out['DATABASE_URL_CMP052']) {
  const { createHash } = await import('node:crypto');
  function sha256hex(s) {
    return createHash('sha256').update(s, 'utf8').digest('hex');
  }
  function syntheticContentHash(versionRef) {
    return `sha256:${sha256hex(`sample-lab:${versionRef}`)}`;
  }

  const TENANT_ID = '0d15ba00-0001-4000-8000-0d15ba0000d1';
  const BINDING_ID = '0d15ba00-0002-4000-8000-0d15ba0000d2';
  const SERVICE_ID = '0d15ba00-0003-4000-8000-0d15ba0000d3';
  const ARTIFACT_VERSION_ID = '0d15ba00-0052-4000-8000-0d15ba000052';
  const BINDING_KEY = 'ind-soc-002';
  const OFFERING_REF = SERVICE_ID;
  const METADATA_BUNDLE_REF = 'sample-lab/residence-certificate';

  const FIXTURE_PINS = {
    form_version_id: '0d15ba00-0010-4000-8000-0d15ba000010',
    rule_version_id: '0d15ba00-0011-4000-8000-0d15ba000011',
    workflow_version_id: '0d15ba00-0012-4000-8000-0d15ba000012',
    evidence_policy_version_id: '0d15ba00-0013-4000-8000-0d15ba000013',
    sla_policy_version_id: '0d15ba00-0014-4000-8000-0d15ba000014',
    fee_policy_version_id: '0d15ba00-0015-4000-8000-0d15ba000015',
    credential_template_version_id: '0d15ba00-0016-4000-8000-0d15ba000016',
    notification_version_id: '0d15ba00-0017-4000-8000-0d15ba000017',
    authorization_policy_version_id: '0d15ba00-0018-4000-8000-0d15ba000018',
  };

  // CMP-052 PinMap format: each pin key maps to { version_ref, content_hash }
  const pins = {
    service: { version_ref: SERVICE_ID, content_hash: syntheticContentHash(SERVICE_ID) },
    offering: { version_ref: BINDING_ID, content_hash: syntheticContentHash(BINDING_ID) },
    form: {
      version_ref: FIXTURE_PINS.form_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.form_version_id),
    },
    rules: {
      version_ref: FIXTURE_PINS.rule_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.rule_version_id),
    },
    workflow: {
      version_ref: FIXTURE_PINS.workflow_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.workflow_version_id),
    },
    evidence: {
      version_ref: FIXTURE_PINS.evidence_policy_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.evidence_policy_version_id),
    },
    sla: {
      version_ref: FIXTURE_PINS.sla_policy_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.sla_policy_version_id),
    },
    fee: {
      version_ref: FIXTURE_PINS.fee_policy_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.fee_policy_version_id),
    },
    credential: {
      version_ref: FIXTURE_PINS.credential_template_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.credential_template_version_id),
    },
    notification: {
      version_ref: FIXTURE_PINS.notification_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.notification_version_id),
    },
    authorization_policy: {
      version_ref: FIXTURE_PINS.authorization_policy_version_id,
      content_hash: syntheticContentHash(FIXTURE_PINS.authorization_policy_version_id),
    },
  };

  const graph = Object.entries(pins).map(([kind, v]) => ({
    kind,
    version_ref: v.version_ref,
    content_hash: v.content_hash,
  }));

  const graphStr = graph.map((n) => `${n.kind}:${n.version_ref}:${n.content_hash}`).join(',');
  const artifactHash = `sha256:${sha256hex([BINDING_KEY, OFFERING_REF, METADATA_BUNDLE_REF, graphStr].join('|'))}`;

  const cmp052Client = new pg.Client({ connectionString: out['DATABASE_URL_CMP052'] });
  try {
    await cmp052Client.connect();
    const now = new Date();

    // Insert artifact_version first (FK target)
    await cmp052Client.query(
      `INSERT INTO sf_versioning.artifact_version (
         version_id, tenant_id, cell_id, artifact_kind, artifact_key,
         version_no, content_hash, dependency_graph, source_binding_id,
         status, created_by, created_at, published_at
       ) VALUES ($1,$2,'cell-local','TENANT_SERVICE_BINDING',$3,1,$4,$5::jsonb,$6,'PUBLISHED','platform-lab-seed',$7,$7)
       ON CONFLICT (version_id) DO NOTHING`,
      [
        ARTIFACT_VERSION_ID, TENANT_ID, BINDING_KEY, artifactHash,
        JSON.stringify(graph), BINDING_ID, now,
      ],
    );

    // Insert TSB as PUBLISHED (idempotent)
    await cmp052Client.query(
      `INSERT INTO sf_versioning.tenant_service_binding (
         binding_id, tenant_id, cell_id, binding_key, offering_ref, metadata_bundle_ref,
         pins, dependency_graph, artifact_hash, status, published_version_id,
         created_by, created_at, updated_at, published_at
       ) VALUES ($1,$2,'cell-local',$3,$4,$5,$6::jsonb,$7::jsonb,$8,'PUBLISHED',$9,'platform-lab-seed',$10,$10,$10)
       ON CONFLICT (binding_id) DO NOTHING`,
      [
        BINDING_ID, TENANT_ID, BINDING_KEY, OFFERING_REF, METADATA_BUNDLE_REF,
        JSON.stringify(pins), JSON.stringify(graph), artifactHash,
        ARTIFACT_VERSION_ID, now,
      ],
    );
    console.log('platform-lab-bootstrap: CMP-052 SAMPLE_LAB TSB seeded (idempotent)');
  } catch (err) {
    console.warn('platform-lab-bootstrap: CMP-052 seed skipped (table may not exist yet):', err.message);
  } finally {
    await cmp052Client.end();
  }
}
