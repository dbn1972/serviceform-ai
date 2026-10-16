/**
 * CMP-060 Risk Assessment Service.
 *
 * Governance requirements:
 * - Architecture Constitution rule 40: risk/fraud signals are advisory by default.
 *   No adverse statutory outcome may rely solely on an opaque AI/ML score.
 * - SF-CON-RISK-ASSESSMENT FROZEN: authoritative_decision_by_this_component = false always.
 * - INT-018: signals route to authorized human review for HIGH/CRITICAL tiers; the human
 *   reviewer makes any adverse determination, not this component.
 * - INT-011: tenant isolation via RLS; tenant_id from request context, never caller-supplied.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  classifyRiskTier,
  requiresHumanReview,
  assertSignalsAreAdvisoryOnly,
} from '../domain/risk-classifier.js';
import type {
  CreateRiskAssessmentCommand,
  RecordDispositionCommand,
  RiskSignalInput,
} from '../domain/types.js';
import {
  insertRiskAssessment,
  insertRiskSignals,
  requestHumanReview,
  insertReviewDisposition,
  findAssessmentByIdempotencyKey,
  findAssessmentById,
  findSignalsByAssessment,
} from '../db/risk-repo.js';
import { insertOutbox, envelopeOf } from '../db/outbox.js';
import { withContextTx } from '../db/tx.js';
import { Cmp060Error } from '../errors.js';
import type { TenantAuthzPort } from '../ports/tenant-authz.js';
import type { ReviewRoutingPort } from '../ports/review-routing.js';

/** SF-CON-RISK-ASSESSMENT shaped response (non-authoritative). */
export interface AssessmentResult {
  readonly contract_id: 'SF-CON-RISK-ASSESSMENT';
  readonly contract_status: 'FROZEN';
  readonly freeze_status: 'FROZEN';
  readonly invented_statutory_policy_forbidden: true;
  readonly authoritative_decision_by_this_component: false;
  tenant_id: string;
  idempotency_key: string;
  assessment_id: string;
  subject_application_id: string;
  signals: RiskSignalInput[];
  lifecycle_status: string;
  risk_tier: string | null;
  raw_risk_score: number | null;
  signal_count: number;
  review_requested: boolean;
  correlation_id: string | null;
}

export class RiskAssessmentService {
  constructor(
    private readonly pool: Pool,
    private readonly authz: TenantAuthzPort,
    private readonly reviewRouting: ReviewRoutingPort | null = null,
  ) {}

  /**
   * Create a non-authoritative advisory risk assessment.
   * HIGH/CRITICAL tiers transition to HIGH_RISK_REVIEW_REQUESTED (INT-018).
   * Raw score is stored for explainability and MUST NOT determine adverse outcomes alone.
   */
  async createAssessment(cmd: CreateRiskAssessmentCommand): Promise<AssessmentResult> {
    assertSignalsAreAdvisoryOnly(cmd.signals);

    const allowed = await this.authz.canActOnRisk({
      tenant_id: cmd.tenant_id,
      actor_id: cmd.requested_by,
      actor_type: cmd.actor_type,
      action: 'CREATE_ASSESSMENT',
    });
    if (!allowed) {
      throw new Cmp060Error('SF-TEN-002', { details: [{ code: 'AUTHZ_DENIED' }] });
    }

    const assessmentId = cmd.assessment_id ?? randomUUID();
    const now = new Date().toISOString();
    const correlationId = cmd.correlation_id ?? randomUUID();

    const riskTier = cmd.raw_risk_score != null ? classifyRiskTier(cmd.raw_risk_score) : null;
    const reviewNeeded = riskTier != null && requiresHumanReview(riskTier);

    const session = {
      tenant_id: cmd.tenant_id,
      cell_id: cmd.cell_id,
      actor_type: cmd.actor_type,
      actor_id: cmd.requested_by,
      correlation_id: correlationId,
    };

    const result = await withContextTx(this.pool, session, async (client) => {
      const existing = await findAssessmentByIdempotencyKey(
        client,
        cmd.tenant_id,
        cmd.idempotency_key,
      );
      if (existing) {
        const signals = await findSignalsByAssessment(
          client,
          cmd.tenant_id,
          existing.assessment_id,
        );
        return { kind: 'existing' as const, value: toResult(existing, signals) };
      }

      await insertRiskAssessment(client, {
        ...cmd,
        assessment_id: assessmentId,
        risk_tier: riskTier,
        lifecycle_status: 'COMPLETED',
      });

      if (cmd.signals.length > 0) {
        await insertRiskSignals(client, cmd.tenant_id, assessmentId, cmd.signals);
      }

      // Persist review request inside the authoritative tx; external routing is after COMMIT.
      if (reviewNeeded && riskTier !== null) {
        await requestHumanReview(client, cmd.tenant_id, assessmentId);
      }

      const eventType = reviewNeeded
        ? 'sf.risk.assessment.review_requested.v1'
        : 'sf.risk.assessment.completed.v1';

      await insertOutbox(
        client,
        envelopeOf({
          eventType,
          tenantId: cmd.tenant_id,
          cellId: cmd.cell_id,
          aggregateType: 'RiskAssessment',
          aggregateId: assessmentId,
          aggregateVersion: 1,
          occurredAt: now,
          correlationId,
          actor: { type: cmd.actor_type, id: cmd.requested_by },
          data: {
            assessment_id: assessmentId,
            subject_application_id: cmd.subject_application_id,
            risk_tier: riskTier,
            signal_count: cmd.signals.length,
            authoritative_decision_by_this_component: false,
            invented_statutory_policy_forbidden: true,
          },
        }),
      );

      return {
        kind: 'created' as const,
        value: {
          contract_id: 'SF-CON-RISK-ASSESSMENT' as const,
          contract_status: 'FROZEN' as const,
          freeze_status: 'FROZEN' as const,
          invented_statutory_policy_forbidden: true as const,
          authoritative_decision_by_this_component: false as const,
          tenant_id: cmd.tenant_id,
          idempotency_key: cmd.idempotency_key,
          assessment_id: assessmentId,
          subject_application_id: cmd.subject_application_id,
          signals: cmd.signals,
          lifecycle_status: reviewNeeded ? 'HIGH_RISK_REVIEW_REQUESTED' : 'COMPLETED',
          risk_tier: riskTier,
          raw_risk_score: cmd.raw_risk_score ?? null,
          signal_count: cmd.signals.length,
          review_requested: reviewNeeded,
          correlation_id: correlationId,
        },
        routeReview: reviewNeeded && riskTier !== null,
        riskTier,
      };
    });

    if (result.kind === 'created' && result.routeReview && this.reviewRouting && result.riskTier) {
      await this.reviewRouting.routeToReview({
        tenant_id: cmd.tenant_id,
        assessment_id: result.value.assessment_id,
        subject_application_id: cmd.subject_application_id,
        risk_tier: result.riskTier,
        signal_count: cmd.signals.length,
        correlation_id: correlationId,
      });
    }

    return result.value;
  }

  async getAssessment(params: {
    tenant_id: string;
    cell_id: string;
    assessment_id: string;
    actor_id: string;
    actor_type: string;
  }): Promise<AssessmentResult> {
    const allowed = await this.authz.canActOnRisk({
      tenant_id: params.tenant_id,
      actor_id: params.actor_id,
      actor_type: params.actor_type,
      action: 'READ_ASSESSMENT',
    });
    if (!allowed) {
      throw new Cmp060Error('SF-TEN-002', { details: [{ code: 'AUTHZ_DENIED' }] });
    }

    return withContextTx(
      this.pool,
      {
        tenant_id: params.tenant_id,
        cell_id: params.cell_id,
        actor_type: params.actor_type as
          'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION' | 'PRIVILEGED_ADMIN',
        actor_id: params.actor_id,
        correlation_id: randomUUID(),
      },
      async (client) => {
        const assessment = await findAssessmentById(client, params.tenant_id, params.assessment_id);
        if (!assessment) {
          throw new Cmp060Error('SF-SYS-002', { details: [{ code: 'ASSESSMENT_NOT_FOUND' }] });
        }
        const signals = await findSignalsByAssessment(
          client,
          params.tenant_id,
          params.assessment_id,
        );
        return toResult(assessment, signals);
      },
    );
  }

  /**
   * Record authorized human reviewer's disposition (INT-018 fulfillment).
   * Only an authorized human may supply a disposition; this component never decides.
   */
  async recordDisposition(cmd: RecordDispositionCommand & { cell_id: string }): Promise<void> {
    const allowed = await this.authz.canActOnRisk({
      tenant_id: cmd.tenant_id,
      actor_id: cmd.disposed_by,
      actor_type: 'OFFICER',
      action: 'RECORD_DISPOSITION',
    });
    if (!allowed) {
      throw new Cmp060Error('SF-TEN-002', { details: [{ code: 'AUTHZ_DENIED' }] });
    }

    const now = new Date().toISOString();

    await withContextTx(
      this.pool,
      {
        tenant_id: cmd.tenant_id,
        cell_id: cmd.cell_id,
        actor_type: 'OFFICER',
        actor_id: cmd.disposed_by,
        correlation_id: cmd.correlation_id ?? randomUUID(),
      },
      async (client) => {
        const assessment = await findAssessmentById(client, cmd.tenant_id, cmd.assessment_id);
        if (!assessment) {
          throw new Cmp060Error('SF-SYS-002', { details: [{ code: 'ASSESSMENT_NOT_FOUND' }] });
        }
        if (assessment.lifecycle_status !== 'HIGH_RISK_REVIEW_REQUESTED') {
          throw new Cmp060Error('SF-SYS-003', {
            details: [{ code: 'INVALID_STATUS_FOR_DISPOSITION', pointer: '/assessment_id' }],
          });
        }

        await insertReviewDisposition(client, cmd);

        await insertOutbox(
          client,
          envelopeOf({
            eventType: 'sf.risk.assessment.disposition_recorded.v1',
            tenantId: cmd.tenant_id,
            cellId: assessment.cell_id,
            aggregateType: 'RiskAssessment',
            aggregateId: cmd.assessment_id,
            aggregateVersion: 2,
            occurredAt: now,
            correlationId: cmd.correlation_id ?? randomUUID(),
            actor: { type: 'OFFICER', id: cmd.disposed_by },
            data: {
              assessment_id: cmd.assessment_id,
              disposition: cmd.disposition,
              authoritative_decision_by_this_component: false,
            },
          }),
        );
      },
    );
  }
}

function toResult(
  row: {
    tenant_id: string;
    assessment_id: string;
    subject_application_id: string;
    idempotency_key: string;
    lifecycle_status: string;
    risk_tier: string | null;
    raw_risk_score: number | null;
    signal_count: number;
    correlation_id: string | null;
  },
  signals: RiskSignalInput[],
): AssessmentResult {
  return {
    contract_id: 'SF-CON-RISK-ASSESSMENT',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    invented_statutory_policy_forbidden: true,
    authoritative_decision_by_this_component: false,
    tenant_id: row.tenant_id,
    idempotency_key: row.idempotency_key,
    assessment_id: row.assessment_id,
    subject_application_id: row.subject_application_id,
    signals,
    lifecycle_status: row.lifecycle_status,
    risk_tier: row.risk_tier,
    raw_risk_score: row.raw_risk_score,
    signal_count: row.signal_count,
    review_requested: row.lifecycle_status === 'HIGH_RISK_REVIEW_REQUESTED',
    correlation_id: row.correlation_id,
  };
}
