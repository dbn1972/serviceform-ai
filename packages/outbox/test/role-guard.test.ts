import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { assertPublisherRole } from '../src/publisher/role-guard.js';

interface RoleState {
  sessionSuper?: boolean;
  currentSuper?: boolean;
  sessionBypass?: boolean;
  currentBypass?: boolean;
  emptyFlags?: boolean;
  sessionApp?: boolean;
  currentApp?: boolean;
  componentRw?: boolean;
  publisher?: boolean;
  owner?: boolean;
}

function clientFor(state: RoleState): pg.PoolClient {
  return {
    release: () => undefined,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('relowner')) {
        return { rows: [{ ok: state.owner === true }] };
      }
      if (state.emptyFlags && sql.includes('pg_roles') && !sql.includes('LIKE')) {
        return { rows: [] };
      }
      if (
        sql.includes('pg_roles') &&
        sql.includes('session_user') &&
        !sql.includes('pg_has_role')
      ) {
        return {
          rows: [
            {
              rolsuper: state.sessionSuper === true,
              rolbypassrls: state.sessionBypass === true,
              rolname: 'sess',
            },
          ],
        };
      }
      if (
        sql.includes('pg_roles') &&
        sql.includes('current_user') &&
        !sql.includes('pg_has_role')
      ) {
        return {
          rows: [
            {
              rolsuper: state.currentSuper === true,
              rolbypassrls: state.currentBypass === true,
              rolname: 'curr',
            },
          ],
        };
      }
      if (sql.includes('pg_has_role')) {
        const role = params?.[0];
        if (role === 'sf_app') {
          const who = sql.includes('session_user') ? state.sessionApp : state.currentApp;
          return { rows: [{ ok: who === true }] };
        }
        if (role === 'sf_outbox_publisher') {
          return { rows: [{ ok: state.publisher === true }] };
        }
        return { rows: [{ ok: false }] };
      }
      if (sql.includes('sf_cmp')) {
        return { rows: [{ ok: state.componentRw === true }] };
      }
      if (sql.includes('relowner')) {
        return { rows: [{ ok: state.owner === true }] };
      }
      return { rows: [{ ok: false }] };
    },
  } as unknown as pg.PoolClient;
}

function poolFor(state: RoleState): pg.Pool {
  const c = clientFor(state);
  return {
    connect: async () => c,
  } as unknown as pg.Pool;
}

describe('assertPublisherRole', () => {
  it('accepts a publisher login via Pool and PoolClient', async () => {
    const ok: RoleState = { publisher: true };
    await expect(assertPublisherRole(poolFor(ok))).resolves.toBeUndefined();
    await expect(assertPublisherRole(clientFor(ok))).resolves.toBeUndefined();
  });

  it('refuses superuser, bypassrls, sf_app, component rw, missing publisher, and owners', async () => {
    await expect(assertPublisherRole(poolFor({ sessionSuper: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    await expect(assertPublisherRole(poolFor({ currentSuper: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    await expect(assertPublisherRole(poolFor({ sessionBypass: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    await expect(assertPublisherRole(poolFor({ currentBypass: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    await expect(assertPublisherRole(poolFor({ sessionApp: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    await expect(assertPublisherRole(poolFor({ currentApp: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    await expect(assertPublisherRole(poolFor({ componentRw: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
    await expect(assertPublisherRole(poolFor({}))).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await expect(
      assertPublisherRole(poolFor({ publisher: true, owner: true })),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await expect(assertPublisherRole(poolFor({ emptyFlags: true }))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
  });
});
