import { describe, expect, it } from 'vitest';
import {
  isUuid,
  canTransition,
  deriveReconciliationStatus,
  validateDisplayName,
  validateSourceSystemRef,
  validateMappingVersionRef,
  validateIdempotencyKey,
} from '../../src/domain/migration.js';
import { toMigrationProjectContract, CONTRACT_ID } from '../../src/domain/contract.js';
import type { ProjectRow } from '../../src/repo/migration-repo.js';

describe('domain invariants', () => {
  it('isUuid', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });

  it('canTransition enforces dry-run gate', () => {
    expect(canTransition('MAPPED', 'DRY_RUN')).toBe(true);
    expect(canTransition('DRY_RUN', 'EXECUTED')).toBe(true);
    expect(canTransition('CREATED', 'EXECUTED')).toBe(false);
    expect(canTransition('MAPPED', 'EXECUTED')).toBe(false);
  });

  it('deriveReconciliationStatus', () => {
    expect(
      deriveReconciliationStatus({
        sourceCount: 100,
        targetCount: 100,
        matchedCount: 100,
        failedRecords: 0,
      }),
    ).toBe('PASSED');
    expect(
      deriveReconciliationStatus({
        sourceCount: 100,
        targetCount: 0,
        matchedCount: 0,
        failedRecords: 100,
      }),
    ).toBe('FAILED');
    expect(
      deriveReconciliationStatus({
        sourceCount: 100,
        targetCount: 90,
        matchedCount: 90,
        failedRecords: 10,
      }),
    ).toBe('PARTIAL');
  });

  it('validators', () => {
    expect(validateDisplayName('Civil Registry Migration')).toBe(true);
    expect(validateDisplayName('')).toBe(false);
    expect(validateSourceSystemRef('LEGACY-CR-001')).toBe(true);
    expect(validateSourceSystemRef('-BAD')).toBe(false);
    expect(validateMappingVersionRef('meta:migration-map:v1')).toBe(true);
    expect(validateIdempotencyKey('idem-migration-0001')).toBe(true);
    expect(validateIdempotencyKey('short')).toBe(false);
  });

  it('toMigrationProjectContract projects FROZEN markers', () => {
    const row = {
      tenant_id: '11111111-1111-4111-8111-111111111111',
      project_id: '22222222-2222-4222-8222-222222222222',
      project_version: 1,
      display_name: 'X',
      source_system_ref: 'LEGACY',
      target_service_code: null,
      lifecycle_status: 'DRY_RUN',
      dry_run_required_before_execute: true,
      dry_run_count: 1,
      last_dry_run_at: null,
      mapping_spec_ref: 'meta:migration-map:v1',
      source_profile_ref: null,
      idempotency_key: 'idem-migration-0001',
      correlation_id: '33333333-3333-4333-8333-333333333333',
      invented_statutory_policy_forbidden: true,
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created_at: new Date(),
      updated_at: new Date(),
    } as ProjectRow;
    const c = toMigrationProjectContract(row);
    expect(c.contract_id).toBe(CONTRACT_ID);
    expect(c.dry_run_required_before_execute).toBe(true);
    expect(c.lifecycle_status).toBe('DRY_RUN');
  });
});
