import type { Pool } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * CMP-004 answer to "is this an active citizen subject?" for components that key data by citizen
 * id (CMP-005 SubjectDirectoryPort). Citizens are platform-global (ADR-0007), so the tenant is not
 * part of the lookup; the caller keeps its own tenant boundary. Reveals existence only.
 */
export class PgCitizenSubjectDirectory {
  constructor(private readonly pool: Pool) {}

  async exists(input: { tenant_id: string; subject_id: string }): Promise<boolean> {
    if (!UUID.test(input.subject_id)) return false;
    const found = await this.pool.query<{ ok: number }>(
      `SELECT 1 AS ok FROM sf_identity.citizen_principal WHERE citizen_id = $1 AND status = 'ACTIVE'`,
      [input.subject_id],
    );
    return (found.rowCount ?? 0) > 0;
  }
}
