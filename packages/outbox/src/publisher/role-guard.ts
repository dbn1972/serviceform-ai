import type pg from 'pg';
import { OutboxError } from '../errors.js';

async function roleFlags(
  client: pg.PoolClient,
  who: 'session_user' | 'current_user',
): Promise<{ super: boolean; bypass: boolean; name: string }> {
  const r = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
    who === 'session_user'
      ? 'SELECT rolsuper, rolbypassrls, rolname FROM pg_roles WHERE rolname = session_user'
      : 'SELECT rolsuper, rolbypassrls, rolname FROM pg_roles WHERE rolname = current_user',
  );
  const row = r.rows[0];
  if (!row) return { super: true, bypass: true, name: who };
  return { super: row.rolsuper, bypass: row.rolbypassrls, name: row.rolname };
}

async function hasRole(client: pg.PoolClient, whoSql: string, role: string): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    'SELECT pg_has_role(' + whoSql + ', $1, $2) AS ok',
    [role, 'MEMBER'],
  );
  return r.rows[0]?.ok === true;
}

function isPoolClient(db: pg.Pool | pg.PoolClient): db is pg.PoolClient {
  return (
    typeof (db as pg.PoolClient).release === 'function' && typeof (db as pg.Pool).end !== 'function'
  );
}

/**
 * Relay may run only as a real login that is a member of sf_outbox_publisher.
 * No environment variable or option disables this check (P-004-1).
 */
export async function assertPublisherRole(db: pg.Pool | pg.PoolClient): Promise<void> {
  const owned = isPoolClient(db);
  const client = owned ? db : await db.connect();
  try {
    const session = await roleFlags(client, 'session_user');
    const current = await roleFlags(client, 'current_user');
    if (session.super || current.super) {
      throw new OutboxError('SF-SYS-001', { details: [{ code: 'ROLE_SUPERUSER' }] });
    }
    if (session.bypass || current.bypass) {
      throw new OutboxError('SF-SYS-001', { details: [{ code: 'ROLE_BYPASSRLS' }] });
    }
    if (await hasRole(client, 'session_user', 'sf_app')) {
      throw new OutboxError('SF-SYS-001', { details: [{ code: 'ROLE_SF_APP' }] });
    }
    if (await hasRole(client, 'current_user', 'sf_app')) {
      throw new OutboxError('SF-SYS-001', { details: [{ code: 'ROLE_SF_APP' }] });
    }
    const rw = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_roles r
         WHERE r.rolname LIKE 'sf_cmp%\\_rw' ESCAPE '\\'
           AND (
             pg_has_role(session_user, r.oid, 'MEMBER')
             OR pg_has_role(current_user, r.oid, 'MEMBER')
           )
       ) AS ok`,
    );
    if (rw.rows[0]?.ok) {
      throw new OutboxError('SF-SYS-001', { details: [{ code: 'ROLE_COMPONENT_RW' }] });
    }
    const pub =
      (await hasRole(client, 'session_user', 'sf_outbox_publisher')) &&
      (await hasRole(client, 'current_user', 'sf_outbox_publisher'));
    if (!pub) {
      throw new OutboxError('SF-SYS-001', { details: [{ code: 'ROLE_NOT_PUBLISHER' }] });
    }
    const owner = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         WHERE r.rolname IN (session_user, current_user)
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       ) AS ok`,
    );
    if (owner.rows[0]?.ok) {
      throw new OutboxError('SF-SYS-001', { details: [{ code: 'ROLE_TABLE_OWNER' }] });
    }
  } finally {
    if (!owned) client.release();
  }
}
