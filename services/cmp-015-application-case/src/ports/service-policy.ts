import type { PinGraph } from '../domain/pins.js';

/**
 * Published service policy gate for POLICY_GATED_WITHDRAWAL / POLICY_GATED_CANCELLATION
 * (Constitution #17; ADR-0003). Evaluated by the deterministic rules plane against the case's
 * pinned rule version; CMP-015 never infers availability. Default is deny.
 */
export interface TransitionPolicyQuery {
  tenant_id: string;
  application_id: string;
  transition_key: string;
  from_state: string;
  pins: PinGraph;
}

export interface TransitionPolicyDecision {
  permitted: boolean;
  policy_ref: string;
}

export interface ServicePolicyPort {
  evaluateTransition(query: TransitionPolicyQuery): Promise<TransitionPolicyDecision>;
}

export class DenyServicePolicyPort implements ServicePolicyPort {
  async evaluateTransition(): Promise<TransitionPolicyDecision> {
    return { permitted: false, policy_ref: 'unconfigured' };
  }
}

/** LOCAL/CI only. Permits exactly the configured (rule_version_id, transition_key) pairs. */
export class SimulatedServicePolicyPort implements ServicePolicyPort {
  readonly simulation = 'SIMULATED' as const;
  private readonly permitted = new Set<string>();

  permit(ruleVersionId: string, transitionKey: string): void {
    this.permitted.add(`${ruleVersionId}:${transitionKey}`);
  }

  async evaluateTransition(query: TransitionPolicyQuery): Promise<TransitionPolicyDecision> {
    const ok = this.permitted.has(`${query.pins.rule_version_id}:${query.transition_key}`);
    return { permitted: ok, policy_ref: `simulated:${query.pins.rule_version_id}` };
  }
}
