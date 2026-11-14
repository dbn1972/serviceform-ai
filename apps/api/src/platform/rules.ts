import { canonicalSha256 } from './forms.js';

/** Structural subset of CMP-008 `PublishedRulePack` / `RulePackRequest`. */
export interface PublishedRulePackLike {
  tenant_id: string;
  pack_key: string;
  version_id: string;
  content_hash: string;
  status: 'PUBLISHED';
  payload: unknown;
}

export interface RulePackRequestLike {
  tenantId: string;
  packKey: string;
  versionId: string;
  contentHash: string;
  correlationId: string;
}

export interface RulePackSourceLike {
  resolve(request: RulePackRequestLike): Promise<PublishedRulePackLike>;
}

/** CMP-033 `readPublishedDocument` for RULES (host-bound to CMP-033's pool). */
export type PublishedRulesReader = (input: {
  tenantId: string;
  documentId: string;
  kind: 'RULES';
}) => Promise<{ document_id: string; payload: unknown } | null>;

const RULE_PACK_KEYS = [
  'rule_pack_id',
  'engine',
  'jdm',
  'outcome_field',
  'reason_codes_field',
] as const;

function executablePack(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    RULE_PACK_KEYS.filter((k) => payload[k] !== undefined).map((k) => [k, payload[k]]),
  );
}

/**
 * SF-M10-C-3 / live-pins: CMP-008 RulePackPort for the SAMPLE_LAB host. Prefers an optional
 * SIMULATED catalogue, then Studio RULES documents frozen in CMP-033 (PUBLISHED, immutable). The
 * version id of a Studio pack is its CMP-033 document id; the content hash is recomputed from the
 * executable bytes rather than trusted.
 */
export class StudioPublishedRulePackPort implements RulePackSourceLike {
  constructor(
    private readonly deps: {
      catalogue?: RulePackSourceLike;
      read: PublishedRulesReader;
      isNotFound: (err: unknown) => boolean;
      notFound: () => Error;
    },
  ) {}

  async resolve(request: RulePackRequestLike): Promise<PublishedRulePackLike> {
    // Catalogue lookups need a pack key; version-only reads go straight to CMP-033.
    if (this.deps.catalogue && request.packKey.length > 0) {
      try {
        return await this.deps.catalogue.resolve(request);
      } catch (err) {
        if (!this.deps.isNotFound(err)) throw err;
      }
    }
    const doc = await this.deps.read({
      tenantId: request.tenantId,
      documentId: request.versionId,
      kind: 'RULES',
    });
    const payload = doc?.payload;
    if (!doc || typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw this.deps.notFound();
    }
    const body = payload as Record<string, unknown>;
    const packKey = body['rule_pack_id'];
    const engine = body['engine'];
    const jdm = body['jdm'];
    if (
      typeof packKey !== 'string' ||
      engine !== 'GORULES' ||
      typeof jdm !== 'object' ||
      jdm === null
    ) {
      throw this.deps.notFound();
    }
    if (request.packKey.length > 0 && request.packKey !== packKey) {
      throw this.deps.notFound();
    }
    const contentHash = canonicalSha256(executablePack(body));
    if (request.contentHash.length > 0 && request.contentHash !== contentHash) {
      throw this.deps.notFound();
    }
    return {
      tenant_id: request.tenantId,
      pack_key: packKey,
      version_id: doc.document_id,
      content_hash: contentHash,
      status: 'PUBLISHED',
      payload: body,
    };
  }
}

/** Structural subset of CMP-016 `RuleEvaluationPort`. */
export interface RuleEvaluationRequest {
  application_id: string;
  node_id: string;
  rule_ref: string;
}

export interface RuleEvaluationPortLike {
  evaluate(
    ctx: { tenant_id: string; correlation_id: string },
    request: RuleEvaluationRequest,
  ): Promise<{ outcome: string }>;
}

export interface RuleEngineLike {
  evaluate(
    jdm: unknown,
    inputs: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ outputs: Record<string, unknown> }>;
}

const OUTCOME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Temporal RuleEvaluationPort for SAMPLE_LAB: resolves the case's pinned Studio RULES document
 * (CMP-033) and evaluates it on the CMP-008 ZEN engine. Advisory outcomes only — never a statutory
 * APPROVE/REJECT decision by an LLM. Fail closed when the pack, pin or outcome is missing.
 */
export class StudioRuleEvaluationPort implements RuleEvaluationPortLike {
  constructor(
    private readonly deps: {
      loadCase: (
        tenantId: string,
        applicationId: string,
        correlationId: string,
      ) => Promise<{
        rule_version_id: string;
        inputs: Record<string, unknown>;
      }>;
      packs: RulePackSourceLike;
      engine: RuleEngineLike;
      timeoutMs?: number;
      refuse: (code: string) => Error;
    },
  ) {}

  async evaluate(
    ctx: { tenant_id: string; correlation_id: string },
    request: RuleEvaluationRequest,
  ): Promise<{ outcome: string }> {
    void request.rule_ref;
    void request.node_id;
    const loaded = await this.deps.loadCase(
      ctx.tenant_id,
      request.application_id,
      ctx.correlation_id,
    );
    let pack: PublishedRulePackLike;
    try {
      pack = await this.deps.packs.resolve({
        tenantId: ctx.tenant_id,
        packKey: '',
        versionId: loaded.rule_version_id,
        contentHash: '',
        correlationId: ctx.correlation_id,
      });
    } catch {
      throw this.deps.refuse('RULE_PACK_NOT_FOUND');
    }
    const payload = pack.payload as Record<string, unknown>;
    const outcomeField =
      typeof payload['outcome_field'] === 'string' ? payload['outcome_field'] : null;
    if (!outcomeField) throw this.deps.refuse('RULE_OUTCOME_FIELD_MISSING');
    const result = await this.deps.engine.evaluate(
      payload['jdm'],
      loaded.inputs,
      this.deps.timeoutMs ?? 2000,
    );
    const outcome = result.outputs[outcomeField];
    if (typeof outcome !== 'string' || !OUTCOME_RE.test(outcome)) {
      throw this.deps.refuse('RULE_OUTCOME_INVALID');
    }
    return { outcome };
  }
}
