import { describe, expect, it } from 'vitest';
import { parseM08OpsCatalogue } from '../src/platform/m08-ops.js';

describe('SAMPLE_LAB M08 ops catalogue (SF-63)', () => {
  it('parses search, analytics, ops and discovery seeds without PII facet names', () => {
    const catalogue = parseM08OpsCatalogue({
      workload: {
        actor_id: '00800800-0000-4000-8000-008008008008',
        roles: ['SAMPLE_LAB_OPS_ANALYST'],
      },
      catalogue_version_id: '0d15ba00-0c08-4000-8000-0d15ba000c08',
      jurisdiction_code: 'IN-OD-SAMPLE-LAB',
      search_documents: [
        {
          document_id: '03503503-0001-4000-8000-035035035001',
          source_record_id: '01501501-0001-4000-8000-015015015001',
          source_cmp_id: 'CMP-015',
          facets: {
            catalogue_id: 'IND-SOC-002',
            case_state: 'IN_SCRUTINY',
            application_ref: 'lab-app:residence-1',
          },
        },
      ],
      metric_definitions: [
        {
          metric_code: 'LAB_CASE_TRANSITIONS',
          publication_ref: 'meta:analytics:sample-lab:case-transitions',
          purpose_code: 'OPS_MIS',
          source_event_type: 'ApplicationCaseTransitioned',
          source_aggregate_type: 'ApplicationCase',
          source_schema_version: 1,
          aggregation: 'COUNT',
          value_field: null,
          period_granularity: 'DAY',
          dimensions: [
            {
              key: 'to_state',
              source_field: 'to_state',
              allowed_values: ['DRAFT', 'IN_SCRUTINY', 'APPROVED'],
            },
          ],
          min_cohort_size: 1,
        },
      ],
      ops_samples: {
        QUEUE_SUMMARY: {
          status: 'OK',
          metrics: [{ metric_code: 'OPEN_TASKS', value: 2, dimensions: { desk: 'SCRUTINY' } }],
        },
      },
      discovery_services: [
        {
          service_id: '0d15ba00-0003-4000-8000-0d15ba0000d3',
          service_code: 'IND-SOC-002',
          category_code: 'CERTIFICATE',
          service_binding_version_id: '0d15ba00-0002-4000-8000-0d15ba0000d2',
          label_key: 'svc.IND-SOC-002.name',
          label: 'Residence Certificate (SAMPLE_LAB)',
          jurisdiction_codes: ['IN-OD-SAMPLE-LAB'],
        },
      ],
    });

    expect(catalogue.search_documents).toHaveLength(1);
    expect(catalogue.metric_definitions[0]?.metric_code).toBe('LAB_CASE_TRANSITIONS');
    expect(catalogue.ops_samples.QUEUE_SUMMARY?.status).toBe('OK');
    expect(catalogue.discovery_services[0]?.service_code).toBe('IND-SOC-002');
    expect(catalogue.opensearch_mirror.mode).toBe('SIMULATED');
    expect(catalogue.opensearch_mirror.real_deferred).toBe(true);
    const facetKeys = Object.keys(catalogue.search_documents[0]?.facets ?? {});
    expect(facetKeys.every((k) => !/name|email|phone|aadhaar|address/i.test(k))).toBe(true);
  });

  it('falls back safely on empty input', () => {
    const catalogue = parseM08OpsCatalogue(null);
    expect(catalogue.search_documents).toEqual([]);
    expect(catalogue.jurisdiction_code).toBe('IN-OD-SAMPLE-LAB');
    expect(catalogue.opensearch_mirror.enabled).toBe(true);
  });
});
