import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  looksLikeDuration,
  normalizePeriodRef,
  PolicyRejected,
} from '../../../services/cmp-049-data-retention/src/domain/policy.js';
import { evaluateTransition } from '../../../services/cmp-049-data-retention/src/domain/eligibility.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** Opaque test reference only; not a statutory period and carries no duration meaning. */
const OPAQUE_REF = 'owner-ref:sec-fixture/opaque';

describe('SF-M08-SEC CMP-049 retention fails closed without owner policy input', () => {
  it('refuses archive/delete eligibility when no owner-supplied period ref exists', () => {
    const policy = {
      eligibility_transitions: [
        { from_eligibility: 'ACTIVE', to_eligibility: 'ARCHIVE_ELIGIBLE' },
        { from_eligibility: 'ACTIVE', to_eligibility: 'DELETE_ELIGIBLE' },
      ] as const,
      owner_supplied_period_ref: null,
    };
    for (const to of ['ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE'] as const) {
      expect(evaluateTransition(policy, 'ACTIVE', to)).toEqual({
        allowed: false,
        reason: 'POLICY_INPUT_REQUIRED',
      });
    }
  });

  it('refuses transitions not listed in the published policy', () => {
    const policy = { eligibility_transitions: [], owner_supplied_period_ref: OPAQUE_REF };
    expect(evaluateTransition(policy, 'ACTIVE', 'DELETE_ELIGIBLE')).toEqual({
      allowed: false,
      reason: 'TRANSITION_NOT_IN_POLICY',
    });
  });

  it('rejects period refs that smuggle a duration value', () => {
    for (const smuggled of [
      '30',
      '30d',
      '30_days',
      '7-years',
      '12 months',
      'P1Y',
      'P30D',
      'PT1H',
    ]) {
      expect(looksLikeDuration(smuggled), smuggled).toBe(true);
      expect(() => normalizePeriodRef(smuggled, '/owner_supplied_period_ref')).toThrow(
        PolicyRejected,
      );
    }
    expect(normalizePeriodRef(OPAQUE_REF, '/owner_supplied_period_ref')).toBe(OPAQUE_REF);
  });

  it('migration stores no retention period, interval or due-date column', () => {
    const sql = readFileSync(
      join(ROOT, 'db/migrations/1760360000000_cmp-049-data-retention.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/\binterval\b/i);
    expect(sql).not.toMatch(/\b(retention|erasure)_(days|months|years|period)\b/i);
    expect(sql).not.toMatch(/\bdue_(at|date)\b/i);
    expect(sql.includes('invented_statutory_period_forbidden')).toBe(true);
  });
});
