/**
 * Risk tier classification using deterministic thresholds (GoRules-style).
 * Architecture Constitution rule 40: raw AI score MUST NOT solely determine adverse outcomes.
 * Tier is advisory only; downstream action requires human review or deterministic policy gate.
 */

import { Cmp060Error } from '../errors.js';
import type { RiskTier } from './types.js';

export interface TierThresholds {
  low_max: number; // score <= low_max => LOW
  medium_max: number; // score <= medium_max => MEDIUM
  high_max: number; // score <= high_max => HIGH
  // score > high_max => CRITICAL
}

const DEFAULT_THRESHOLDS: TierThresholds = {
  low_max: 0.3,
  medium_max: 0.6,
  high_max: 0.8,
};

/** Prohibited codes that attempt to encode a statutory decision outcome. */
const PROHIBITED_CODES =
  /^(APPROVE|REJECT|PENALT(?:Y)?|ELIGIB(?:LE|ILITY)?|ENTITLE(?:MENT)?|ADJUDICAT(?:E|ION)?|SANCTION|FINAL_DECISION)$/i;

/**
 * Classify raw score into a tier using fully deterministic rule thresholds.
 * The tier is advisory; the raw score alone must never trigger an adverse statutory outcome.
 */
export function classifyRiskTier(
  rawScore: number,
  thresholds: TierThresholds = DEFAULT_THRESHOLDS,
): RiskTier {
  if (rawScore < 0 || rawScore > 1) {
    throw new Cmp060Error('SF-SYS-003', {
      details: [{ code: 'RAW_SCORE_OUT_OF_RANGE', pointer: '/raw_risk_score' }],
    });
  }
  if (rawScore <= thresholds.low_max) return 'LOW';
  if (rawScore <= thresholds.medium_max) return 'MEDIUM';
  if (rawScore <= thresholds.high_max) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Determine whether the advisory tier warrants routing to human review (INT-018).
 * This is a recommendation only; the authorized reviewer makes the final determination.
 */
export function requiresHumanReview(tier: RiskTier): boolean {
  return tier === 'HIGH' || tier === 'CRITICAL';
}

/**
 * Hard governance gate: signals must not encode statutory decision outcomes.
 * Architecture Constitution rule 40 / SF-CON-RISK-ASSESSMENT FROZEN.
 */
export function assertSignalsAreAdvisoryOnly(signals: { signal_code: string }[]): void {
  for (const signal of signals) {
    if (PROHIBITED_CODES.test(signal.signal_code)) {
      throw new Cmp060Error('SF-AI-001', {
        details: [
          {
            code: 'STATUTORY_DECISION_SIGNAL_PROHIBITED',
            pointer: '/signals/signal_code',
            message:
              `Signal code '${signal.signal_code}' attempts to express a statutory decision outcome. ` +
              'CMP-060 issues advisory signals only (Architecture Constitution rule 40).',
          },
        ],
      });
    }
  }
}
