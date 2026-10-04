import { afterAll, describe, expect, it } from 'vitest';
import { adminClient, downCountThroughCmp048, migrate } from './helpers.js';

describe('migration round trip (D13)', () => {
  it('up / down / up leaves sf_security and sf_cmp048_rw', async () => {
    migrate('up');
    const c = await adminClient();
    let downSteps: number;
    try {
      const schemas = await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_security'`);
      expect(schemas.rowCount).toBe(1);
      // F-V1-048: down by distance through this component's migrations, not tip `1`.
      downSteps = await downCountThroughCmp048(c);
      expect(downSteps).toBeGreaterThanOrEqual(1);
    } finally {
      await c.end();
    }
    migrate('down', downSteps);
    const c2 = await adminClient();
    try {
      const schemas = await c2.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_security'`);
      expect(schemas.rowCount).toBe(0);
      const remaining = await c2.query<{ name: string }>(
        `SELECT name FROM sf_platform.sf_schema_migrations WHERE name ~ 'cmp-048'`,
      );
      expect(remaining.rowCount).toBe(0);
    } finally {
      await c2.end();
    }
    migrate('up');
    const c3 = await adminClient();
    try {
      const role = await c3.query(
        `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp048_rw'`,
      );
      expect(role.rows[0].rolcanlogin).toBe(false);
      const schemas = await c3.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_security'`);
      expect(schemas.rowCount).toBe(1);
    } finally {
      await c3.end();
    }
  });

  afterAll(() => {
    /* leave migrated for sibling files in this process; fileParallelism is false but files may be isolated */
  });
});
