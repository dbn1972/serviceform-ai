import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Cmp034Error } from '../errors.js';
import type { CodeValueInput } from '../ports/code-list-import.js';
import { MAX_IMPORT_ITEMS, isValidValueCode } from '../domain/codes.js';

export function newId(): string {
  return randomUUID();
}

export async function lockTenantScope(client: PoolClient, tenantId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [tenantId]);
}

export async function requireDraftVersion(
  client: PoolClient,
  codeSetId: string,
  versionNo: number,
): Promise<void> {
  const found = await client.query<{ status: string }>(
    `SELECT status FROM sf_master_data.code_set_version
      WHERE code_set_id = $1 AND version_no = $2`,
    [codeSetId, versionNo],
  );
  const row = found.rows[0];
  if (!row) throw new Cmp034Error('SF-SYS-002');
  if (row.status !== 'DRAFT') {
    throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
}

export async function insertValues(
  client: PoolClient,
  params: {
    tenantId: string;
    codeSetId: string;
    versionNo: number;
    actorId: string;
    items: CodeValueInput[];
  },
): Promise<number> {
  if (params.items.length === 0 || params.items.length > MAX_IMPORT_ITEMS) {
    throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'IMPORT_SIZE' }] });
  }
  const ids = new Map<string, string>();
  for (const item of params.items) {
    if (!isValidValueCode(item.value_code)) {
      throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'VALUE_CODE' }] });
    }
    if (item.localization_key.length < 1 || item.localization_key.length > 200) {
      throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'LOCALIZATION_KEY' }] });
    }
    if (!Number.isInteger(item.sort_order) || item.sort_order < 0) {
      throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'SORT_ORDER' }] });
    }
    ids.set(item.value_code, newId());
  }
  for (const item of params.items) {
    let parentId: string | null = null;
    if (item.parent_value_code) {
      parentId = ids.get(item.parent_value_code) ?? null;
      if (!parentId) throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'PARENT_VALUE' }] });
    }
    await client.query(
      `INSERT INTO sf_master_data.code_value (
         tenant_id, code_set_id, version_no, value_id, value_code, localization_key,
         sort_order, parent_value_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        params.tenantId,
        params.codeSetId,
        params.versionNo,
        ids.get(item.value_code),
        item.value_code,
        item.localization_key,
        item.sort_order,
        parentId,
        params.actorId,
      ],
    );
  }
  return params.items.length;
}
