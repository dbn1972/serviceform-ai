/**
 * FROZEN SF-CON-MIGRATION-PROJECT projector.
 * Constant markers are fixed in code; never client-supplied.
 */

import type { ProjectRow } from '../repo/migration-repo.js';

export const CONTRACT_ID = 'SF-CON-MIGRATION-PROJECT' as const;

export interface MigrationProjectContract {
  contract_id: typeof CONTRACT_ID;
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  idempotency_key: string;
  invented_statutory_policy_forbidden: true;
  correlation_id?: string;
  project_id: string;
  lifecycle_status: ProjectRow['lifecycle_status'];
  dry_run_required_before_execute: true;
  mapping_spec_ref: string;
  source_profile_ref?: string | null;
}

export function toMigrationProjectContract(row: ProjectRow): MigrationProjectContract {
  const out: MigrationProjectContract = {
    contract_id: CONTRACT_ID,
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    idempotency_key: row.idempotency_key,
    invented_statutory_policy_forbidden: true,
    project_id: row.project_id,
    lifecycle_status: row.lifecycle_status,
    dry_run_required_before_execute: true,
    mapping_spec_ref: row.mapping_spec_ref ?? 'pending:unmapped',
  };
  if (row.correlation_id) out.correlation_id = row.correlation_id;
  if (row.source_profile_ref !== undefined) out.source_profile_ref = row.source_profile_ref;
  return out;
}
