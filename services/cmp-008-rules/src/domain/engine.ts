import { ZenEngine } from '@gorules/zen-engine';
import { Cmp008Error } from '../errors.js';
import { canonicalJson } from './canonical.js';
import type { Jdm } from './jdm.js';
import { MAX_OUTPUT_BYTES } from './inputs.js';

export const ZEN_ENGINE_NAME = 'gorules-zen';
export const ZEN_ENGINE_VERSION = '2.0.2';

export interface MatchedRule {
  node_id: string;
  rule_id: string;
}

export interface EngineResult {
  outputs: Record<string, unknown>;
  matchedRules: MatchedRule[];
}

/** Deterministic rule executor port. No network, model or clock access is available to it. */
export interface RuleEngine {
  readonly name: string;
  readonly version: string;
  evaluate(jdm: Jdm, inputs: Record<string, unknown>, timeoutMs: number): Promise<EngineResult>;
}

interface TraceEntry {
  order?: number;
  traceData?: unknown;
}

function ruleIdsOf(traceData: unknown): string[] {
  const one = (d: unknown): string[] => {
    if (typeof d !== 'object' || d === null) return [];
    const rule = (d as { rule?: { _id?: unknown } }).rule;
    return typeof rule?._id === 'string' ? [rule._id] : [];
  };
  return Array.isArray(traceData) ? traceData.flatMap(one) : one(traceData);
}

function failed(cause?: unknown): Cmp008Error {
  return new Cmp008Error('SF-RULE-001', {
    statusCode: 422,
    details: [{ code: 'RULE_EVALUATION_FAILED' }],
    cause,
  });
}

export class ZenRuleEngine implements RuleEngine {
  readonly name = ZEN_ENGINE_NAME;
  readonly version = ZEN_ENGINE_VERSION;
  private readonly engine = new ZenEngine();

  async evaluate(
    jdm: Jdm,
    inputs: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<EngineResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const decision = this.engine.createDecision(Buffer.from(JSON.stringify(jdm), 'utf8'));
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(failed('timeout')), timeoutMs);
      });
      const response = await Promise.race([
        decision.evaluate(structuredClone(inputs), { trace: true, maxDepth: 8 }),
        timeout,
      ]);
      const outputs: unknown = response.result;
      if (typeof outputs !== 'object' || outputs === null || Array.isArray(outputs)) {
        throw failed('non-object result');
      }
      if (Buffer.byteLength(canonicalJson(outputs), 'utf8') > MAX_OUTPUT_BYTES) {
        throw failed('output too large');
      }
      const trace = (response.trace ?? {}) as Record<string, TraceEntry>;
      const matchedRules: MatchedRule[] = Object.entries(trace)
        .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))
        .flatMap(([nodeId, entry]) =>
          ruleIdsOf(entry.traceData).map((ruleId) => ({ node_id: nodeId, rule_id: ruleId })),
        );
      return { outputs: outputs as Record<string, unknown>, matchedRules };
    } catch (err) {
      if (err instanceof Cmp008Error) throw err;
      throw failed(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
