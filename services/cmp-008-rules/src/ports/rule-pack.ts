import type { SimulationMarker } from '@serviceform/contracts';
import { buildSimulationMarker, type RulesConfig } from '../config.js';
import { Cmp008Error } from '../errors.js';

export interface PublishedRulePack {
  tenant_id: string;
  pack_key: string;
  version_id: string;
  content_hash: string;
  status: 'PUBLISHED';
  payload: unknown;
  simulation?: SimulationMarker;
}

export interface RulePackRequest {
  tenantId: string;
  packKey: string;
  versionId: string;
  contentHash: string;
  correlationId: string;
}

/**
 * Consumer-side port to published RULES metadata (CMP-033 / CMP-052 pins). Resolved before the
 * authoritative transaction opens; CMP-008 never reads another component's tables.
 */
export interface RulePackPort {
  resolve(request: RulePackRequest): Promise<PublishedRulePack>;
}

export class RulePackNotFoundError extends Error {
  constructor() {
    super('rule pack not found');
    this.name = 'RulePackNotFoundError';
  }
}

export class DenyRulePackPort implements RulePackPort {
  async resolve(): Promise<PublishedRulePack> {
    throw new Cmp008Error('SF-SYS-004', { details: [{ code: 'RULE_PACK_SOURCE_UNAVAILABLE' }] });
  }
}

/** SIMULATED published-metadata source for LOCAL/CI/SIT only; never admitted in PRODUCTION. */
export class SimulatedRulePackPort implements RulePackPort {
  private readonly packs = new Map<string, PublishedRulePack>();

  constructor(private readonly config: RulesConfig) {
    if (config.packSourceMode !== 'SIMULATED') {
      throw new Cmp008Error('SF-SYS-003', { details: [{ code: 'PACK_SOURCE_NOT_SIMULATED' }] });
    }
  }

  publish(pack: Omit<PublishedRulePack, 'status'>): void {
    this.packs.set(this.keyOf(pack.tenant_id, pack.pack_key, pack.version_id), {
      ...pack,
      status: 'PUBLISHED',
    });
  }

  async resolve(request: RulePackRequest): Promise<PublishedRulePack> {
    const found = this.packs.get(this.keyOf(request.tenantId, request.packKey, request.versionId));
    if (!found) throw new RulePackNotFoundError();
    return {
      ...found,
      simulation: buildSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.packSourceBindingId,
      }),
    };
  }

  private keyOf(tenantId: string, packKey: string, versionId: string): string {
    return `${tenantId}|${packKey}|${versionId}`;
  }
}

export function wrapRulePackPort(port: RulePackPort): RulePackPort {
  return {
    async resolve(request) {
      try {
        return await port.resolve(request);
      } catch (err) {
        if (err instanceof Cmp008Error) throw err;
        if (err instanceof RulePackNotFoundError) {
          throw new Cmp008Error('SF-SYS-002', {
            details: [{ code: 'RULE_PACK_NOT_FOUND' }],
            cause: err,
          });
        }
        throw new Cmp008Error('SF-SYS-004', {
          details: [{ code: 'RULE_PACK_SOURCE_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}

export function failingRulePackPort(): RulePackPort {
  return {
    async resolve() {
      throw new Error('rule-pack-source-timeout');
    },
  };
}
