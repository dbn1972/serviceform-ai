import { Cmp015Error, detail } from '../errors.js';
import type { Actor } from './validate.js';

/**
 * Constitution #20 / ADR-0003: an AI model never makes a final statutory approval/rejection, nor
 * approves/rejects a withdrawal or cancellation request. Decisions are made by a human officer or
 * by deterministic published rules executed by a SYSTEM workflow actor. INTEGRATION principals
 * (including the AI Gateway) cannot record a decision at all.
 */
export type DecisionMaker = 'HUMAN' | 'RULES' | 'AI';

export interface DecisionAttestation {
  decision_maker: DecisionMaker;
  basis_ref?: string;
  ai_assisted?: boolean;
}

const BASIS_REF_RE = /^[A-Za-z0-9_.:/-]{1,200}$/;

export function parseDecision(value: unknown): DecisionAttestation | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Cmp015Error('SF-SYS-003', { details: detail('DECISION_INVALID', '/decision') });
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!['decision_maker', 'basis_ref', 'ai_assisted'].includes(key)) {
      throw new Cmp015Error('SF-SYS-003', {
        details: detail('DECISION_UNKNOWN_FIELD', `/decision/${key}`),
      });
    }
  }
  if (!['HUMAN', 'RULES', 'AI'].includes(String(v['decision_maker']))) {
    throw new Cmp015Error('SF-SYS-003', {
      details: detail('DECISION_MAKER_INVALID', '/decision/decision_maker'),
    });
  }
  const out: DecisionAttestation = { decision_maker: v['decision_maker'] as DecisionMaker };
  if (v['basis_ref'] !== undefined) {
    if (typeof v['basis_ref'] !== 'string' || !BASIS_REF_RE.test(v['basis_ref'])) {
      throw new Cmp015Error('SF-SYS-003', {
        details: detail('DECISION_BASIS_INVALID', '/decision/basis_ref'),
      });
    }
    out.basis_ref = v['basis_ref'];
  }
  if (v['ai_assisted'] !== undefined) {
    if (typeof v['ai_assisted'] !== 'boolean') {
      throw new Cmp015Error('SF-SYS-003', {
        details: detail('DECISION_AI_ASSISTED_INVALID', '/decision/ai_assisted'),
      });
    }
    out.ai_assisted = v['ai_assisted'];
  }
  return out;
}

export function assertDecisionBoundary(
  actor: Actor,
  decision: DecisionAttestation | undefined,
  isDecision: boolean,
): void {
  if (decision?.decision_maker === 'AI') {
    throw new Cmp015Error('SF-AUTH-002', { details: detail('AI_FINAL_DECISION_FORBIDDEN') });
  }
  if (!isDecision) return;
  if (actor.type === 'INTEGRATION') {
    throw new Cmp015Error('SF-AUTH-002', { details: detail('AI_FINAL_DECISION_FORBIDDEN') });
  }
  if (!decision) {
    throw new Cmp015Error('SF-SYS-003', {
      details: detail('DECISION_ATTESTATION_REQUIRED', '/decision'),
    });
  }
  if (decision.decision_maker === 'HUMAN') {
    if (actor.type !== 'OFFICER') {
      throw new Cmp015Error('SF-AUTH-002', { details: detail('HUMAN_OFFICER_DECISION_REQUIRED') });
    }
    return;
  }
  if (actor.type !== 'SYSTEM' || !decision.basis_ref) {
    throw new Cmp015Error('SF-AUTH-002', {
      details: detail('RULES_DECISION_REQUIRES_SYSTEM_BASIS'),
    });
  }
  if (decision.ai_assisted) {
    throw new Cmp015Error('SF-AUTH-002', { details: detail('AI_FINAL_DECISION_FORBIDDEN') });
  }
}
