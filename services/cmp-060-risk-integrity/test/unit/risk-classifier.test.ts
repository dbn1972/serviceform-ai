import { describe, it, expect } from 'vitest';
import {
  classifyRiskTier,
  requiresHumanReview,
  assertSignalsAreAdvisoryOnly,
} from '../../src/domain/risk-classifier.js';
import { Cmp060Error } from '../../src/errors.js';

describe('risk-classifier', () => {
  describe('classifyRiskTier', () => {
    it('classifies 0.0 as LOW', () => {
      expect(classifyRiskTier(0.0)).toBe('LOW');
    });

    it('classifies 0.3 as LOW (boundary)', () => {
      expect(classifyRiskTier(0.3)).toBe('LOW');
    });

    it('classifies 0.31 as MEDIUM', () => {
      expect(classifyRiskTier(0.31)).toBe('MEDIUM');
    });

    it('classifies 0.6 as MEDIUM (boundary)', () => {
      expect(classifyRiskTier(0.6)).toBe('MEDIUM');
    });

    it('classifies 0.61 as HIGH', () => {
      expect(classifyRiskTier(0.61)).toBe('HIGH');
    });

    it('classifies 0.8 as HIGH (boundary)', () => {
      expect(classifyRiskTier(0.8)).toBe('HIGH');
    });

    it('classifies 0.81 as CRITICAL', () => {
      expect(classifyRiskTier(0.81)).toBe('CRITICAL');
    });

    it('classifies 1.0 as CRITICAL', () => {
      expect(classifyRiskTier(1.0)).toBe('CRITICAL');
    });

    it('respects custom thresholds', () => {
      expect(classifyRiskTier(0.5, { low_max: 0.5, medium_max: 0.7, high_max: 0.9 })).toBe('LOW');
      expect(classifyRiskTier(0.6, { low_max: 0.5, medium_max: 0.7, high_max: 0.9 })).toBe(
        'MEDIUM',
      );
    });

    it('rejects out-of-range scores', () => {
      expect(() => classifyRiskTier(-0.1)).toThrow(Cmp060Error);
      expect(() => classifyRiskTier(1.1)).toThrow(Cmp060Error);
    });
  });

  describe('requiresHumanReview', () => {
    it('LOW does not require review', () => {
      expect(requiresHumanReview('LOW')).toBe(false);
    });

    it('MEDIUM does not require review', () => {
      expect(requiresHumanReview('MEDIUM')).toBe(false);
    });

    it('HIGH requires review (INT-018)', () => {
      expect(requiresHumanReview('HIGH')).toBe(true);
    });

    it('CRITICAL requires review (INT-018)', () => {
      expect(requiresHumanReview('CRITICAL')).toBe(true);
    });
  });

  describe('assertSignalsAreAdvisoryOnly — governance gate', () => {
    it('allows safe advisory signal codes', () => {
      expect(() =>
        assertSignalsAreAdvisoryOnly([
          { signal_code: 'DOC_MISMATCH' },
          { signal_code: 'ADDRESS_INCONSISTENCY' },
          { signal_code: 'DUPLICATE_SUBMISSION' },
        ]),
      ).not.toThrow();
    });

    it('CRITICAL: rejects APPROVE signal (Constitution rule 40)', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'APPROVE' }])).toThrow(Cmp060Error);
      try {
        assertSignalsAreAdvisoryOnly([{ signal_code: 'APPROVE' }]);
      } catch (e) {
        expect(e).toBeInstanceOf(Cmp060Error);
        expect((e as Cmp060Error).code).toBe('SF-AI-001');
        expect((e as Cmp060Error).message).toMatch(/advisory boundary/i);
      }
    });

    it('CRITICAL: rejects REJECT signal', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'REJECT' }])).toThrow(
        /advisory boundary/i,
      );
    });

    it('CRITICAL: rejects PENALTY signal', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'PENALTY' }])).toThrow(Cmp060Error);
    });

    it('CRITICAL: rejects ELIGIBLE signal', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'ELIGIBLE' }])).toThrow(
        Cmp060Error,
      );
    });

    it('CRITICAL: rejects FINAL_DECISION signal', () => {
      expect(() => assertSignalsAreAdvisoryOnly([{ signal_code: 'FINAL_DECISION' }])).toThrow(
        Cmp060Error,
      );
    });

    it('allows empty signals array', () => {
      expect(() => assertSignalsAreAdvisoryOnly([])).not.toThrow();
    });
  });
});
