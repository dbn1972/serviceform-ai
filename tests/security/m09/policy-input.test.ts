import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  validateDenyRequest,
  validateSubmitRequest,
  validateTaskOutcome,
} from '../../../services/cmp-061-privacy-centre/src/service/input.js';
import {
  assertSignalsAreAdvisoryOnly,
  requiresHumanReview,
} from '../../../services/cmp-060-risk-integrity/src/domain/risk-classifier.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** Opaque fixture references only; they carry no legal or statutory meaning. */
const OPAQUE = 'owner-ref:sec-fixture/opaque';
const SCOPE = [{ owner_component: 'CMP-010', scope_ref: OPAQUE }];

function rejects(fn: () => unknown, code: string, detailCode?: string): void {
  try {
    fn();
    expect.fail(`expected ${code}${detailCode ? `/${detailCode}` : ''}`);
  } catch (err) {
    const e = err as { code?: string; details?: Array<{ code?: string }> };
    expect(e.code).toBe(code);
    if (detailCode) expect((e.details ?? []).map((d) => d.code)).toContain(detailCode);
  }
}

function upSql(file: string): string {
  return (
    readFileSync(join(ROOT, 'db/migrations', file), 'utf8').split(/^-- Down Migration/m)[0] ?? ''
  );
}

describe('SF-M09-SEC CMP-061 privacy rights: no invented statute, owner-supplied policy input', () => {
  it('denial without an owner-supplied basis ref fails closed with POLICY_INPUT_REQUIRED', () => {
    rejects(() => validateDenyRequest({}), 'SF-SYS-003', 'POLICY_INPUT_REQUIRED');
    expect(validateDenyRequest({ legal_basis_or_exception_ref: OPAQUE })).toEqual({
      legal_basis_or_exception_ref: OPAQUE,
    });
  });

  it('an exception outcome requires both opaque basis and authority refs', () => {
    rejects(
      () =>
        validateTaskOutcome({
          outcome: 'EXCEPTION_RECORDED',
          legal_basis_or_exception_ref: OPAQUE,
        }),
      'SF-SYS-003',
      'POLICY_INPUT_REQUIRED',
    );
    rejects(
      () =>
        validateTaskOutcome({
          outcome: 'COMPLETED',
          evidence_ref: OPAQUE,
          legal_basis_or_exception_ref: OPAQUE,
        }),
      'SF-SYS-003',
      'NOT_ALLOWED_FOR_OUTCOME',
    );
  });

  it('the requester cannot supply a legal basis, a deadline, a tenant or flip the no-statute marker', () => {
    const base = { request_type: 'ACCESS', submit_assurance: 'OTP', scope: SCOPE };
    rejects(
      () => validateSubmitRequest({ ...base, legal_basis_or_exception_ref: OPAQUE }),
      'SF-SYS-003',
      'OWNER_SUPPLIED_FIELD',
    );
    for (const key of ['deadline', 'due_at']) {
      rejects(
        () => validateSubmitRequest({ ...base, [key]: '2030-01-01T00:00:00Z' }),
        'SF-SYS-003',
        'CLIENT_TIME_NOT_AUTHORITATIVE',
      );
    }
    rejects(() => validateSubmitRequest({ ...base, tenant_id: OPAQUE }), 'SF-TEN-002');
    rejects(
      () => validateSubmitRequest({ ...base, invented_statutory_policy_forbidden: false }),
      'SF-SYS-003',
      'CONSTANT_MARKER_MUST_BE_TRUE',
    );
  });

  it('privacy migration stores no response deadline/period and pins the no-statute marker', () => {
    const sql = upSql('1761300000000_cmp-061-privacy-centre.sql');
    const ddl = sql.replace(/--.*$/gm, '');
    expect(ddl).not.toMatch(/\binterval\b/i);
    expect(ddl).not.toMatch(/\b(deadline|due_at|due_date|response_days|sla_days)\b/i);
    expect(ddl).toMatch(
      /invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true\s+CHECK \(invented_statutory_policy_forbidden\)/,
    );
  });
});

describe('SF-M09-SEC CMP-060 risk: advisory only, no statutory decision', () => {
  it('rejects signals that encode an authoritative / statutory outcome (SF-AI-001)', () => {
    for (const code of [
      'APPROVE',
      'reject',
      'ELIGIBLE',
      'PENALTY',
      'SANCTION',
      'FINAL_DECISION',
      'ADJUDICATION',
    ]) {
      rejects(
        () => assertSignalsAreAdvisoryOnly([{ signal_code: code }]),
        'SF-AI-001',
        'STATUTORY_DECISION_SIGNAL_PROHIBITED',
      );
    }
    expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'DOC_MISMATCH' }])).not.toThrow();
  });

  it('high tiers route to human review rather than to an outcome', () => {
    expect(requiresHumanReview('HIGH')).toBe(true);
    expect(requiresHumanReview('CRITICAL')).toBe(true);
    expect(requiresHumanReview('LOW')).toBe(false);
  });

  it('risk routes and schema never claim an authoritative decision', () => {
    const routes = readFileSync(
      join(ROOT, 'services/cmp-060-risk-integrity/src/routes/risk-routes.ts'),
      'utf8',
    );
    expect(routes).toMatch(/authoritative_decision_by_this_component: false/);
    expect(routes).not.toMatch(/authoritative_decision_by_this_component: true/);
    const sql = upSql('1760500000000_cmp-060-risk-integrity.sql');
    expect(sql).toMatch(/CHECK \(invented_statutory_policy_forbidden = true\)/);
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/\b(APPROVED|REJECTED|INELIGIBLE)\b/);
  });
});
