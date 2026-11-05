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
  // Lab-sized limits: all portal traffic reaches the host from the BFF address (one key per IP).
  SF_IDENTITY_RATE_LIMIT_MAX: '3000',
  SF_FORMS_RATE_LIMIT_MAX: '3000',
  SF_GATEWAY_RATE_LIMIT_MAX: '20000',
  // A stable pepper keeps the same synthetic mobile mapped to the same citizen across restarts.
  SF_CMP004_PEPPER: prior.SF_CMP004_PEPPER ?? randomBytes(32).toString('hex'),
};
try {
  const base = new URL(adminUrl);
  for (const role of ROLES) {
    const password = randomBytes(18).toString('hex');
    const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.login]);
    const ddl = exists.rowCount
      ? 'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT'
      : 'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT';
    const built = await admin.query('SELECT format($1::text, $2::text, $3::text) AS s', [
      ddl,
      role.login,
      password,
    ]);
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
