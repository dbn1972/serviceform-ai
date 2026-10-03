import { describe, expect, it } from 'vitest';
import { databaseReadiness } from '../src/readiness.js';

describe('database readiness probe (REQ: AWS v1.7 s2 readiness probes)', () => {
  it('fails when PostgreSQL is unreachable and closes its pool', async () => {
    const db = databaseReadiness('postgres://probe@127.0.0.1:9/none');
    expect(db.check.name).toBe('postgres');
    await expect(db.check.check()).rejects.toThrow();
    await expect(db.close()).resolves.toBeUndefined();
  });
});
