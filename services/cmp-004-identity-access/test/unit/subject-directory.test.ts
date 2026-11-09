import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PgCitizenSubjectDirectory } from '../../src/subject-directory.js';

const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const TENANT = '11111111-1111-4111-8111-111111111111';

function pool(rows: number) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    pool: {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rowCount: rows, rows: rows ? [{ ok: 1 }] : [] };
      },
    } as unknown as Pool,
  };
}

describe('PgCitizenSubjectDirectory (CMP-005 SubjectDirectoryPort)', () => {
  it('reports an active citizen principal', async () => {
    const p = pool(1);
    expect(
      await new PgCitizenSubjectDirectory(p.pool).exists({
        tenant_id: TENANT,
        subject_id: CITIZEN,
      }),
    ).toBe(true);
    expect(p.calls[0]?.sql).toMatch(/sf_identity\.citizen_principal/);
    expect(p.calls[0]?.sql).toMatch(/status = 'ACTIVE'/);
    expect(p.calls[0]?.params).toEqual([CITIZEN]);
  });

  it('reports an unknown or locked citizen as absent', async () => {
    const p = pool(0);
    expect(
      await new PgCitizenSubjectDirectory(p.pool).exists({
        tenant_id: TENANT,
        subject_id: CITIZEN,
      }),
    ).toBe(false);
  });

  it('does not query for a malformed subject id', async () => {
    const p = pool(1);
    expect(
      await new PgCitizenSubjectDirectory(p.pool).exists({
        tenant_id: TENANT,
        subject_id: "x' OR 1=1",
      }),
    ).toBe(false);
    expect(p.calls).toHaveLength(0);
  });
});
