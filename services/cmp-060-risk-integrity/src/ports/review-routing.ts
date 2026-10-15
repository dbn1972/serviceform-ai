/**
 * INT-018: Risk/integrity signal to authorized review port.
 * Advisory signals are forwarded to an authorized review queue.
 * The authorized reviewer — never this component — makes any adverse determination.
 * Architecture Constitution rule 40.
 */

export interface ReviewRoutingPort {
  /**
   * Notify the authorized review system that a HIGH/CRITICAL risk assessment
   * requires human review. The assessment record itself (in sf_risk) is the
   * authoritative source; this call is for notification/routing only.
   *
   * Returns a routing reference for correlation. Never returns a decision.
   */
  routeToReview(params: {
    tenant_id: string;
    assessment_id: string;
    subject_application_id: string;
    risk_tier: string;
    signal_count: number;
    correlation_id: string;
  }): Promise<{ routing_ref: string }>;
}

/**
 * Simulated ReviewRoutingPort for testing and non-production environments.
 * Must not be used in production (Architecture Constitution rule 22).
 */
export class SimulatedReviewRoutingPort implements ReviewRoutingPort {
  readonly mode = 'SIMULATED' as const;

  async routeToReview(params: {
    tenant_id: string;
    assessment_id: string;
    subject_application_id: string;
    risk_tier: string;
    signal_count: number;
    correlation_id: string;
  }): Promise<{ routing_ref: string }> {
    return {
      routing_ref: `simulated-review-${params.assessment_id}`,
    };
  }
}
