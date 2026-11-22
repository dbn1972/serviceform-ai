import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SearchQueryService,
  PgSearchStore,
  type SearchDocumentRow,
  type SearchStore,
} from '@serviceform/cmp-035-search-indexing';
import { buildAnalyticsService, type AnalyticsService } from '@serviceform/cmp-045-analytics-mis';
import {
  buildOpsDashboardService,
  VIEW_CODES,
  type OperationalDashboardService,
  type PortSample,
  type SummaryPort,
  type ViewCode,
} from '@serviceform/cmp-046-operational-dashboard';
import {
  buildServiceDiscoveryService,
  type CatalogueEntry,
  type CataloguePort,
  type JurisdictionPort,
  type SearchPort,
  type ServiceDiscoveryService,
} from '@serviceform/cmp-006-service-discovery';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  assertOpenSearchMirrorAllowed,
  LabOpenSearchMirror,
  type DeploymentEnvironment,
  type LabOpenSearchMirrorStatus,
} from './m08-opensearch-mirror.js';

/**
 * SAMPLE_LAB M08 host adapter (search / discovery / analytics / ops).
 * SF-63 thin UI + SF-65 richer ops ports / SIMULATED OpenSearch lab mirror.
 * Surfaces existing CMP-035/045/046/006 engines — no statute, no PII in facets/logs.
 * REAL OpenSearch deferred (no OPENSEARCH connector_type in frozen SF-CON-CONNECTOR-BINDING).
 * CERTIFIED=false · G6=false.
 */

export interface LabSearchDocumentSeed {
  document_id: string;
  source_record_id: string;
  source_cmp_id: string;
  facets: Record<string, string | number | boolean>;
}

export interface LabMetricDefinitionSeed {
  metric_code: string;
  publication_ref: string;
  purpose_code: string;
  source_event_type: string;
  source_aggregate_type: string;
  source_schema_version: number;
  aggregation: 'COUNT' | 'SUM';
  value_field: string | null;
  period_granularity: string;
  dimensions: readonly {
    key: string;
    source_field: string;
    allowed_values?: readonly string[];
  }[];
  min_cohort_size: number;
}

export interface LabOpsSample {
  status: 'OK' | 'DEGRADED' | 'UNAVAILABLE';
  metrics: readonly {
    metric_code: string;
    value: number;
    dimensions?: Record<string, string | number | boolean>;
  }[];
}

export interface LabDiscoveryService {
  service_id: string;
  service_code: string;
  category_code: string | null;
  service_binding_version_id: string;
  label_key: string | null;
  label: string;
  jurisdiction_codes: readonly string[];
}

export interface LabOpenSearchMirrorSeed {
  enabled: boolean;
  mode: 'SIMULATED';
  real_deferred: true;
  topic: string;
}

export interface LabM08OpsCatalogue {
  workload: { actor_id: string; roles: readonly string[] };
  catalogue_version_id: string;
  jurisdiction_code: string;
  search_documents: readonly LabSearchDocumentSeed[];
  metric_definitions: readonly LabMetricDefinitionSeed[];
  ops_samples: Readonly<Partial<Record<ViewCode, LabOpsSample>>>;
  discovery_services: readonly LabDiscoveryService[];
  opensearch_mirror: LabOpenSearchMirrorSeed;
}

const DEFAULT_WORKLOAD = {
  actor_id: '00800800-0000-4000-8000-008008008008',
  roles: ['SAMPLE_LAB_OPS_ANALYST'] as const,
};

const DEFAULT_OPENSEARCH_MIRROR: LabOpenSearchMirrorSeed = {
  enabled: true,
  mode: 'SIMULATED',
  real_deferred: true,
  topic: 'sf.search.events.v1',
};

const DEFAULT_CATALOGUE: LabM08OpsCatalogue = {
  workload: DEFAULT_WORKLOAD,
  catalogue_version_id: '0d15ba00-0c08-4000-8000-0d15ba000c08',
  jurisdiction_code: 'IN-OD-SAMPLE-LAB',
  search_documents: [],
  metric_definitions: [],
  ops_samples: {},
  discovery_services: [],
  opensearch_mirror: DEFAULT_OPENSEARCH_MIRROR,
};

export function parseM08OpsCatalogue(raw: unknown): LabM08OpsCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const workloadRaw =
    obj['workload'] && typeof obj['workload'] === 'object'
      ? (obj['workload'] as Record<string, unknown>)
      : {};
  const actor_id =
    typeof workloadRaw['actor_id'] === 'string' && workloadRaw['actor_id'].length > 0
      ? workloadRaw['actor_id']
      : DEFAULT_WORKLOAD.actor_id;
  const roles = Array.isArray(workloadRaw['roles'])
    ? (workloadRaw['roles'] as string[]).filter((r) => typeof r === 'string' && r.length > 0)
    : [...DEFAULT_WORKLOAD.roles];

  const search_documents: LabSearchDocumentSeed[] = [];
  for (const entry of Array.isArray(obj['search_documents']) ? obj['search_documents'] : []) {
    if (!entry || typeof entry !== 'object') continue;
    const d = entry as Record<string, unknown>;
    const document_id = typeof d['document_id'] === 'string' ? d['document_id'] : '';
    const source_record_id = typeof d['source_record_id'] === 'string' ? d['source_record_id'] : '';
    const source_cmp_id = typeof d['source_cmp_id'] === 'string' ? d['source_cmp_id'] : '';
    if (!document_id || !source_record_id || !source_cmp_id) continue;
    const facetsRaw = d['facets'] && typeof d['facets'] === 'object' ? d['facets'] : {};
    const facets: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(facetsRaw as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') facets[k] = v;
    }
    search_documents.push({ document_id, source_record_id, source_cmp_id, facets });
  }

  const metric_definitions: LabMetricDefinitionSeed[] = [];
  for (const entry of Array.isArray(obj['metric_definitions']) ? obj['metric_definitions'] : []) {
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Record<string, unknown>;
    const metric_code = typeof m['metric_code'] === 'string' ? m['metric_code'] : '';
    if (!metric_code) continue;
    metric_definitions.push({
      metric_code,
      publication_ref:
        typeof m['publication_ref'] === 'string' ? m['publication_ref'] : metric_code,
      purpose_code: typeof m['purpose_code'] === 'string' ? m['purpose_code'] : 'OPS_MIS',
      source_event_type:
        typeof m['source_event_type'] === 'string'
          ? m['source_event_type']
          : 'ApplicationCaseTransitioned',
      source_aggregate_type:
        typeof m['source_aggregate_type'] === 'string'
          ? m['source_aggregate_type']
          : 'ApplicationCase',
      source_schema_version:
        typeof m['source_schema_version'] === 'number' ? m['source_schema_version'] : 1,
      aggregation: m['aggregation'] === 'SUM' ? 'SUM' : 'COUNT',
      value_field: typeof m['value_field'] === 'string' ? m['value_field'] : null,
      period_granularity:
        typeof m['period_granularity'] === 'string' ? m['period_granularity'] : 'DAY',
      dimensions: Array.isArray(m['dimensions'])
        ? (m['dimensions'] as unknown[])
            .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
            .map((d) => ({
              key: typeof d['key'] === 'string' ? d['key'] : '',
              source_field: typeof d['source_field'] === 'string' ? d['source_field'] : '',
              ...(Array.isArray(d['allowed_values'])
                ? {
                    allowed_values: (d['allowed_values'] as unknown[]).filter(
                      (v): v is string => typeof v === 'string',
                    ),
                  }
                : {}),
            }))
            .filter((d) => d.key && d.source_field)
        : [],
      min_cohort_size: typeof m['min_cohort_size'] === 'number' ? m['min_cohort_size'] : 1,
    });
  }

  const ops_samples: Partial<Record<ViewCode, LabOpsSample>> = {};
  const samplesRaw =
    obj['ops_samples'] && typeof obj['ops_samples'] === 'object'
      ? (obj['ops_samples'] as Record<string, unknown>)
      : {};
  for (const code of VIEW_CODES) {
    const sample = samplesRaw[code];
    if (!sample || typeof sample !== 'object') continue;
    const s = sample as Record<string, unknown>;
    const status =
      s['status'] === 'DEGRADED' || s['status'] === 'UNAVAILABLE' || s['status'] === 'OK'
        ? s['status']
        : 'OK';
    const metrics = Array.isArray(s['metrics']) ? (s['metrics'] as LabOpsSample['metrics']) : [];
    ops_samples[code] = { status, metrics };
  }

  const discovery_services: LabDiscoveryService[] = [];
  for (const entry of Array.isArray(obj['discovery_services']) ? obj['discovery_services'] : []) {
    if (!entry || typeof entry !== 'object') continue;
    const d = entry as Record<string, unknown>;
    const service_id = typeof d['service_id'] === 'string' ? d['service_id'] : '';
    const service_code = typeof d['service_code'] === 'string' ? d['service_code'] : '';
    const service_binding_version_id =
      typeof d['service_binding_version_id'] === 'string' ? d['service_binding_version_id'] : '';
    if (!service_id || !service_code || !service_binding_version_id) continue;
    discovery_services.push({
      service_id,
      service_code,
      category_code: typeof d['category_code'] === 'string' ? d['category_code'] : null,
      service_binding_version_id,
      label_key: typeof d['label_key'] === 'string' ? d['label_key'] : null,
      label: typeof d['label'] === 'string' ? d['label'] : service_code,
      jurisdiction_codes: Array.isArray(d['jurisdiction_codes'])
        ? (d['jurisdiction_codes'] as string[]).filter((c) => typeof c === 'string')
        : [],
    });
  }

  const mirrorRaw =
    obj['opensearch_mirror'] && typeof obj['opensearch_mirror'] === 'object'
      ? (obj['opensearch_mirror'] as Record<string, unknown>)
      : {};
  const opensearch_mirror: LabOpenSearchMirrorSeed = {
    enabled: mirrorRaw['enabled'] === false ? false : true,
    mode: 'SIMULATED',
    real_deferred: true,
    topic:
      typeof mirrorRaw['topic'] === 'string' && mirrorRaw['topic'].length > 0
        ? mirrorRaw['topic']
        : DEFAULT_OPENSEARCH_MIRROR.topic,
  };

  return {
    workload: { actor_id, roles },
    catalogue_version_id:
      typeof obj['catalogue_version_id'] === 'string'
        ? obj['catalogue_version_id']
        : DEFAULT_CATALOGUE.catalogue_version_id,
    jurisdiction_code:
      typeof obj['jurisdiction_code'] === 'string'
        ? obj['jurisdiction_code']
        : DEFAULT_CATALOGUE.jurisdiction_code,
    search_documents,
    metric_definitions,
    ops_samples,
    discovery_services,
    opensearch_mirror,
  };
}

export function loadM08OpsCatalogue(dir: string): LabM08OpsCatalogue {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'm08-ops-catalogue.json'), 'utf8')) as unknown;
    return parseM08OpsCatalogue(raw);
  } catch {
    return DEFAULT_CATALOGUE;
  }
}

/** Static catalogue fixture port (non-authoritative SAMPLE_LAB aggregates). */
class LabFixtureSummaryPort implements SummaryPort {
  constructor(
    private readonly sample: LabOpsSample,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  fetchSummary(): Promise<PortSample> {
    return Promise.resolve({
      status: this.sample.status,
      source_observed_at: this.clock().toISOString(),
      metrics: this.sample.metrics.map((m) => ({
        metric_code: m.metric_code,
        value: m.value,
        ...(m.dimensions ? { dimensions: { ...m.dimensions } } : {}),
      })),
    });
  }
}

/**
 * Richer INTEGRATION_HEALTH port: merges catalogue fixture with live OpenSearch
 * mirror counts. REAL OpenSearch remains deferred — status stays DEGRADED when
 * the mirror is SIMULATED, never claims REAL health.
 */
class LabIntegrationHealthPort implements SummaryPort {
  constructor(
    private readonly sample: LabOpsSample | undefined,
    private readonly mirror: LabOpenSearchMirror | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  fetchSummary(): Promise<PortSample> {
    const base = this.sample
      ? {
          status: this.sample.status,
          metrics: this.sample.metrics.map((m) => ({
            metric_code: m.metric_code,
            value: m.value,
            ...(m.dimensions ? { dimensions: { ...m.dimensions } } : {}),
          })),
        }
      : {
          status: 'DEGRADED' as const,
          metrics: [
            {
              metric_code: 'CONNECTOR_MODE',
              value: 1,
              dimensions: { mode: 'SIMULATED' },
            },
          ],
        };
    const metrics = [...base.metrics];
    const seen = new Set(
      metrics.map(
        (m) =>
          `${m.metric_code}|${JSON.stringify(m.dimensions ?? {}, Object.keys(m.dimensions ?? {}).sort())}`,
      ),
    );
    const push = (metric: PortSample['metrics'][number]) => {
      const id = `${metric.metric_code}|${JSON.stringify(metric.dimensions ?? {}, Object.keys(metric.dimensions ?? {}).sort())}`;
      if (seen.has(id)) return;
      seen.add(id);
      metrics.push(metric);
    };
    if (this.mirror) {
      const st = this.mirror.status();
      push({
        metric_code: 'INDEX_DOCUMENTS',
        value: st.document_count,
        dimensions: { index: 'search' },
      });
      push({
        metric_code: 'REAL_DEFERRED',
        value: 1,
        dimensions: { adapter: 'opensearch' },
      });
      push({
        metric_code: 'MIRROR_SYNC',
        value: st.last_sync_at ? 1 : 0,
        dimensions: { topic: 'search_events' },
      });
    } else {
      push({
        metric_code: 'MIRROR_UNBOUND',
        value: 1,
        dimensions: { adapter: 'opensearch' },
      });
    }
    const status: PortSample['status'] =
      !this.mirror || base.status === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : base.status === 'OK' && this.mirror
          ? 'DEGRADED'
          : base.status;
    return Promise.resolve({
      status,
      source_observed_at: this.clock().toISOString(),
      metrics,
    });
  }
}

/**
 * Richer PLATFORM_HEALTH: catalogue readiness plus search projection / mirror counts.
 * Dimension keys avoid personal/record identifiers (CMP-046 normalizeSample).
 */
class LabPlatformHealthPort implements SummaryPort {
  constructor(
    private readonly sample: LabOpsSample | undefined,
    private readonly mirror: LabOpenSearchMirror | null,
    private readonly searchDocCount: () => number,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  fetchSummary(): Promise<PortSample> {
    const metrics: PortSample['metrics'] = [];
    if (this.sample) {
      for (const m of this.sample.metrics) {
        metrics.push({
          metric_code: m.metric_code,
          value: m.value,
          ...(m.dimensions ? { dimensions: { ...m.dimensions } } : {}),
        });
      }
    } else {
      metrics.push({
        metric_code: 'READINESS',
        value: 1,
        dimensions: { component: 'SAMPLE_LAB' },
      });
    }
    metrics.push({
      metric_code: 'SEARCH_PROJECTIONS',
      value: this.searchDocCount(),
      dimensions: { store: 'cmp035' },
    });
    metrics.push({
      metric_code: 'OPENSEARCH_MIRROR',
      value: this.mirror ? this.mirror.documentCount() : 0,
      dimensions: { mode: this.mirror ? 'SIMULATED' : 'UNBOUND' },
    });
    return Promise.resolve({
      status: this.sample?.status ?? 'OK',
      source_observed_at: this.clock().toISOString(),
      metrics,
    });
  }
}

/** Derive opaque catalogue/state facet counts for QUEUE_SUMMARY enrichment. */
export function deriveSearchFacetMetrics(
  docs: readonly LabSearchDocumentSeed[],
): PortSample['metrics'] {
  const byCatalogue = new Map<string, number>();
  const byState = new Map<string, number>();
  for (const doc of docs) {
    const cat = doc.facets['catalogue_id'];
    if (typeof cat === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(cat)) {
      byCatalogue.set(cat, (byCatalogue.get(cat) ?? 0) + 1);
    }
    const state = doc.facets['case_state'];
    if (typeof state === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(state)) {
      byState.set(state, (byState.get(state) ?? 0) + 1);
    }
  }
  const metrics: PortSample['metrics'] = [];
  for (const [catalogue, value] of byCatalogue) {
    metrics.push({
      metric_code: 'INDEXED_BY_CATALOGUE',
      value,
      dimensions: { catalogue },
    });
  }
  for (const [state, value] of byState) {
    metrics.push({
      metric_code: 'INDEXED_BY_STATE',
      value,
      dimensions: { state },
    });
  }
  return metrics;
}

class LabQueueSummaryPort implements SummaryPort {
  constructor(
    private readonly sample: LabOpsSample | undefined,
    private readonly docs: readonly LabSearchDocumentSeed[],
    private readonly clock: () => Date = () => new Date(),
  ) {}
  fetchSummary(): Promise<PortSample> {
    const metrics: PortSample['metrics'] = [];
    if (this.sample) {
      for (const m of this.sample.metrics) {
        metrics.push({
          metric_code: m.metric_code,
          value: m.value,
          ...(m.dimensions ? { dimensions: { ...m.dimensions } } : {}),
        });
      }
    }
    for (const m of deriveSearchFacetMetrics(this.docs)) {
      metrics.push(m);
    }
    return Promise.resolve({
      status: this.sample?.status ?? 'OK',
      source_observed_at: this.clock().toISOString(),
      metrics,
    });
  }
}

class LabCataloguePort implements CataloguePort {
  constructor(
    private readonly tenantId: string,
    private readonly catalogueVersionId: string,
    private readonly services: readonly LabDiscoveryService[],
  ) {}

  getVersion(input: {
    tenantId: string;
    catalogueVersionId: string;
  }): Promise<{ tenant_id: string; catalogue_version_id: string; status: 'PUBLISHED' } | null> {
    if (input.tenantId !== this.tenantId) return Promise.resolve(null);
    if (input.catalogueVersionId !== this.catalogueVersionId) return Promise.resolve(null);
    return Promise.resolve({
      tenant_id: this.tenantId,
      catalogue_version_id: this.catalogueVersionId,
      status: 'PUBLISHED',
    });
  }

  getEntries(input: {
    tenantId: string;
    catalogueVersionId: string;
    serviceIds: string[];
  }): Promise<CatalogueEntry[]> {
    if (input.tenantId !== this.tenantId || input.catalogueVersionId !== this.catalogueVersionId) {
      return Promise.resolve([]);
    }
    const wanted = new Set(input.serviceIds);
    return Promise.resolve(
      this.services
        .filter((s) => wanted.has(s.service_id))
        .map((s) => ({
          tenant_id: this.tenantId,
          catalogue_version_id: this.catalogueVersionId,
          service_id: s.service_id,
          service_code: s.service_code,
          category_code: s.category_code,
          service_binding_version_id: s.service_binding_version_id,
          label_key: s.label_key,
          jurisdiction_codes: [...s.jurisdiction_codes],
          status: 'PUBLISHED' as const,
        })),
    );
  }
}

class LabJurisdictionPort implements JurisdictionPort {
  constructor(private readonly code: string) {}
  resolve(input: {
    tenantId: string;
    codes: string[];
  }): Promise<{ code: string; active: boolean; applicable_codes: string[] }[]> {
    void input.tenantId;
    return Promise.resolve(
      input.codes
        .filter((c) => c === this.code)
        .map((code) => ({ code, active: true, applicable_codes: [code] })),
    );
  }
}

class LabDiscoverySearchPort implements SearchPort {
  constructor(
    private readonly tenantId: string,
    private readonly services: readonly LabDiscoveryService[],
  ) {}
  searchServices(input: {
    tenantId: string;
    catalogueVersionId: string;
    jurisdictionCodes: string[];
    serviceCodes: string[];
    keywords: string[];
    limit: number;
    offset: number;
  }): Promise<{ tenant_id: string; service_id: string }[]> {
    if (input.tenantId !== this.tenantId) return Promise.resolve([]);
    const codes = new Set(input.serviceCodes.map((c) => c.toUpperCase()));
    const keywords = input.keywords.map((k) => k.toLowerCase());
    const juris = new Set(input.jurisdictionCodes);
    let rows = this.services.filter((s) => {
      if (codes.size > 0 && !codes.has(s.service_code.toUpperCase())) return false;
      if (juris.size > 0 && !s.jurisdiction_codes.some((j) => juris.has(j))) return false;
      if (keywords.length === 0) return true;
      const hay = `${s.service_code} ${s.label}`.toLowerCase();
      return keywords.every((k) => hay.includes(k));
    });
    rows = rows.slice(input.offset, input.offset + input.limit);
    return Promise.resolve(
      rows.map((s) => ({ tenant_id: this.tenantId, service_id: s.service_id })),
    );
  }
}

function workloadContext(
  catalogue: LabM08OpsCatalogue,
  cellId: string,
  tenantId: string,
): RequestContext & { tenant_id: string } {
  return {
    tenant_id: tenantId,
    cell_id: cellId,
    actor: { type: 'SYSTEM', id: catalogue.workload.actor_id },
    roles: [...catalogue.workload.roles],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: createHash('sha256').update(`m08-ops:${tenantId}`).digest('hex').slice(0, 32),
  };
}

export class LabM08Seeder {
  private seeded = false;

  constructor(
    private readonly store: SearchStore,
    private readonly analytics: AnalyticsService,
    private readonly catalogue: LabM08OpsCatalogue,
    private readonly cellId: string,
    private readonly tenantId: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly mirror: LabOpenSearchMirror | null = null,
  ) {}

  async ensureCatalogueSeeded(): Promise<{
    search_documents: number;
    metric_definitions: number;
    opensearch_mirrored: number;
    already_seeded: boolean;
  }> {
    if (this.seeded) {
      const mirrorSync = this.mirror
        ? this.mirror.syncFromSeeds(this.catalogue.search_documents)
        : { upserted: 0 };
      return {
        search_documents: this.catalogue.search_documents.length,
        metric_definitions: this.catalogue.metric_definitions.length,
        opensearch_mirrored: mirrorSync.upserted,
        already_seeded: true,
      };
    }
    const now = this.clock();
    const ctx = workloadContext(this.catalogue, this.cellId, this.tenantId);
    let searchCount = 0;
    await this.store.withTx(
      {
        tenantId: this.tenantId,
        cellId: this.cellId,
        actorType: 'SYSTEM',
        actorId: this.catalogue.workload.actor_id,
        correlationId: ctx.correlation_id,
      },
      async (tx) => {
        for (const seed of this.catalogue.search_documents) {
          const existing = await tx.getDocument(seed.document_id);
          if (existing) continue;
          const row: SearchDocumentRow = {
            document_id: seed.document_id,
            tenant_id: this.tenantId,
            cell_id: this.cellId,
            source_cmp_id: seed.source_cmp_id,
            source_record_id: seed.source_record_id,
            source_aggregate_type: 'ApplicationCase',
            source_topic: 'sf.application.events.v1',
            source_version: 1,
            source_event_id: randomUUID(),
            source_event_type: 'ApplicationCaseTransitioned',
            source_occurred_at: now.toISOString(),
            projection_rule_id: 'meta:search-rule:sample-lab-case',
            projection_rule_version: 1,
            facets: { ...seed.facets },
            status: 'ACTIVE',
            revision: 1,
            indexed_at: now.toISOString(),
            updated_at: now.toISOString(),
            last_correlation_id: ctx.correlation_id,
          };
          await tx.insertDocument(row);
          searchCount += 1;
        }
      },
    );

    let metricCount = 0;
    for (const def of this.catalogue.metric_definitions) {
      try {
        await this.analytics.createDefinition(
          ctx,
          {
            metric_code: def.metric_code,
            publication_ref: def.publication_ref,
            purpose_code: def.purpose_code,
            source_event_type: def.source_event_type,
            source_aggregate_type: def.source_aggregate_type,
            source_schema_version: def.source_schema_version,
            aggregation: def.aggregation,
            value_field: def.value_field,
            period_granularity: def.period_granularity as 'DAY',
            dimensions: def.dimensions.map((d) => ({
              key: d.key,
              source_field: d.source_field,
              ...(d.allowed_values ? { allowed_values: [...d.allowed_values] } : {}),
            })),
            min_cohort_size: def.min_cohort_size,
          },
          {
            key: `lab-m08-metric:${def.metric_code}`,
            fingerprint: createHash('sha256').update(def.metric_code).digest('hex'),
            endpoint: 'POST /v1/lab/m08/ensure',
          },
        );
        metricCount += 1;
      } catch {
        // Idempotent seed: definition may already exist from a prior lab start.
      }
    }

    const mirrorSync = this.mirror
      ? this.mirror.syncFromSeeds(this.catalogue.search_documents)
      : { upserted: 0 };

    this.seeded = true;
    return {
      search_documents: searchCount,
      metric_definitions: metricCount,
      opensearch_mirrored: mirrorSync.upserted,
      already_seeded: false,
    };
  }
}

export function composeLabM08(params: {
  searchPool: pg.Pool;
  analyticsPool: pg.Pool;
  opsPool: pg.Pool;
  discoveryPool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  catalogue: LabM08OpsCatalogue;
  cellId: string;
  tenantId: string;
  clock?: () => Date;
  environment?: DeploymentEnvironment;
}): {
  search: SearchQueryService;
  analytics: AnalyticsService;
  ops: OperationalDashboardService;
  discovery: ServiceDiscoveryService;
  seeder: LabM08Seeder;
  searchStore: PgSearchStore;
  opensearchMirror: LabOpenSearchMirror | null;
} {
  const clock = params.clock ?? (() => new Date());
  const environment = params.environment ?? 'LOCAL';
  const searchStore = new PgSearchStore(params.searchPool);
  const search = new SearchQueryService({
    store: searchStore,
    authorizer: params.authorizer as never,
    clock,
  });
  const analytics = buildAnalyticsService({
    pool: params.analyticsPool,
    authorizer: params.authorizer as never,
    consumerActorId: params.catalogue.workload.actor_id,
    clock,
  });

  let opensearchMirror: LabOpenSearchMirror | null = null;
  if (params.catalogue.opensearch_mirror.enabled) {
    assertOpenSearchMirrorAllowed(environment);
    opensearchMirror = new LabOpenSearchMirror(params.tenantId, environment, clock);
  }

  const ports: Partial<Record<ViewCode, SummaryPort>> = {};
  for (const code of VIEW_CODES) {
    const sample = params.catalogue.ops_samples[code];
    if (code === 'INTEGRATION_HEALTH') {
      ports[code] = new LabIntegrationHealthPort(sample, opensearchMirror, clock);
      continue;
    }
    if (code === 'PLATFORM_HEALTH') {
      ports[code] = new LabPlatformHealthPort(
        sample,
        opensearchMirror,
        () => params.catalogue.search_documents.length,
        clock,
      );
      continue;
    }
    if (code === 'QUEUE_SUMMARY') {
      ports[code] = new LabQueueSummaryPort(sample, params.catalogue.search_documents, clock);
      continue;
    }
    if (sample) ports[code] = new LabFixtureSummaryPort(sample, clock);
  }
  const ops = buildOpsDashboardService({
    pool: params.opsPool,
    authorizer: params.authorizer as never,
    ports,
    clock,
  });
  const discovery = buildServiceDiscoveryService({
    pool: params.discoveryPool,
    authorizer: params.authorizer as never,
    catalogue: new LabCataloguePort(
      params.tenantId,
      params.catalogue.catalogue_version_id,
      params.catalogue.discovery_services,
    ),
    jurisdictions: new LabJurisdictionPort(params.catalogue.jurisdiction_code),
    search: new LabDiscoverySearchPort(params.tenantId, params.catalogue.discovery_services),
    clock,
  });
  const seeder = new LabM08Seeder(
    searchStore,
    analytics,
    params.catalogue,
    params.cellId,
    params.tenantId,
    clock,
    opensearchMirror,
  );
  return { search, analytics, ops, discovery, seeder, searchStore, opensearchMirror };
}

/**
 * Lab-only routes (not in frozen OpenAPI — no CCR):
 * GET  /v1/lab/m08/catalogue
 * POST /v1/lab/m08/ensure — SYSTEM seed search docs + metric definitions + OpenSearch mirror
 * GET  /v1/lab/m08/opensearch — SIMULATED mirror status (REAL deferred)
 * POST /v1/lab/m08/opensearch/sync — re-sync mirror from catalogue seeds
 * POST /v1/lab/m08/opensearch/query — tenant-safe facet query against mirror
 */
export function registerLabM08Routes(
  app: FastifyInstance,
  opts: {
    catalogue: LabM08OpsCatalogue;
    seeder: LabM08Seeder;
    opensearchMirror: LabOpenSearchMirror | null;
    tenantId: string;
  },
): void {
  app.get('/v1/lab/m08/catalogue', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      module: 'M08',
      invented_statutory_policy_forbidden: true,
      pii_in_facets_forbidden: true,
      real_opensearch_deferred: true,
      catalogue: opts.catalogue,
    });
  });

  app.post('/v1/lab/m08/ensure', async (_req, reply) => {
    try {
      const result = await opts.seeder.ensureCatalogueSeeded();
      return reply.header('cache-control', 'no-store').send({
        source: 'SAMPLE_LAB',
        g6_issued: false,
        certified: false,
        real_opensearch_deferred: true,
        ...result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Seed refused';
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error_code: 'SF-SYS-004', message });
    }
  });

  app.get('/v1/lab/m08/opensearch', async (_req, reply) => {
    if (!opts.opensearchMirror) {
      return reply.code(503).header('cache-control', 'no-store').send({
        error_code: 'SF-SYS-003',
        message: 'OpenSearch mirror unbound — REAL connector deferred',
        detail_code: 'OPENSEARCH_MIRROR_UNBOUND',
        certified: false,
        g6_issued: false,
      });
    }
    const status: LabOpenSearchMirrorStatus = opts.opensearchMirror.status();
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      ...status,
    });
  });

  app.post('/v1/lab/m08/opensearch/sync', async (_req, reply) => {
    if (!opts.opensearchMirror) {
      return reply.code(503).header('cache-control', 'no-store').send({
        error_code: 'SF-SYS-003',
        message: 'OpenSearch mirror unbound',
        detail_code: 'OPENSEARCH_MIRROR_UNBOUND',
      });
    }
    const result = opts.opensearchMirror.syncFromSeeds(opts.catalogue.search_documents);
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      real_opensearch_deferred: true,
      upserted: result.upserted,
      status: opts.opensearchMirror.status(),
    });
  });

  app.post('/v1/lab/m08/opensearch/query', async (req, reply) => {
    if (!opts.opensearchMirror) {
      return reply.code(503).header('cache-control', 'no-store').send({
        error_code: 'SF-SYS-003',
        message: 'OpenSearch mirror unbound',
        detail_code: 'OPENSEARCH_MIRROR_UNBOUND',
      });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const facetsRaw =
      body['facets'] && typeof body['facets'] === 'object' && !Array.isArray(body['facets'])
        ? (body['facets'] as Record<string, unknown>)
        : {};
    const facets: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(facetsRaw)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') facets[k] = v;
    }
    const limit = typeof body['limit'] === 'number' ? body['limit'] : 20;
    const hits = opts.opensearchMirror.query({
      tenant_id: opts.tenantId,
      facets,
      limit,
    });
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      g6_issued: false,
      certified: false,
      non_authoritative: true,
      mode: 'SIMULATED',
      real_opensearch_deferred: true,
      hits: hits.map((h) => ({
        document_id: h.document_id,
        source_cmp_id: h.source_cmp_id,
        source_record_id: h.source_record_id,
        facets: h.facets,
        revision: h.revision,
        mirrored_at: h.mirrored_at,
      })),
    });
  });
}
