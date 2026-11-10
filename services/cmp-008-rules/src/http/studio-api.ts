import { canonicalJson, sha256Of } from '../domain/canonical.js';
import type { RuleEngine } from '../domain/engine.js';
import { MAX_INPUT_BYTES } from '../domain/inputs.js';
import { OUTCOME_RE, parseRulePack } from '../domain/pack.js';
import { Cmp008Error } from '../errors.js';
import { extractReasonCodes } from '../service/evaluations.js';

/**
 * Studio-facing CMP-008 test bench (SF-M10-C-3), framework-neutral like the CMP-016 Studio API.
 * It parses a draft pack exactly as a published one and runs the author's test cases on the same
 * ZEN engine. Nothing is persisted or pinned; results are advisory rule outputs, never a statutory
 * decision (Constitution #20). Published evaluation stays `POST /v1/evaluations` by pin.
 */

export interface StudioRulesCaller {
  tenant_id: string;
  actor: { type: string; id: string };
  roles: readonly string[];
  correlation_id: string;
  trace_id: string;
  jurisdiction_ids?: readonly string[];
  assurance?: string;
}

export interface StudioRulesApiDeps {
  authorize(
    caller: StudioRulesCaller,
    action: 'RULE_PACK_TEST',
    resource: { type: 'RulePack' },
  ): Promise<boolean>;
  engine: RuleEngine;
  timeoutMs?: number;
}

export interface StudioRulesResponse {
  status: number;
  body: unknown;
}

export const MAX_TEST_CASES = 50;
const PACK_KEYS = ['rule_pack_id', 'engine', 'jdm', 'outcome_field', 'reason_codes_field'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bad(code: string, pointer?: string): Cmp008Error {
  return new Cmp008Error('SF-SYS-003', { details: [pointer ? { code, pointer } : { code }] });
}

/** Content hash of the executable part of a RULES payload (the pin CMP-052 records). */
export function rulePackContentHash(payload: Record<string, unknown>): string {
  return sha256Of(
    Object.fromEntries(
      PACK_KEYS.filter((k) => payload[k] !== undefined).map((k) => [k, payload[k]]),
    ),
  );
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

export function createStudioRulesApi(deps: StudioRulesApiDeps) {
  return {
    async test(caller: StudioRulesCaller, body: unknown): Promise<StudioRulesResponse> {
      try {
        if (!(await deps.authorize(caller, 'RULE_PACK_TEST', { type: 'RulePack' }))) {
          throw new Cmp008Error('SF-AUTH-002');
        }
        if (!isRecord(body) || !isRecord(body['pack'])) throw bad('PACK_REQUIRED', '/pack');
        const payload = body['pack'];
        const key = payload['rule_pack_id'];
        const parsed = parseRulePack(payload, typeof key === 'string' ? key : '');
        const cases = body['cases'];
        if (!Array.isArray(cases) || cases.length > MAX_TEST_CASES) {
          throw bad('CASES_INVALID', '/cases');
        }
        const results = [];
        for (const [i, raw] of cases.entries()) {
          if (!isRecord(raw) || !isRecord(raw['inputs'])) throw bad('CASE_INVALID', `/cases/${i}`);
          const inputs = raw['inputs'];
          if (Buffer.byteLength(canonicalJson(inputs), 'utf8') > MAX_INPUT_BYTES) {
            throw bad('INPUTS_TOO_LARGE', `/cases/${i}/inputs`);
          }
          const id = typeof raw['id'] === 'string' ? raw['id'].slice(0, 64) : String(i);
          try {
            const result = await deps.engine.evaluate(parsed.jdm, inputs, deps.timeoutMs ?? 2000);
            const rawOutcome =
              parsed.outcomeField === null ? undefined : result.outputs[parsed.outcomeField];
            if (
              rawOutcome !== undefined &&
              (typeof rawOutcome !== 'string' || !OUTCOME_RE.test(rawOutcome))
            ) {
              throw new Cmp008Error('SF-RULE-001', {
                statusCode: 422,
                details: [{ code: 'OUTCOME_VALUE_INVALID' }],
              });
            }
            const outcome = (rawOutcome as string | undefined) ?? null;
            const reasonCodes = extractReasonCodes(result.outputs, parsed.reasonCodesField).sort();
            const expectOutcome = raw['expect_outcome'];
            const expectReasons = raw['expect_reasons'];
            const outcomeOk = typeof expectOutcome !== 'string' || expectOutcome === outcome;
            const reasonsOk =
              !Array.isArray(expectReasons) || sameSet(expectReasons.map(String), reasonCodes);
            results.push({
              id,
              pass: outcomeOk && reasonsOk,
              outcome,
              reason_codes: reasonCodes,
              matched_rules: result.matchedRules.map((m) => m.rule_id),
              result_code:
                Object.keys(result.outputs).length > 0 ? 'RULE_OUTPUT_PRODUCED' : 'NO_RULE_OUTPUT',
            });
          } catch (err) {
            if (!(err instanceof Cmp008Error)) throw err;
            results.push({ id, pass: false, error: err.details?.[0]?.code ?? err.code });
          }
        }
        return {
          status: 200,
          body: {
            pack_key: parsed.rulePackId,
            content_hash: rulePackContentHash(payload),
            engine: { name: deps.engine.name, version: deps.engine.version },
            advisory: true,
            passed: results.filter((r) => r.pass).length,
            failed: results.filter((r) => !r.pass).length,
            results,
          },
        };
      } catch (err) {
        if (err instanceof Cmp008Error) {
          return {
            status: err.statusCode,
            body: { error_code: err.code, message: err.message, details: err.details ?? [] },
          };
        }
        return {
          status: 500,
          body: { error_code: 'SF-SYS-001', message: 'Unexpected server error' },
        };
      }
    },
  };
}

export type StudioRulesApi = ReturnType<typeof createStudioRulesApi>;
