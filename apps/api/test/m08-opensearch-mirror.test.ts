import { describe, expect, it } from 'vitest';
import {
  assertOpenSearchMirrorAllowed,
  LabOpenSearchMirror,
  OpenSearchMirrorRefused,
  UnboundOpenSearchMirror,
} from '../src/platform/m08-opensearch-mirror.js';
import { deriveSearchFacetMetrics, parseM08OpsCatalogue } from '../src/platform/m08-ops.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('SAMPLE_LAB OpenSearch mirror (SF-65)', () => {
  it('refuses SIMULATED mirror in PRODUCTION and UAT (fail-closed)', () => {
    expect(() => assertOpenSearchMirrorAllowed('PRODUCTION')).toThrow(OpenSearchMirrorRefused);
    expect(() => assertOpenSearchMirrorAllowed('UAT')).toThrow(OpenSearchMirrorRefused);
    expect(() => assertOpenSearchMirrorAllowed('PREPROD')).toThrow(OpenSearchMirrorRefused);
    expect(() => assertOpenSearchMirrorAllowed('LOCAL')).not.toThrow();
    expect(() => assertOpenSearchMirrorAllowed('CI')).not.toThrow();
  });

  it('syncs opaque facets and reports REAL deferred status', () => {
    const mirror = new LabOpenSearchMirror(TENANT, 'LOCAL', () => new Date('2026-11-22T00:00:00Z'));
    const sync = mirror.syncFromSeeds([
      {
        document_id: '03503503-0001-4000-8000-035035035001',
        source_record_id: '01501501-0001-4000-8000-015015015001',
        source_cmp_id: 'CMP-015',
        facets: {
          catalogue_id: 'IND-SOC-002',
          case_state: 'IN_SCRUTINY',
          application_ref: 'lab-app:residence-1',
          citizen_name: 'must-strip',
        },
      },
    ]);
    expect(sync.upserted).toBe(1);
    const status = mirror.status();
    expect(status.mode).toBe('SIMULATED');
    expect(status.real_deferred).toBe(true);
    expect(status.opensearch_connector_type_in_contract).toBe(false);
    expect(status.document_count).toBe(1);
    expect(status.certified).toBe(false);
    expect(status.g6_issued).toBe(false);

    const hits = mirror.query({
      tenant_id: TENANT,
      facets: { catalogue_id: 'IND-SOC-002' },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.facets['citizen_name']).toBeUndefined();
    expect(hits[0]?.facets['catalogue_id']).toBe('IND-SOC-002');

    expect(mirror.query({ tenant_id: '22222222-2222-4222-8222-222222222222' })).toEqual([]);
  });

  it('unbound mirror never fabricates healthy REAL OpenSearch', () => {
    const unbound = new UnboundOpenSearchMirror();
    expect(() => unbound.status()).toThrow(OpenSearchMirrorRefused);
  });
});

describe('SAMPLE_LAB richer M08 ops ports helpers (SF-65)', () => {
  it('parses opensearch_mirror seed and derives opaque facet metrics', () => {
    const catalogue = parseM08OpsCatalogue({
      search_documents: [
        {
          document_id: '03503503-0001-4000-8000-035035035001',
          source_record_id: '01501501-0001-4000-8000-015015015001',
          source_cmp_id: 'CMP-015',
          facets: { catalogue_id: 'IND-SOC-002', case_state: 'IN_SCRUTINY' },
        },
        {
          document_id: '03503503-0002-4000-8000-035035035002',
          source_record_id: '01501501-0002-4000-8000-015015015002',
          source_cmp_id: 'CMP-015',
          facets: { catalogue_id: 'IND-SOC-002', case_state: 'APPROVED' },
        },
      ],
      opensearch_mirror: {
        enabled: true,
        mode: 'SIMULATED',
        real_deferred: true,
        topic: 'sf.search.events.v1',
      },
    });
    expect(catalogue.opensearch_mirror.mode).toBe('SIMULATED');
    expect(catalogue.opensearch_mirror.real_deferred).toBe(true);
    const metrics = deriveSearchFacetMetrics(catalogue.search_documents);
    expect(metrics.some((m) => m.metric_code === 'INDEXED_BY_CATALOGUE')).toBe(true);
    expect(metrics.some((m) => m.metric_code === 'INDEXED_BY_STATE')).toBe(true);
    expect(metrics.every((m) => !/name|email|phone|aadhaar/i.test(JSON.stringify(m)))).toBe(true);
  });
});
