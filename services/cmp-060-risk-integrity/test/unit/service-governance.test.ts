/**
 * Service-level governance tests with an in-memory fake pool.
 * Verifies authoritative_decision_by_this_component stays false and authz fail-closed.
 */
import { describe, it, expect, vi } from 'vitest';
import { RiskAssessmentService } from '../../src/service/risk-assessment-service.js';
import { DenyAllTenantAuthz, SimulatedAllowAllTenantAuthz } from '../../src/ports/tenant-authz.js';
import { Cmp060Error } from '../../src/errors.js';
import type { Pool, PoolClient, QueryResult } from 'pg';

const TENANT = '11111111-1111-4111-8111-111111111111';
const APP = '33333333-3333-4333-8333-333333333333';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakePool(handlers: (sql: string, params: unknown[]) => unknown[] = () => []): Pool {
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 } satisfies Partial<QueryResult>;
      }
      if (sql.startsWith('SELECT set_config')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM sf_risk.risk_assessment') && sql.includes('idempotency_key')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO sf_risk.risk_assessment')) {
        // Enforce governance: authoritative flag must be false in VALUES
        expect(sql).toContain('false');
        expect(sql).toContain('true'); // invented_statutory_policy_forbidden
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO sf_risk.risk_signal')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE sf_risk.risk_assessment')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO sf_risk.outbox_event')) {
        const envelope = JSON.parse(String(params[9]));
        expect(envelope.data.authoritative_decision_by_this_component).toBe(false);
        return { rows: [], rowCount: 1 };
      }
      return { rows: handlers(sql, params), rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  return {
    connect: vi.fn(async () => client),
  } as unknown as Pool;
}

describe('RiskAssessmentService governance', () => {
  it('createAssessment always returns authoritative_decision_by_this_component=false', async () => {
    const svc = new RiskAssessmentService(fakePool(), new SimulatedAllowAllTenantAuthz());
    const result = await svc.createAssessment({
      tenant_id: TENANT,
      assessment_id: '22222222-2222-4222-8222-222222222222',
      subject_application_id: APP,
      cell_id: 'cell-platform',
      idempotency_key: 'idem-risk-unit-0001',
      signals: [{ signal_code: 'DOC_MISMATCH', provenance_ref: 'cmp-060:signal:1' }],
      raw_risk_score: 0.2,
      actor_type: 'SYSTEM',
      requested_by: ACTOR,
    });
    expect(result.authoritative_decision_by_this_component).toBe(false);
    expect(result.invented_statutory_policy_forbidden).toBe(true);
    expect(result.contract_id).toBe('SF-CON-RISK-ASSESSMENT');
    expect(result.lifecycle_status).toBe('COMPLETED');
  });

  it('HIGH score routes to human review (INT-018) without deciding', async () => {
    const svc = new RiskAssessmentService(fakePool(), new SimulatedAllowAllTenantAuthz());
    const result = await svc.createAssessment({
      tenant_id: TENANT,
      assessment_id: '22222222-2222-4222-8222-222222222223',
      subject_application_id: APP,
      cell_id: 'cell-platform',
      idempotency_key: 'idem-risk-unit-0002',
      signals: [{ signal_code: 'DOC_MISMATCH', provenance_ref: 'cmp-060:signal:2' }],
      raw_risk_score: 0.85,
      actor_type: 'SYSTEM',
      requested_by: ACTOR,
    });
    expect(result.lifecycle_status).toBe('HIGH_RISK_REVIEW_REQUESTED');
    expect(result.authoritative_decision_by_this_component).toBe(false);
  });

  it('authz deny-all fails closed (INT-011)', async () => {
    const svc = new RiskAssessmentService(fakePool(), new DenyAllTenantAuthz());
    await expect(
      svc.createAssessment({
        tenant_id: TENANT,
        assessment_id: '22222222-2222-4222-8222-222222222224',
        subject_application_id: APP,
        cell_id: 'cell-platform',
        idempotency_key: 'idem-risk-unit-0003',
        signals: [],
        actor_type: 'SYSTEM',
        requested_by: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
  });

  it('rejects statutory decision signal codes before DB write', async () => {
    const pool = fakePool();
    const svc = new RiskAssessmentService(pool, new SimulatedAllowAllTenantAuthz());
    await expect(
      svc.createAssessment({
        tenant_id: TENANT,
        assessment_id: '22222222-2222-4222-8222-222222222225',
        subject_application_id: APP,
        cell_id: 'cell-platform',
        idempotency_key: 'idem-risk-unit-0004',
        signals: [{ signal_code: 'REJECT', provenance_ref: 'bad' }],
        actor_type: 'SYSTEM',
        requested_by: ACTOR,
      }),
    ).rejects.toBeInstanceOf(Cmp060Error);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
