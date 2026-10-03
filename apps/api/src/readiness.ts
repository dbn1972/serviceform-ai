import pg from 'pg';
import type { ReadinessCheck } from './plugins/health.js';

/** PostgreSQL connectivity probe. The pool is tiny: it only serves readiness checks. */
export function databaseReadiness(url: string): {
  check: ReadinessCheck;
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 2000,
  });
  pool.on('error', () => {
    /* surfaced through the readiness result */
  });
  return {
    check: {
      name: 'postgres',
      check: async () => {
        await pool.query('SELECT 1');
      },
    },
    close: () => pool.end(),
  };
}
