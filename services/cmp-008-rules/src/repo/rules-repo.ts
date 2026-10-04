import type { SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import type { MatchedRule } from '../domain/engine.js';

export type ResultCode = 'RULE_OUTPUT_PRODUCED' | 'NO_RULE_OUTPUT';

export interface SnapshotRow {
  snapshot_id: string;
  tenant_id: string;
  cell_id: string;
  pack_key: string;
  content_hash: string;
  payload_digest: string;
  payload: unknown;
  created_by: string;
  created_at: Date;
}

export interface EvaluationRow {
  evaluation_id: string;
  tenant_id: string;
  cell_id: string;
  snapshot_id: string;
  pack_key: string;
  version_id: string;
  content_hash: string;
  input_hash: string;
  purpose_code: string;
  subject_ref: string | null;
  outcome: string | null;
  result_code: ResultCode;
  reason_codes: string[];
  outputs: Record<string, unknown>;
  matched_rules: MatchedRule[];
  engine_name: string;
  engine_version: string;
  simulation: SimulationMarker | null;
  requested_by: string;
  evaluated_at: Date;
}

export async function ensureSnapshot(
  client: PoolClient,
  row: {
    snapshotId: string;
    tenantId: string;
    cellId: string;
    packKey: string;
    contentHash: string;
    payloadDigest: string;
    payload: unknown;
    createdBy: string;
    now: Date;
  },
): Promise<SnapshotRow> {
  await client.query(
    `INSERT INTO sf_rules.rule_pack_snapshot (
       snapshot_id, tenant_id, cell_id, pack_key, content_hash, payload_digest, payload,
       created_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     ON CONFLICT (tenant_id, pack_key, content_hash) DO NOTHING`,
    [
      row.snapshotId,
      row.tenantId,
      row.cellId,
      row.packKey,
      row.contentHash,
      row.payloadDigest,
      JSON.stringify(row.payload),
      row.createdBy,
      row.now,
    ],
  );
  const res = await client.query<SnapshotRow>(
    `SELECT * FROM sf_rules.rule_pack_snapshot
      WHERE tenant_id = $1 AND pack_key = $2 AND content_hash = $3`,
    [row.tenantId, row.packKey, row.contentHash],
  );
  return res.rows[0] as SnapshotRow;
}

export async function insertEvaluation(
  client: PoolClient,
  row: {
    evaluationId: string;
    tenantId: string;
    cellId: string;
    snapshotId: string;
    packKey: string;
    versionId: string;
    contentHash: string;
    inputHash: string;
    purposeCode: string;
    subjectRef: string | null;
    outcome: string | null;
    resultCode: ResultCode;
    reasonCodes: string[];
    outputs: Record<string, unknown>;
    matchedRules: MatchedRule[];
    engineName: string;
    engineVersion: string;
    simulation: SimulationMarker | null;
    requestedBy: string;
    now: Date;
  },
): Promise<EvaluationRow> {
  const res = await client.query<EvaluationRow>(
    `INSERT INTO sf_rules.evaluation_record (
       evaluation_id, tenant_id, cell_id, snapshot_id, pack_key, version_id, content_hash,
       input_hash, purpose_code, subject_ref, outcome, result_code, reason_codes, outputs,
       matched_rules, engine_name, engine_version, simulation, requested_by, evaluated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19,$20)
     RETURNING *`,
    [
      row.evaluationId,
      row.tenantId,
      row.cellId,
      row.snapshotId,
      row.packKey,
      row.versionId,
      row.contentHash,
      row.inputHash,
      row.purposeCode,
      row.subjectRef,
      row.outcome,
      row.resultCode,
      JSON.stringify(row.reasonCodes),
      JSON.stringify(row.outputs),
      JSON.stringify(row.matchedRules),
      row.engineName,
      row.engineVersion,
      row.simulation === null ? null : JSON.stringify(row.simulation),
      row.requestedBy,
      row.now,
    ],
  );
  return res.rows[0] as EvaluationRow;
}

export async function getEvaluation(
  client: PoolClient,
  tenantId: string,
  evaluationId: string,
): Promise<EvaluationRow | undefined> {
  const res = await client.query<EvaluationRow>(
    `SELECT * FROM sf_rules.evaluation_record WHERE tenant_id = $1 AND evaluation_id = $2`,
    [tenantId, evaluationId],
  );
  return res.rows[0];
}
