import type { PoolClient } from 'pg';

export interface ModelRow {
  model_entry_id: string;
  tenant_id: string;
  cell_id: string;
  provider_id: string;
  model_id: string;
  model_version: string;
  operations: string[];
  max_data_classification: string;
  max_input_chars: number;
  max_output_tokens: number;
  daily_token_budget: string | number;
  status: 'ACTIVE' | 'REVOKED';
  registered_by: string;
  revoked_by: string | null;
  revoke_reason: string | null;
  aggregate_version: string | number;
  created_at: Date;
  revoked_at: Date | null;
}

export interface PolicyRow {
  tenant_id: string;
  cell_id: string;
  policy_id: string;
  policy_version: number;
  task_kind: string;
  operation: 'INVOKE' | 'EMBED';
  template_body: string | null;
  template_hash: string;
  variable_names: string[];
  allowed_tools: ToolPolicy[];
  model_entry_ids: string[];
  max_data_classification: string;
  max_output_tokens: number;
  latency_budget_ms: number;
  fallback_behavior: 'DENY' | 'NON_AI_PATH';
  evaluation_ref: Record<string, string | number>;
  status: 'ACTIVE' | 'RETIRED';
  registered_by: string;
  aggregate_version: string | number;
  created_at: Date;
  retired_at: Date | null;
}

export interface ToolPolicy {
  tool_id: string;
  version: string;
  scopes: string[];
  effect: 'READ_ONLY' | 'DRAFT_ONLY';
}

export async function insertModel(
  client: PoolClient,
  row: ModelRow,
): Promise<ModelRow | undefined> {
  const res = await client.query<ModelRow>(
    `INSERT INTO sf_ai_gateway.model_registry (
       model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
       max_data_classification, max_input_chars, max_output_tokens, daily_token_budget,
       status, registered_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12,$13)
     RETURNING *`,
    [
      row.model_entry_id,
      row.tenant_id,
      row.cell_id,
      row.provider_id,
      row.model_id,
      row.model_version,
      row.operations,
      row.max_data_classification,
      row.max_input_chars,
      row.max_output_tokens,
      row.daily_token_budget,
      row.registered_by,
      row.created_at,
    ],
  );
  return res.rows[0];
}

export async function getModelsByIds(
  client: PoolClient,
  tenantId: string,
  ids: readonly string[],
): Promise<ModelRow[]> {
  const res = await client.query<ModelRow>(
    `SELECT * FROM sf_ai_gateway.model_registry
      WHERE tenant_id = $1 AND model_entry_id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  return res.rows;
}

export async function listActiveModels(client: PoolClient, tenantId: string): Promise<ModelRow[]> {
  const res = await client.query<ModelRow>(
    `SELECT * FROM sf_ai_gateway.model_registry
      WHERE tenant_id = $1 AND status = 'ACTIVE'
      ORDER BY provider_id, model_id, model_version`,
    [tenantId],
  );
  return res.rows;
}

export async function revokeModel(
  client: PoolClient,
  params: { tenantId: string; modelEntryId: string; actorId: string; reason: string; now: Date },
): Promise<ModelRow | undefined> {
  const res = await client.query<ModelRow>(
    `UPDATE sf_ai_gateway.model_registry
        SET status = 'REVOKED', revoked_by = $1, revoke_reason = $2, revoked_at = $3,
            aggregate_version = aggregate_version + 1
      WHERE tenant_id = $4 AND model_entry_id = $5 AND status = 'ACTIVE'
      RETURNING *`,
    [params.actorId, params.reason, params.now, params.tenantId, params.modelEntryId],
  );
  return res.rows[0];
}

export async function insertPolicy(
  client: PoolClient,
  row: PolicyRow,
): Promise<PolicyRow | undefined> {
  const res = await client.query<PolicyRow>(
    `INSERT INTO sf_ai_gateway.ai_policy (
       tenant_id, cell_id, policy_id, policy_version, task_kind, operation, template_body,
       template_hash, variable_names, allowed_tools, model_entry_ids, max_data_classification,
       max_output_tokens, latency_budget_ms, fallback_behavior, evaluation_ref, status,
       registered_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16::jsonb,'ACTIVE',$17,$18)
     RETURNING *`,
    [
      row.tenant_id,
      row.cell_id,
      row.policy_id,
      row.policy_version,
      row.task_kind,
      row.operation,
      row.template_body,
      row.template_hash,
      row.variable_names,
      JSON.stringify(row.allowed_tools),
      row.model_entry_ids,
      row.max_data_classification,
      row.max_output_tokens,
      row.latency_budget_ms,
      row.fallback_behavior,
      JSON.stringify(row.evaluation_ref),
      row.registered_by,
      row.created_at,
    ],
  );
  return res.rows[0];
}

export async function getPolicy(
  client: PoolClient,
  tenantId: string,
  policyId: string,
  version: number,
): Promise<PolicyRow | undefined> {
  const res = await client.query<PolicyRow>(
    `SELECT * FROM sf_ai_gateway.ai_policy
      WHERE tenant_id = $1 AND policy_id = $2 AND policy_version = $3`,
    [tenantId, policyId, version],
  );
  return res.rows[0];
}

export async function retirePolicy(
  client: PoolClient,
  params: { tenantId: string; policyId: string; version: number; now: Date },
): Promise<PolicyRow | undefined> {
  const res = await client.query<PolicyRow>(
    `UPDATE sf_ai_gateway.ai_policy
        SET status = 'RETIRED', retired_at = $1, aggregate_version = aggregate_version + 1
      WHERE tenant_id = $2 AND policy_id = $3 AND policy_version = $4 AND status = 'ACTIVE'
      RETURNING *`,
    [params.now, params.tenantId, params.policyId, params.version],
  );
  return res.rows[0];
}
