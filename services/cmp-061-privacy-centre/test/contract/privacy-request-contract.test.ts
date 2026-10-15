import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_ID, toContract } from '../../src/domain/request.js';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { DOMAIN_EVENT_TYPES } from '../../src/outbox.js';
import { TENANT_A } from '../doubles/fixtures.js';

const ROOT = join(process.cwd(), '../..');
const SCHEMA = join(ROOT, 'contracts/m09/schemas/privacy-request.schema.json');
const VALID = join(ROOT, 'contracts/m09/examples/valid/privacy-request.json');
const INVALID_MUTATION = join(
  ROOT,
  'contracts/m09/examples/invalid/privacy-request.cross-component-mutation.json',
);
const INVALID_ORCH = join(
  ROOT,
  'contracts/m09/examples/invalid/privacy-request.not-orchestration-only.json',
);

describe('SF-CON-PRIVACY-REQUEST contract conformance', () => {
  it('schema is FROZEN and owned by CMP-061 / INT-019', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
    expect(schema.description).toContain('FROZEN');
    expect(schema.description).toMatch(/INT-019|CMP-061/);
    expect(schema.properties.contract_id.const).toBe(CONTRACT_ID);
  });

  it('valid example has both orchestration gates true', () => {
    const example = JSON.parse(readFileSync(VALID, 'utf8'));
    expect(example.cross_component_direct_mutation_forbidden).toBe(true);
    expect(example.owner_task_orchestration_only).toBe(true);
    expect(example.invented_statutory_policy_forbidden).toBe(true);
  });

  it('invalid examples capture the prohibited patterns', () => {
    const mut = JSON.parse(readFileSync(INVALID_MUTATION, 'utf8'));
    const orch = JSON.parse(readFileSync(INVALID_ORCH, 'utf8'));
    expect(mut.cross_component_direct_mutation_forbidden).toBe(false);
    expect(orch.owner_task_orchestration_only).toBe(false);
  });

  it('toContract output matches required frozen fields', () => {
    const contract = toContract({
      tenant_id: TENANT_A,
      request_id: '22222222-2222-4222-8222-222222222222',
      subject_actor_id: '33333333-3333-4333-8333-333333333333',
      request_type: 'ACCESS',
      lifecycle_status: 'SUBMITTED',
      legal_basis_or_exception_ref: null,
      submit_assurance: 'OTP',
      idempotency_key: 'idem-m09-006-0001',
      request_version: 1,
      scope_count: 1,
      correlation_id: '44444444-4444-4444-8444-444444444444',
      created_at: '2026-10-15T00:00:00.000Z',
      updated_at: '2026-10-15T00:00:00.000Z',
      last_correlation_id: '44444444-4444-4444-8444-444444444444',
    });
    expect(contract).toMatchObject({
      contract_id: 'SF-CON-PRIVACY-REQUEST',
      contract_status: 'FROZEN',
      freeze_status: 'FROZEN',
      cross_component_direct_mutation_forbidden: true,
      owner_task_orchestration_only: true,
      invented_statutory_policy_forbidden: true,
    });
  });

  it('exposes the world-class privacy APIs plus owner-task orchestration routes', () => {
    const paths = ROUTE_DESCRIPTORS.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /v1/privacy/me');
    expect(paths).toContain('GET /v1/privacy/me/consents');
    expect(paths).toContain('POST /v1/privacy/requests');
    expect(paths).toContain('GET /v1/privacy/requests/:request_id');
    expect(paths).toContain('POST /v1/privacy/requests/:request_id/withdraw');
    expect(paths).toContain('POST /v1/privacy/requests/:request_id/tasks');
    expect(paths).toContain('POST /v1/privacy/requests/:request_id/complete');
  });

  it('publishes INT-019 orchestration events', () => {
    expect(DOMAIN_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        'PrivacyRequestSubmitted',
        'PrivacyTaskRequested',
        'PrivacyRequestCompleted',
        'ConsentWithdrawalRequested',
      ]),
    );
  });
});
