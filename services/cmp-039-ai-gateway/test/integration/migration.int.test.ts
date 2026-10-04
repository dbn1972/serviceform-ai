import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const TENANT_TABLES = [
  'model_registry',
  'ai_policy',
  'ai_request_metadata',
  'idempotency_record',
  'outbox_event',
  'inbox_event',
];

describe('CMP-039 migration', () => {
  it('creates sf_ai_gateway schema, NOLOGIN privilege role and FORCE RLS tables', async () => {
    const schema = await h.admin.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = 'sf_ai_gateway'`,
    );
    expect(schema.rowCount).toBe(1);
    const role = await h.admin.query(
      `SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sf_cmp039_rw'`,
    );
    expect(role.rows[0]?.['rolcanlogin']).toBe(false);
    expect(role.rows[0]?.['rolbypassrls']).toBe(false);
    expect(role.rows[0]?.['rolsuper']).toBe(false);

    const tables = await h.admin.query<{
      relname: string;
      rls: boolean;
      force: boolean;
      owner: string;
    }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_ai_gateway' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
      [TENANT_TABLES],
    );
    expect(tables.rowCount).toBe(TENANT_TABLES.length);
    for (const t of tables.rows) {
      expect(t.rls, t.relname).toBe(true);
      expect(t.force, t.relname).toBe(true);
      expect(t.owner, t.relname).toBe('sf_migrator');
    }
  });

  it('stores no raw prompt, output or tool-argument columns (metadata only)', async () => {
    const cols = await h.admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'sf_ai_gateway' AND table_name = 'ai_request_metadata'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    for (const forbidden of [
      'prompt',
      'prompt_text',
      'output',
      'output_text',
      'response',
      'tool_arguments',
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toEqual(
      expect.arrayContaining(['prompt_hash', 'policy_hash', 'tool_calls', 'redaction_summary']),
    );
  });
});
