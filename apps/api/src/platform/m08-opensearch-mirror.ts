/**
 * SAMPLE_LAB OpenSearch mirror (SF-65 / M08 deepen).
 *
 * INT-010 path as contracts allow today: in-process SIMULATED mirror of CMP-035
 * search projections. REAL OpenSearch via SF-CON-CONNECTOR-BINDING remains deferred
 * (connector_type enum has no OPENSEARCH; REAL_OPENSEARCH_CONNECTOR_DEFERRED).
 * Fail-closed outside simulation environments. No PII; opaque facets only.
 * CERTIFIED=false · G6=false.
 */

export const OPENSEARCH_MIRROR_TOPIC = 'sf.search.events.v1' as const;
export const OPENSEARCH_MIRROR_SIMULATOR_VERSION = 'lab-0.1.0' as const;

export const OPENSEARCH_SIMULATION_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
] as const;

export type OpenSearchSimulationEnvironment = (typeof OPENSEARCH_SIMULATION_ENVIRONMENTS)[number];

export type DeploymentEnvironment =
  OpenSearchSimulationEnvironment | 'UAT' | 'PREPROD' | 'PRODUCTION';

export interface LabOpenSearchDocument {
  document_id: string;
  tenant_id: string;
  source_cmp_id: string;
  source_record_id: string;
  facets: Record<string, string | number | boolean>;
  revision: number;
  mirrored_at: string;
}

export interface LabOpenSearchMirrorStatus {
  mode: 'SIMULATED';
  simulation: 'SIMULATED';
  real_deferred: true;
  connector_binding_contract: 'SF-CON-CONNECTOR-BINDING';
  /** Frozen connector_type enum has no OPENSEARCH — REAL binding cannot be claimed. */
  opensearch_connector_type_in_contract: false;
  topic: typeof OPENSEARCH_MIRROR_TOPIC;
  simulator_version: typeof OPENSEARCH_MIRROR_SIMULATOR_VERSION;
  environment: DeploymentEnvironment;
  document_count: number;
  last_sync_at: string | null;
  certified: false;
  g6_issued: false;
}

export class OpenSearchMirrorRefused extends Error {
  readonly code = 'SF-SYS-003';
  constructor(
    readonly detailCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenSearchMirrorRefused';
  }
}

/** INT-013: SIMULATED OpenSearch mirror never runs in PRODUCTION / UAT / PREPROD. */
export function assertOpenSearchMirrorAllowed(environment: string): void {
  if (environment === 'PRODUCTION') {
    throw new OpenSearchMirrorRefused(
      'OPENSEARCH_MIRROR_PRODUCTION_SIMULATED_FORBIDDEN',
      'SIMULATED OpenSearch mirror refused in PRODUCTION',
    );
  }
  if (!(OPENSEARCH_SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new OpenSearchMirrorRefused(
      'OPENSEARCH_MIRROR_SIMULATED_ENV_FORBIDDEN',
      `SIMULATED OpenSearch mirror refused in ${environment}`,
    );
  }
}

function stripPersonalFacetKeys(
  facets: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(facets)) {
    if (/(name|email|phone|aadhaar|address|token|secret)/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * In-memory SIMULATED OpenSearch index mirror. Consumes CMP-035 projection shapes
 * (not live OpenSearch HTTP). Tenant-partitioned; no cross-tenant reads.
 */
export class LabOpenSearchMirror {
  readonly simulation = 'SIMULATED' as const;
  private readonly docs = new Map<string, LabOpenSearchDocument>();
  private lastSyncAt: string | null = null;

  constructor(
    private readonly tenantId: string,
    private readonly environment: DeploymentEnvironment,
    private readonly clock: () => Date = () => new Date(),
  ) {
    assertOpenSearchMirrorAllowed(environment);
  }

  upsert(input: {
    document_id: string;
    tenant_id: string;
    source_cmp_id: string;
    source_record_id: string;
    facets: Record<string, string | number | boolean>;
    revision?: number;
  }): void {
    if (input.tenant_id !== this.tenantId) return;
    const now = this.clock().toISOString();
    this.docs.set(input.document_id, {
      document_id: input.document_id,
      tenant_id: input.tenant_id,
      source_cmp_id: input.source_cmp_id,
      source_record_id: input.source_record_id,
      facets: stripPersonalFacetKeys(input.facets),
      revision: input.revision && input.revision > 0 ? input.revision : 1,
      mirrored_at: now,
    });
    this.lastSyncAt = now;
  }

  remove(documentId: string, tenantId: string): void {
    if (tenantId !== this.tenantId) return;
    this.docs.delete(documentId);
    this.lastSyncAt = this.clock().toISOString();
  }

  syncFromSeeds(
    seeds: readonly {
      document_id: string;
      source_record_id: string;
      source_cmp_id: string;
      facets: Record<string, string | number | boolean>;
    }[],
  ): { upserted: number } {
    let upserted = 0;
    for (const seed of seeds) {
      this.upsert({
        document_id: seed.document_id,
        tenant_id: this.tenantId,
        source_cmp_id: seed.source_cmp_id,
        source_record_id: seed.source_record_id,
        facets: seed.facets,
      });
      upserted += 1;
    }
    return { upserted };
  }

  /** Tenant-safe facet query against the mirror (opaque scalars only). */
  query(input: {
    tenant_id: string;
    facets?: Record<string, string | number | boolean>;
    limit?: number;
  }): LabOpenSearchDocument[] {
    if (input.tenant_id !== this.tenantId) return [];
    const wanted = input.facets ?? {};
    const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 100) : 20;
    const hits: LabOpenSearchDocument[] = [];
    for (const doc of this.docs.values()) {
      let match = true;
      for (const [k, v] of Object.entries(wanted)) {
        if (doc.facets[k] !== v) {
          match = false;
          break;
        }
      }
      if (match) hits.push(doc);
      if (hits.length >= limit) break;
    }
    return hits;
  }

  documentCount(): number {
    return this.docs.size;
  }

  status(): LabOpenSearchMirrorStatus {
    return {
      mode: 'SIMULATED',
      simulation: 'SIMULATED',
      real_deferred: true,
      connector_binding_contract: 'SF-CON-CONNECTOR-BINDING',
      opensearch_connector_type_in_contract: false,
      topic: OPENSEARCH_MIRROR_TOPIC,
      simulator_version: OPENSEARCH_MIRROR_SIMULATOR_VERSION,
      environment: this.environment,
      document_count: this.docs.size,
      last_sync_at: this.lastSyncAt,
      certified: false,
      g6_issued: false,
    };
  }
}

/** Fail-closed stand-in when mirror is unbound (never fabricates healthy REAL OpenSearch). */
export class UnboundOpenSearchMirror {
  status(): never {
    throw new OpenSearchMirrorRefused(
      'OPENSEARCH_MIRROR_UNBOUND',
      'OpenSearch mirror unbound — REAL connector deferred; refusing fabricated health',
    );
  }

  query(): never {
    throw new OpenSearchMirrorRefused('OPENSEARCH_MIRROR_UNBOUND', 'OpenSearch mirror unbound');
  }
}
