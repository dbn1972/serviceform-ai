import type { ProjectionRule } from '../domain/projection.js';

export interface ProjectionRuleLookup {
  tenantId: string;
  topic: string;
  aggregateType: string;
  eventType: string;
}

/**
 * Resolves the published index projection rule for an event (metadata, CMP-033/052 versioned).
 * Returning null means the event is not indexed. Called before the domain transaction opens.
 */
export interface ProjectionRulePort {
  readonly simulation?: 'SIMULATED';
  resolve(lookup: ProjectionRuleLookup): Promise<ProjectionRule | null>;
}

export function noProjectionRules(): ProjectionRulePort {
  return {
    async resolve() {
      return null;
    },
  };
}

/**
 * INT-013 SIMULATED rule source for LOCAL/CI/SIT. Rules are supplied as data; assertPortAllowed
 * refuses it in PRODUCTION.
 */
export class SimulatedProjectionRules implements ProjectionRulePort {
  readonly simulation = 'SIMULATED' as const;

  constructor(private readonly rules: readonly ProjectionRule[]) {}

  async resolve(lookup: ProjectionRuleLookup): Promise<ProjectionRule | null> {
    return (
      this.rules.find(
        (r) =>
          r.topic === lookup.topic &&
          r.aggregate_type === lookup.aggregateType &&
          (r.upsert_event_types.includes(lookup.eventType) ||
            r.remove_event_types.includes(lookup.eventType)),
      ) ?? null
    );
  }
}
