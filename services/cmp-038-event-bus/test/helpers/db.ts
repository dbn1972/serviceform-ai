import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { RequestContext } from '@serviceform/contracts';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const APP_USER = 'sf_t004_app';
export const PUB_USER = 'sf_t004_pub';
export const PEER_USER = 'sf_t004_peer';
export const APP_ONLY = 'sf_t004_apponly';
export const PASS = 't004-local-only';
export const FIXTURE_A = 'sf_t004_a';
export const FIXTURE_B = 'sf_t004_b';

const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

export function urlAs(user: string, password: string): string {
  const u = new URL(databaseUrl());
  u.username = user;
  u.password = password;
  return u.toString();
}

export function migrate(direction: 'up' | 'down'): string {
  return execFileSync(
    'pnpm',
    [
      'exec',
      'node-pg-migrate',
      direction,
      '--migrations-dir',
      'migrations',
      '--migrations-table',
      'sf_schema_migrations',
      '--migrations-schema',
      'sf_platform',
      '--create-migrations-schema',
      '--check-order',
    ],
    { cwd: join(root, 'db'), encoding: 'utf8', env: process.env },
  );
}

export function adminPool(): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl(), max: 4 });
}

export function rolePool(user: string, max = 4): pg.Pool {
  return new pg.Pool({ connectionString: urlAs(user, PASS), max });
}

export function templateSql(schema: string): string {
  return readFileSync(join(root, 'contracts/shared/sql/outbox.template.sql'), 'utf8')
    .replaceAll('{schema}', schema)
    .replaceAll('{cmp}', 'CMP-038');
}

function assertRoleName(name: string): string {
  if (!ROLE_NAME.test(name)) throw new Error('invalid role name');
  return name;
}

export async function ensureRole(admin: pg.Pool, name: string, members: string[]): Promise<void> {
  const role = assertRoleName(name);
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()',
    [role],
  );
  await admin.query('DROP ROLE IF EXISTS ' + role);
  await admin.query(
    'CREATE ROLE ' +
      role +
      ' LOGIN PASSWORD $1 NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
    [PASS],
  );
  for (const m of members) {
    await admin.query('GRANT ' + assertRoleName(m) + ' TO ' + role);
  }
}

export async function ensureGroupRole(admin: pg.Pool, name: string): Promise<void> {
  const role = assertRoleName(name);
  await admin.query(
    'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ' +
      quoteLiteral(role) +
      ') THEN CREATE ROLE ' +
      role +
      ' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$;',
  );
}

function quoteLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

export function ctx(
  tenant: string | null,
  actorType: RequestContext['actor']['type'] = 'SYSTEM',
): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: actorType, id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
    roles: actorType === 'PRIVILEGED_ADMIN' ? ['PRIVILEGED_ADMIN'] : [],
    jurisdiction_ids: [],
    auth_assurance: actorType === 'PRIVILEGED_ADMIN' ? 'MFA' : 'WORKLOAD_IDENTITY',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  };
}

export function exampleEnvelope(tenant: string | null, eventId = crypto.randomUUID()) {
  return {
    event_id: eventId,
    event_type: 'ExampleAggregateCreated' as const,
    schema_version: 1,
    tenant_id: tenant,
    cell_id: 'cell-01',
    aggregate_type: 'ExampleAggregate',
    aggregate_id: eventId,
    aggregate_version: 1,
    occurred_at: '2026-10-03T09:00:00Z',
    correlation_id: eventId,
    actor: { type: 'SYSTEM' as const, id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
    data: {},
  };
}

export async function setupCmp038Roles(admin: pg.Pool): Promise<void> {
  await ensureGroupRole(admin, 'sf_cmp002_rw');
  await ensureGroupRole(admin, 'sf_cmp031_rw');
  await ensureGroupRole(admin, 'sf_cmp037_rw');
  await ensureGroupRole(admin, 'sf_cmp048_rw');
  await ensureRole(admin, APP_USER, ['sf_app', 'sf_cmp038_rw']);
  await ensureRole(admin, PUB_USER, ['sf_outbox_publisher']);
  await ensureRole(admin, PEER_USER, ['sf_app', 'sf_cmp002_rw']);
  await ensureRole(admin, APP_ONLY, ['sf_app']);
}

export async function setupFixtureSchema(admin: pg.Pool, schema: string): Promise<void> {
  await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  await admin.query('CREATE SCHEMA ' + schema);
  await admin.query(
    'GRANT USAGE ON SCHEMA ' + schema + ' TO sf_app, sf_outbox_publisher, sf_cmp002_rw',
  );
  await admin.query(templateSql(schema));
  await admin.query(
    'CREATE TABLE ' +
      schema +
      '.orders (tenant_id uuid NOT NULL, secret_note text NOT NULL); GRANT SELECT, INSERT, UPDATE, DELETE ON ' +
      schema +
      '.orders TO sf_cmp002_rw',
  );
}
