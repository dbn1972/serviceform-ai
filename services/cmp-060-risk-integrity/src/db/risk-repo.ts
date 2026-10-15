import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  CreateRiskAssessmentCommand,
  RecordDispositionCommand,
  RiskAssessmentRecord,
} from '../domain/types.js';
import type { RiskSignalInput } from '../domain/types.js';
import { Cmp060Error, mapPgError } from '../errors.js';

export async function insertRiskAssessment(
  client: PoolClient,
  cmd: CreateRiskAssessmentCommand & {
    risk_tier: string | null;
    lifecycle_status: string;
  },
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO sf_risk.risk_assessment (
         tenant_id, assessment_id, subject_application_id, cell_id,
         idempotency_key, correlation_id,
         authoritative_decision_by_this_component, invented_statutory_policy_forbidden,
         lifecycle_status, raw_risk_score, risk_tier, signal_count,
         actor_type, requested_by, model_or_rule_version
       ) VALUES ($1,$2,$3,$4,$5,$6, false, true, $7,$8,$9,$10,$11,$12,$13)`,
      [
        cmd.tenant_id,
        cmd.assessment_id,
        cmd.subject_application_id,
        cmd.cell_id,
        cmd.idempotency_key,
        cmd.correlation_id ?? null,
        cmd.lifecycle_status,
        cmd.raw_risk_score ?? null,
        cmd.risk_tier,
        cmd.signals.length,
        cmd.actor_type,
        cmd.requested_by,
        cmd.model_or_rule_version ?? null,
      ],
    );
  } catch (err) {
    throw mapPgError(err);
  }
}

export async function insertRiskSignals(
  client: PoolClient,
  tenantId: string,
  assessmentId: string,
  signals: RiskSignalInput[],
): Promise<void> {
  for (const sig of signals) {
    try {
      await client.query(
        `INSERT INTO sf_risk.risk_signal (
           tenant_id, signal_id, assessment_id, signal_code, provenance_ref,
           model_or_rule_version, detail
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          tenantId,
          randomUUID(),
          assessmentId,
          sig.signal_code,
          sig.provenance_ref,
          sig.model_or_rule_version ?? null,
          sig.detail ? JSON.stringify(sig.detail) : null,
        ],
      );
    } catch (err) {
      throw mapPgError(err);
    }
  }
}

export async function requestHumanReview(
  client: PoolClient,
  tenantId: string,
  assessmentId: string,
): Promise<void> {
  try {
    const { rowCount } = await client.query(
      `UPDATE sf_risk.risk_assessment
          SET lifecycle_status = 'HIGH_RISK_REVIEW_REQUESTED',
              review_requested_at = now()
        WHERE tenant_id = $1
          AND assessment_id = $2
          AND lifecycle_status = 'COMPLETED'`,
      [tenantId, assessmentId],
    );
    if (rowCount === 0) {
      throw new Cmp060Error('SF-SYS-002', {
        details: [{ code: 'ASSESSMENT_NOT_FOUND_OR_INVALID_STATUS' }],
      });
    }
  } catch (err) {
    throw mapPgError(err);
  }
}

export async function insertReviewDisposition(
  client: PoolClient,
  cmd: RecordDispositionCommand,
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO sf_risk.review_disposition (
         tenant_id, disposition_id, assessment_id, disposition,
         disposition_note, disposed_by, disposed_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,now(),$7)`,
      [
        cmd.tenant_id,
        cmd.disposition_id,
        cmd.assessment_id,
        cmd.disposition,
        cmd.disposition_note ?? null,
        cmd.disposed_by,
        cmd.correlation_id ?? null,
      ],
    );
    await client.query(
      `UPDATE sf_risk.risk_assessment
          SET lifecycle_status = 'DISPOSITION_RECORDED',
              disposition_recorded_at = now()
        WHERE tenant_id = $1
          AND assessment_id = $2
          AND lifecycle_status = 'HIGH_RISK_REVIEW_REQUESTED'`,
      [cmd.tenant_id, cmd.assessment_id],
    );
  } catch (err) {
    throw mapPgError(err);
  }
}

export async function findAssessmentByIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<RiskAssessmentRecord | null> {
  const { rows } = await client.query<RiskAssessmentRecord>(
    `SELECT * FROM sf_risk.risk_assessment WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, idempotencyKey],
  );
  return rows[0] ?? null;
}

export async function findAssessmentById(
  client: PoolClient,
  tenantId: string,
  assessmentId: string,
): Promise<RiskAssessmentRecord | null> {
  const { rows } = await client.query<RiskAssessmentRecord>(
    `SELECT * FROM sf_risk.risk_assessment WHERE tenant_id = $1 AND assessment_id = $2`,
    [tenantId, assessmentId],
  );
  return rows[0] ?? null;
}

export async function findSignalsByAssessment(
  client: PoolClient,
  tenantId: string,
  assessmentId: string,
): Promise<RiskSignalInput[]> {
  const { rows } = await client.query<{
    signal_code: string;
    provenance_ref: string;
    model_or_rule_version: string | null;
  }>(
    `SELECT signal_code, provenance_ref, model_or_rule_version
       FROM sf_risk.risk_signal
      WHERE tenant_id = $1 AND assessment_id = $2
      ORDER BY recorded_at ASC`,
    [tenantId, assessmentId],
  );
  return rows.map((r) => ({
    signal_code: r.signal_code,
    provenance_ref: r.provenance_ref,
    model_or_rule_version: r.model_or_rule_version,
  }));
}
