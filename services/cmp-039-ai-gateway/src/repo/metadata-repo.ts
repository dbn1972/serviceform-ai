import type { PoolClient } from 'pg';

export interface RequestMetadataRow {
  request_id: string;
  tenant_id: string;
  cell_id: string;
  actor_type: string;
  actor_id: string;
  correlation_id: string;
  trace_id: string;
  operation: 'INVOKE' | 'EMBED';
  policy_id: string;
  policy_version: number | null;
  caller_component: string | null;
  policy_hash: string | null;
  prompt_hash: string | null;
  provider_id: string | null;
  model_id: string | null;
  model_version: string | null;
  tool_calls: { tool_id: string; version: string; scopes: string[] }[];
  citations: { source_id: string }[];
  data_classification: string;
  purpose: string;
  redaction_summary: Record<string, number>;
  outcome: 'COMPLETED' | 'BLOCKED' | 'FAILED';
  reason_code: string | null;
  fallback_used: boolean;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  simulated: boolean;
  created_at: Date;
}

export async function insertRequestMetadata(
  client: PoolClient,
  r: RequestMetadataRow,
): Promise<void> {
  await client.query(
    `INSERT INTO sf_ai_gateway.ai_request_metadata (
       request_id, tenant_id, cell_id, actor_type, actor_id, correlation_id, trace_id, operation,
       policy_id, policy_version, caller_component, policy_hash, prompt_hash, provider_id, model_id,
       model_version, tool_calls, citations, data_classification, purpose, redaction_summary,
       outcome, reason_code, fallback_used, attempts, input_tokens, output_tokens, latency_ms,
       simulated, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,
               $21::jsonb,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
    [
      r.request_id,
      r.tenant_id,
      r.cell_id,
      r.actor_type,
      r.actor_id,
      r.correlation_id,
      r.trace_id,
      r.operation,
      r.policy_id,
      r.policy_version,
      r.caller_component,
      r.policy_hash,
      r.prompt_hash,
      r.provider_id,
      r.model_id,
      r.model_version,
      JSON.stringify(r.tool_calls),
      JSON.stringify(r.citations),
      r.data_classification,
      r.purpose,
      JSON.stringify(r.redaction_summary),
      r.outcome,
      r.reason_code,
      r.fallback_used,
      r.attempts,
      r.input_tokens,
      r.output_tokens,
      r.latency_ms,
      r.simulated,
      r.created_at,
    ],
  );
}

export async function sumCompletedTokensSince(
  client: PoolClient,
  params: {
    tenantId: string;
    providerId: string;
    modelId: string;
    modelVersion: string;
    since: Date;
  },
): Promise<number> {
  const res = await client.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total
       FROM sf_ai_gateway.ai_request_metadata
      WHERE tenant_id = $1 AND provider_id = $2 AND model_id = $3 AND model_version = $4
        AND outcome = 'COMPLETED' AND created_at >= $5`,
    [params.tenantId, params.providerId, params.modelId, params.modelVersion, params.since],
  );
  return Number(res.rows[0]?.total ?? 0);
}
