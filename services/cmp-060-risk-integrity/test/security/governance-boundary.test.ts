/**
 * Security / tenant-negative / governance boundary tests for CMP-060.
 * Covers:
 * - INT-011 tenant isolation (cross-tenant access must be blocked)
 * - Architecture Constitution rule 40 (advisory-only; no authoritative decision bypass)
 * - SF-CON-RISK-ASSESSMENT: authoritative_decision_by_this_component hard gate
 */
import { describe, it, expect } from 'vitest';
import { assertSignalsAreAdvisoryOnly } from '../../src/domain/risk-classifier.js';
import { Cmp060Error, mapPgError } from '../../src/errors.js';
import { DenyAllTenantAuthz, SimulatedAllowAllTenantAuthz } from '../../src/ports/tenant-authz.js';
import { SimulatedReviewRoutingPort } from '../../src/ports/review-routing.js';
import { assertNoTenantIdentifyingHeaders } from '../../src/context.js';

describe('CMP-060 security / governance boundary tests', () => {
  describe('INT-011: tenant isolation port', () => {
    it('DenyAllTenantAuthz always returns false (negative gate)', async () => {
      const authz = new DenyAllTenantAuthz();
      const result = await authz.canActOnRisk({
        tenant_id: 'tenant-a',
        actor_id: 'user-1',
        actor_type: 'CITIZEN',
        action: 'CREATE_ASSESSMENT',
      });
      expect(result).toBe(false);
    });

    it('cross-tenant request returns false from deny-all port', async () => {
      const authz = new DenyAllTenantAuthz();
      const result = await authz.canActOnRisk({
        tenant_id: 'tenant-b',
        actor_id: 'user-from-tenant-a',
        actor_type: 'OFFICER',
        action: 'READ_ASSESSMENT',
      });
      expect(result).toBe(false);
    });

    it('allow-all port grants access in simulated environment', async () => {
      const authz = new SimulatedAllowAllTenantAuthz();
      const result = await authz.canActOnRisk({
        tenant_id: 'any-tenant',
        actor_id: 'any-user',
        actor_type: 'SYSTEM',
        action: 'CREATE_ASSESSMENT',
      });
      expect(result).toBe(true);
    });

    it('rejects tenant-identifying request headers', () => {
      expect(() => assertNoTenantIdentifyingHeaders({ 'x-tenant-id': 't1' })).toThrow(Cmp060Error);
    });
  });

  describe('Architecture Constitution rule 40 — advisory-only hard gate', () => {
    it('CRITICAL: signal code APPROVE triggers governance boundary error', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'APPROVE' }])).toThrow(Cmp060Error);
    });

    it('CRITICAL: signal code REJECT triggers governance boundary error', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'REJECT' }])).toThrow(
        /advisory boundary/i,
      );
    });

    it('CRITICAL: signal code ELIGIBLE triggers governance boundary error', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'ELIGIBLE' }])).toThrow(
        Cmp060Error,
      );
    });

    it('CRITICAL: ADJUDICATE triggers governance boundary error', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'ADJUDICATE' }])).toThrow(
        Cmp060Error,
      );
    });
  });

  describe('Cmp060Error — AI governance error codes', () => {
    it('SF-AI-001 carries advisory boundary violation message', () => {
      const err = new Cmp060Error('SF-AI-001');
      expect(err.code).toBe('SF-AI-001');
      expect(err.statusCode).toBe(422);
      expect(err.message).toMatch(/advisory boundary/i);
    });

    it('SF-AI-003 carries score-only rejection prohibition', () => {
      const err = new Cmp060Error('SF-AI-003');
      expect(err.code).toBe('SF-AI-003');
      expect(err.message).toMatch(/score.*must not/i);
    });

    it('mapPgError converts 23514 to SF-AI-001 (authoritative decision blocked)', () => {
      const pgErr = Object.assign(new Error('check violation'), { code: '23514' });
      const result = mapPgError(pgErr);
      expect(result.code).toBe('SF-AI-001');
      expect(result.details?.[0]?.code).toBe('AUTHORITATIVE_DECISION_BLOCKED');
    });

    it('mapPgError converts 42501 to SF-TEN-002 (tenant isolation violation)', () => {
      const pgErr = Object.assign(new Error('rls violation'), { code: '42501' });
      const result = mapPgError(pgErr);
      expect(result.code).toBe('SF-TEN-002');
    });
  });

  describe('INT-018: SimulatedReviewRoutingPort', () => {
    it('returns a routing ref for review (simulated mode)', async () => {
      const port = new SimulatedReviewRoutingPort();
      expect(port.mode).toBe('SIMULATED');
      const result = await port.routeToReview({
        tenant_id: 'tenant-x',
        assessment_id: 'assess-1',
        subject_application_id: 'app-1',
        risk_tier: 'HIGH',
        signal_count: 2,
        correlation_id: 'corr-1',
      });
      expect(result.routing_ref).toContain('assess-1');
    });

    it('does not return an authoritative decision (never a rejection/approval)', async () => {
      const port = new SimulatedReviewRoutingPort();
      const result = await port.routeToReview({
        tenant_id: 'tenant-x',
        assessment_id: 'assess-2',
        subject_application_id: 'app-2',
        risk_tier: 'CRITICAL',
        signal_count: 5,
        correlation_id: 'corr-2',
      });
      expect(result).not.toHaveProperty('approved');
      expect(result).not.toHaveProperty('rejected');
      expect(result).not.toHaveProperty('decision');
      expect(result).not.toHaveProperty('eligible');
    });
  });

  describe('DB-level governance constraint (SQL CHECK)', () => {
    it('migration SQL contains authoritative_decision_by_this_component = false CHECK constraint', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const sql = readFileSync(
        join(process.cwd(), '../../db/migrations/1760500000000_cmp-060-risk-integrity.sql'),
        'utf8',
      );
      expect(sql).toContain('authoritative_decision_by_this_component = false');
      expect(sql).toContain('invented_statutory_policy_forbidden = true');
      expect(sql).toContain('FORCE ROW LEVEL SECURITY');
      expect(sql).toContain('sf_cmp060_rw');
      expect(sql).toContain('CREATE SCHEMA sf_risk');
    });

    it('migration SQL enforces forward-only lifecycle (no reversals)', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const sql = readFileSync(
        join(process.cwd(), '../../db/migrations/1760500000000_cmp-060-risk-integrity.sql'),
        'utf8',
      );
      expect(sql).toContain('guard_assessment_transition');
      expect(sql).toContain('forward-only');
      expect(sql).toContain('NOBYPASSRLS');
    });
  });
});
