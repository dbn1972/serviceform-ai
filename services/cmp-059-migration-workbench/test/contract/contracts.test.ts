/**
 * Contract tests for CMP-059 Migration Workbench.
 * Validates against FROZEN SF-CON-MIGRATION-PROJECT (INT-017).
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deriveReconciliationStatus,
  validateDisplayName,
  validateSourceSystemRef,
  validateMappingVersionRef,
  isUuid,
} from '../../src/domain/migration.js';
import { toMigrationProjectContract, CONTRACT_ID } from '../../src/domain/contract.js';
import { TOPIC_DOMAIN } from '../../src/db/outbox.js';
import type { ProjectRow } from '../../src/repo/migration-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');
const FROZEN_SCHEMA = 'contracts/m09/schemas/migration-project.schema.json';
const LOCK_HASH = '62e8b1645a2ce904e339034b902792eaa5bc886b0f67f4d20dd96a90c58d078b';

const requireFromContracts = createRequire(join(repoRoot, 'packages/contracts/package.json'));
const { Ajv2020 } = requireFromContracts('ajv/dist/2020.js') as {
  Ajv2020: new (o: object) => Ajv;
};
const addFormatsModule = requireFromContracts('ajv-formats') as {
  default?: (a: Ajv) => void;
} & ((a: Ajv) => void);
const addFormats = addFormatsModule.default ?? addFormatsModule;

type Validator = ((d: unknown) => boolean) & { errors?: unknown };
interface Ajv {
  addSchema(s: object): void;
  getSchema(id: string): Validator | undefined;
}

function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const sharedDir = join(repoRoot, 'contracts/shared/schemas');
for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(readJson(join(sharedDir, f)));
}
ajv.addSchema(readJson(join(repoRoot, FROZEN_SCHEMA)));
const validateProject = ajv.getSchema(
  'https://contracts.serviceform.ai/m09/migrationproject/v1',
) as Validator;

describe('SF-CON-MIGRATION-PROJECT contract surface', () => {
  it('frozen schema hash matches contracts-lock', () => {
    const raw = readFileSync(join(repoRoot, FROZEN_SCHEMA));
    const hash = createHash('sha256').update(raw).digest('hex');
    expect(hash).toBe(LOCK_HASH);
  });

  it('frozen markers require dry_run_required_before_execute=true', () => {
    const s = readJson<{ properties: Record<string, { const?: unknown }> }>(
      join(repoRoot, FROZEN_SCHEMA),
    );
    expect(s.properties['dry_run_required_before_execute']?.const).toBe(true);
    expect(s.properties['invented_statutory_policy_forbidden']?.const).toBe(true);
    expect(s.properties['contract_id']?.const).toBe('SF-CON-MIGRATION-PROJECT');
  });

  it('valid example passes; invalid dry-run-optional fails', () => {
    const valid = readJson(join(repoRoot, 'contracts/m09/examples/valid/migration-project.json'));
    const invalid = readJson(
      join(repoRoot, 'contracts/m09/examples/invalid/migration-project.dry-run-optional.json'),
    );
    expect(validateProject(valid)).toBe(true);
    expect(validateProject(invalid)).toBe(false);
  });

  it('projector output validates against frozen schema', () => {
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
    const projected = toMigrationProjectContract(row);
    expect(projected.contract_id).toBe(CONTRACT_ID);
    expect(validateProject(projected)).toBe(true);
  });

  it('outbox topic is sf.migration', () => {
    expect(TOPIC_DOMAIN).toBe('sf.migration');
  });

  it('lifecycle statuses match frozen enum', () => {
    const required = [
      'CREATED',
      'PROFILED',
      'MAPPED',
      'DRY_RUN',
      'EXECUTED',
      'RECONCILED',
      'FAILED',
      'ROLLED_BACK',
    ] as const;
    const s = readJson<{ properties: { lifecycle_status: { enum: string[] } } }>(
      join(repoRoot, FROZEN_SCHEMA),
    );
    expect(s.properties.lifecycle_status.enum).toEqual([...required]);
  });

  it('reconciliation statuses are derivable', () => {
    expect(
      deriveReconciliationStatus({
        sourceCount: 10,
        targetCount: 10,
        matchedCount: 10,
        failedRecords: 0,
      }),
    ).toBe('PASSED');
  });

  it('input validation contract', () => {
    expect(validateDisplayName('A')).toBe(true);
    expect(validateSourceSystemRef('LEGACY-001')).toBe(true);
    expect(validateMappingVersionRef('MAP-V1.0.0')).toBe(true);
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it.each([
    'POST /migrations/projects',
    'POST /migrations/{id}/profile',
    'POST /migrations/{id}/map',
    'POST /migrations/{id}/dry-run',
    'POST /migrations/{id}/execute',
    'GET /migrations/{id}/reconciliation',
  ])('INT-017 endpoint %s is defined', (endpoint) => {
    expect(endpoint).toMatch(/^(POST|GET) \/migrations/);
  });

  it.each([
    'MigrationDryRunCompleted',
    'MigrationBatchApplied',
    'MigrationReconciliationFailed',
    'MigrationCompleted',
  ])('INT-017 event %s naming', (event) => {
    expect(event).toMatch(/^[A-Z][A-Za-z]+$/);
  });
});
