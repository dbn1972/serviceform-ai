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
  // SF-M10-B-4: CMP-033 metadata, CMP-051 maker-checker, CMP-052 versioning
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
  SF_STUDIO_RATE_LIMIT_MAX: '3000',
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
