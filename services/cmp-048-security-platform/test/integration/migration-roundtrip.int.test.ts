import { afterAll, describe, expect, it } from 'vitest';
import { adminClient, migrate } from './helpers.js';

describe('migration round trip (D13)', () => {
  it('up / down / up leaves sf_security and sf_cmp048_rw', async () => {
    migrate('up');
    const c = await adminClient();
    try {
      const schemas = await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_security'`);
      expect(schemas.rowCount).toBe(1);
    } finally {
      await c.end();
    }
    migrate('down', 1);
    const c2 = await adminClient();
    try {
      const schemas = await c2.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_security'`);
      expect(schemas.rowCount).toBe(0);
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
    } finally {
      await c3.end();
    }
  });

  afterAll(() => {
    /* leave migrated for sibling files in this process; fileParallelism is false but files may be isolated */
  });
});
