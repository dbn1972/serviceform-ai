import { randomUUID } from 'node:crypto';
import { validate, type RequestContext, type SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import type { RulesConfig } from '../config.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { sha256Of } from '../domain/canonical.js';
import type { EngineResult, RuleEngine } from '../domain/engine.js';
import type { EvaluationRequest } from '../domain/inputs.js';
import { MAX_REASON_CODES, OUTCOME_RE, parseRulePack, REASON_CODE_RE } from '../domain/pack.js';
import { Cmp008Error, mapPgError } from '../errors.js';
import type { PublishedRulePack, RulePackPort } from '../ports/rule-pack.js';
import {
  ensureSnapshot,
  getEvaluation,
  insertEvaluation,
  type EvaluationRow,
  type ResultCode,
} from '../repo/rules-repo.js';

export interface PreparedEvaluation {
  evaluationId: string;
  request: EvaluationRequest;
  pack: PublishedRulePack;
  result: EngineResult;
  outcome: string | null;
  resultCode: ResultCode;
  reasonCodes: string[];
  inputHash: string;
  payloadDigest: string;
  engineName: string;
  engineVersion: string;
  simulation: SimulationMarker | null;
}

function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp008Error('SF-TEN-001');
  return ctx.tenant_id;
}

function pinMismatch(): never {
  throw new Cmp008Error('SF-RULE-001', {
    statusCode: 422,
    details: [{ code: 'RULE_PACK_PIN_MISMATCH' }],
  });
}

export function evaluationPublic(row: EvaluationRow) {
  const body: Record<string, unknown> = {
    evaluation_id: row.evaluation_id,
    rule_pack: {
      pack_key: row.pack_key,
      version_id: row.version_id,
      content_hash: row.content_hash,
    },
    snapshot_id: row.snapshot_id,
    outcome: row.outcome,
    result_code: row.result_code,
    reason_codes: row.reason_codes,
    outputs: row.outputs,
    matched_rules: row.matched_rules,
    input_hash: row.input_hash,
    purpose_code: row.purpose_code,
    engine: { name: row.engine_name, version: row.engine_version },
    decision_basis: 'DETERMINISTIC_RULES',
    evaluated_at: new Date(row.evaluated_at).toISOString(),
  };
  if (row.subject_ref !== null) body['subject_ref'] = row.subject_ref;
  if (row.simulation !== null) body['simulation'] = row.simulation;
  return body;
}

/** Reason codes are rule-authored metadata; they are validated, deduplicated and sorted so the
 * same pinned pack and inputs always yield the same ordered list. */
export function extractReasonCodes(
  outputs: Record<string, unknown>,
  field: string | null,
): string[] {
  if (field === null) return [];
  const raw = outputs[field];
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const codes = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string' || !REASON_CODE_RE.test(item)) {
      throw new Cmp008Error('SF-RULE-001', {
        statusCode: 422,
        details: [{ code: 'REASON_CODE_INVALID' }],
      });
    }
    codes.add(item);
  }
  if (codes.size > MAX_REASON_CODES) {
    throw new Cmp008Error('SF-RULE-001', {
      statusCode: 422,
      details: [{ code: 'REASON_CODES_TOO_MANY' }],
    });
  }
  return [...codes].sort();
}

/**
 * Resolves the pinned published pack and runs the deterministic engine. Runs before the
 * authoritative transaction: no network call or rule execution happens inside it.
 */
export async function prepareEvaluation(
  deps: { ctx: RequestContext; config: RulesConfig; rulePacks: RulePackPort; engine: RuleEngine },
  request: EvaluationRequest,
): Promise<PreparedEvaluation> {
  const tenantId = tenantOf(deps.ctx);
  const pin = request.rule_pack;
  const pack = await deps.rulePacks.resolve({
    tenantId,
    packKey: pin.pack_key,
    versionId: pin.version_id,
    contentHash: pin.content_hash,
    correlationId: deps.ctx.correlation_id,
  });
  if (pack.tenant_id !== tenantId) throw new Cmp008Error('SF-TEN-002');
  if (
    pack.status !== 'PUBLISHED' ||
    pack.pack_key !== pin.pack_key ||
    pack.version_id !== pin.version_id ||
    pack.content_hash !== pin.content_hash
  ) {
    pinMismatch();
  }
  let simulation: SimulationMarker | null = null;
  if (pack.simulation) {
    if (
      deps.config.environment === 'PRODUCTION' ||
      !validate('simulation-marker', pack.simulation).valid
    ) {
      throw new Cmp008Error('SF-SYS-003', {
        details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }],
      });
    }
    simulation = pack.simulation;
  }

  const parsed = parseRulePack(pack.payload, pin.pack_key);
  const result = await deps.engine.evaluate(
    parsed.jdm,
    request.inputs,
    deps.config.evaluationTimeoutMs,
  );

  let outcome: string | null = null;
  if (parsed.outcomeField !== null) {
    const value = result.outputs[parsed.outcomeField];
    if (value !== undefined) {
      if (typeof value !== 'string' || !OUTCOME_RE.test(value)) {
        throw new Cmp008Error('SF-RULE-001', {
          statusCode: 422,
          details: [{ code: 'OUTCOME_VALUE_INVALID' }],
        });
      }
      outcome = value;
    }
  }
  const reasonCodes = extractReasonCodes(result.outputs, parsed.reasonCodesField);
  return {
    evaluationId: randomUUID(),
    resultCode: Object.keys(result.outputs).length > 0 ? 'RULE_OUTPUT_PRODUCED' : 'NO_RULE_OUTPUT',
    reasonCodes,
    request,
    pack,
    result,
    outcome,
    inputHash: sha256Of(request.inputs),
    payloadDigest: sha256Of(pack.payload),
    engineName: deps.engine.name,
    engineVersion: deps.engine.version,
    simulation,
  };
}

export async function persistEvaluation(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  prepared: PreparedEvaluation,
) {
  const tenantId = tenantOf(deps.ctx);
  const pin = prepared.request.rule_pack;
  let row: EvaluationRow;
  try {
    const snapshot = await ensureSnapshot(client, {
      snapshotId: randomUUID(),
      tenantId,
      cellId: deps.ctx.cell_id,
      packKey: pin.pack_key,
      contentHash: pin.content_hash,
      payloadDigest: prepared.payloadDigest,
      payload: prepared.pack.payload,
      createdBy: deps.ctx.actor.id,
      now: deps.now,
    });
    if (snapshot.payload_digest !== prepared.payloadDigest) {
      throw new Cmp008Error('SF-RULE-001', {
        statusCode: 422,
        details: [{ code: 'RULE_PACK_DIGEST_MISMATCH' }],
      });
    }
    row = await insertEvaluation(client, {
      evaluationId: prepared.evaluationId,
      tenantId,
      cellId: deps.ctx.cell_id,
      snapshotId: snapshot.snapshot_id,
      packKey: pin.pack_key,
      versionId: pin.version_id,
      contentHash: pin.content_hash,
      inputHash: prepared.inputHash,
      purposeCode: prepared.request.purpose_code,
      subjectRef: prepared.request.subject_ref ?? null,
      outcome: prepared.outcome,
      resultCode: prepared.resultCode,
      reasonCodes: prepared.reasonCodes,
      outputs: prepared.result.outputs,
      matchedRules: prepared.result.matchedRules,
      engineName: prepared.engineName,
      engineVersion: prepared.engineVersion,
      simulation: prepared.simulation,
      requestedBy: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  await insertOutbox(
    client,
    envelopeOf({
      eventType: 'RuleEvaluated',
      tenantId,
      cellId: deps.ctx.cell_id,
      aggregateType: 'RuleEvaluation',
      aggregateId: row.evaluation_id,
      aggregateVersion: 1,
      occurredAt: deps.now.toISOString(),
      correlationId: deps.ctx.correlation_id,
      actor: deps.ctx.actor,
      data: {
        evaluation_id: row.evaluation_id,
        pack_key: row.pack_key,
        version_id: row.version_id,
        content_hash: row.content_hash,
        outcome: row.outcome,
        result_code: row.result_code,
        reason_codes: row.reason_codes,
        matched_rule_count: row.matched_rules.length,
        input_hash: row.input_hash,
      },
    }),
  );
  await appendAudit(client, deps.ctx, {
    action: 'RULE_EVALUATION_EXECUTE',
    actionClass: 'DECISION',
    resourceType: 'RuleEvaluation',
    resourceId: row.evaluation_id,
    result: 'SUCCESS',
    reason: row.result_code,
    now: deps.now,
  });
  return evaluationPublic(row);
}

export async function readEvaluation(
  client: PoolClient,
  ctx: RequestContext,
  evaluationId: string,
) {
  const row = await getEvaluation(client, tenantOf(ctx), evaluationId);
  if (!row) throw new Cmp008Error('SF-SYS-002');
  return evaluationPublic(row);
}
