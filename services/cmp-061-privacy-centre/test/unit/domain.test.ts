import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allOwnerOutcomesReceived,
  canTransition,
  CONTRACT_ID,
  countTasks,
  isOwnerComponent,
  toContract,
  type FulfilmentTaskRecord,
  type PrivacyRequestRecord,
} from '../../src/domain/request.js';
import { validateSubmitRequest } from '../../src/service/input.js';
import { TENANT_A } from '../doubles/fixtures.js';

const SCHEMA = join(process.cwd(), '../../contracts/m09/schemas/privacy-request.schema.json');

function baseRow(overrides: Partial<PrivacyRequestRecord> = {}): PrivacyRequestRecord {
  return {
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
    ...overrides,
  };
}

describe('privacy request domain', () => {
  it('toContract always emits FROZEN markers as true/false constants', () => {
    const c = toContract(baseRow());
    expect(c.contract_id).toBe(CONTRACT_ID);
    expect(c.contract_status).toBe('FROZEN');
    expect(c.freeze_status).toBe('FROZEN');
    expect(c.cross_component_direct_mutation_forbidden).toBe(true);
    expect(c.owner_task_orchestration_only).toBe(true);
    expect(c.invented_statutory_policy_forbidden).toBe(true);
  });

  it('lifecycle transitions match the SQL guard', () => {
    expect(canTransition('SUBMITTED', 'TASKS_REQUESTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'WITHDRAWN')).toBe(true);
    expect(canTransition('SUBMITTED', 'DENIED_WITH_BASIS_REF')).toBe(true);
    expect(canTransition('SUBMITTED', 'COMPLETED')).toBe(false);
    expect(canTransition('TASKS_REQUESTED', 'COMPLETED')).toBe(true);
    expect(canTransition('COMPLETED', 'WITHDRAWN')).toBe(false);
  });

  it('refuses CMP-061 as an owner_component (no self cross-SQL)', () => {
    expect(isOwnerComponent('CMP-061')).toBe(false);
    expect(isOwnerComponent('CMP-030')).toBe(true);
  });

  it('allOwnerOutcomesReceived requires every task terminal with evidence or exception', () => {
    const open: FulfilmentTaskRecord[] = [
      {
        tenant_id: TENANT_A,
        task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        scope_seq: 1,
        owner_component: 'CMP-030',
        task_status: 'REQUESTED',
        evidence_ref: null,
        legal_basis_or_exception_ref: null,
        exception_authority_ref: null,
        task_version: 1,
        created_at: '2026-10-15T00:00:00.000Z',
        updated_at: '2026-10-15T00:00:00.000Z',
        last_correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    ];
    expect(allOwnerOutcomesReceived(open)).toBe(false);
    expect(allOwnerOutcomesReceived([])).toBe(false);
    const first = open[0];
    if (!first) {
      throw new Error('expected fulfilment task fixture');
    }
    first.task_status = 'COMPLETED';
    first.evidence_ref = 'owner.evidence.1';
    expect(allOwnerOutcomesReceived(open)).toBe(true);
    expect(countTasks(open).completed).toBe(1);
  });

  it('schema FROZEN markers are const true', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
    expect(schema.properties.cross_component_direct_mutation_forbidden.const).toBe(true);
    expect(schema.properties.owner_task_orchestration_only.const).toBe(true);
  });

  it('validateSubmitRequest refuses false frozen markers and self-owner', () => {
    expect(() =>
      validateSubmitRequest({
        request_type: 'ACCESS',
        submit_assurance: 'OTP',
        scope: [{ owner_component: 'CMP-030', scope_ref: 'x' }],
        cross_component_direct_mutation_forbidden: false,
      }),
    ).toThrow();

    expect(() =>
      validateSubmitRequest({
        request_type: 'ACCESS',
        submit_assurance: 'OTP',
        scope: [{ owner_component: 'CMP-061', scope_ref: 'x' }],
      }),
    ).toThrow();
  });
});
