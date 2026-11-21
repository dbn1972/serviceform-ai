/**
 * SAMPLE_LAB M08 search / discovery / analytics / ops catalogue (SF-63).
 * Opaque facets and aggregate metrics only — no PII, no invented statute.
 * CERTIFIED=false · G6=false.
 */

export const SAMPLE_LAB_OPS_ANALYST_ROLE = 'SAMPLE_LAB_OPS_ANALYST' as const;

export interface SampleLabSearchDocumentSeed {
  document_id: string;
  source_record_id: string;
  source_cmp_id: string;
  facets: Record<string, string | number | boolean>;
}

export interface SampleLabMetricDefinitionSeed {
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

export interface SampleLabOpsMetric {
  metric_code: string;
  value: number;
  dimensions?: Record<string, string | number | boolean>;
}

export interface SampleLabOpsSample {
  status: 'OK' | 'DEGRADED' | 'UNAVAILABLE';
  metrics: readonly SampleLabOpsMetric[];
}

export interface SampleLabDiscoveryService {
  service_id: string;
  service_code: string;
  category_code: string | null;
  service_binding_version_id: string;
  label_key: string | null;
  label: string;
  jurisdiction_codes: readonly string[];
}

export interface SampleLabM08OpsCatalogue {
  workload: { actor_id: string; roles: readonly string[] };
  catalogue_version_id: string;
  jurisdiction_code: string;
  search_documents: readonly SampleLabSearchDocumentSeed[];
  metric_definitions: readonly SampleLabMetricDefinitionSeed[];
  ops_samples: Readonly<Record<string, SampleLabOpsSample>>;
  discovery_services: readonly SampleLabDiscoveryService[];
}

export const SAMPLE_LAB_M08_OPS_CATALOGUE: SampleLabM08OpsCatalogue = {
  workload: {
    actor_id: '00800800-0000-4000-8000-008008008008',
    roles: [SAMPLE_LAB_OPS_ANALYST_ROLE],
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
    {
      document_id: '03503503-0002-4000-8000-035035035002',
      source_record_id: '01501501-0002-4000-8000-015015015002',
      source_cmp_id: 'CMP-015',
      facets: {
        catalogue_id: 'IND-EDU-004',
        case_state: 'PAYMENT_PENDING',
        application_ref: 'lab-app:transfer-1',
      },
    },
    {
      document_id: '03503503-0003-4000-8000-035035035003',
      source_record_id: '01501501-0003-4000-8000-015015015003',
      source_cmp_id: 'CMP-015',
      facets: {
        catalogue_id: 'IND-SOC-002',
        case_state: 'APPROVED',
        application_ref: 'lab-app:residence-2',
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
          allowed_values: ['DRAFT', 'IN_SCRUTINY', 'APPROVED', 'REJECTED', 'CLOSED'],
        },
      ],
      min_cohort_size: 1,
    },
  ],
  ops_samples: {
    SLA_SUMMARY: {
      status: 'OK',
      metrics: [
        { metric_code: 'SLA_CLOCKS', value: 4, dimensions: { clock_status: 'RUNNING' } },
        { metric_code: 'SLA_CLOCKS', value: 1, dimensions: { clock_status: 'PAUSED' } },
        { metric_code: 'SLA_CLOCKS', value: 0, dimensions: { clock_status: 'BREACHED' } },
      ],
    },
    QUEUE_SUMMARY: {
      status: 'OK',
      metrics: [
        { metric_code: 'OPEN_TASKS', value: 6, dimensions: { desk: 'SCRUTINY' } },
        { metric_code: 'OPEN_TASKS', value: 2, dimensions: { desk: 'APPROVING' } },
        { metric_code: 'OPEN_TASKS', value: 1, dimensions: { desk: 'HELPDESK' } },
      ],
    },
    INTEGRATION_HEALTH: {
      status: 'DEGRADED',
      metrics: [{ metric_code: 'CONNECTOR_MODE', value: 1, dimensions: { mode: 'SIMULATED' } }],
    },
    EVENT_HEALTH: {
      status: 'OK',
      metrics: [{ metric_code: 'OUTBOX_LAG', value: 0, dimensions: { topic: 'sf.lab.events.v1' } }],
    },
    PLATFORM_HEALTH: {
      status: 'OK',
      metrics: [{ metric_code: 'READINESS', value: 1, dimensions: { component: 'SAMPLE_LAB' } }],
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
    {
      service_id: '0d15bae4-0003-4000-8000-0d15bae40003',
      service_code: 'IND-EDU-004',
      category_code: 'CERTIFICATE',
      service_binding_version_id: '0d15bae4-0002-4000-8000-0d15bae40002',
      label_key: 'svc.IND-EDU-004.name',
      label: 'Transfer Certificate (SAMPLE_LAB DUMMY fee)',
      jurisdiction_codes: ['IN-OD-SAMPLE-LAB'],
    },
  ],
};

export function searchHitLabel(facets: Record<string, unknown>): string {
  const ref = facets['application_ref'];
  const catalogue = facets['catalogue_id'];
  const state = facets['case_state'];
  const parts = [
    typeof catalogue === 'string' ? catalogue : null,
    typeof state === 'string' ? state : null,
    typeof ref === 'string' ? ref : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Search hit';
}

export function opsViewLabel(code: string): string {
  switch (code) {
    case 'SLA_SUMMARY':
      return 'SLA summary';
    case 'QUEUE_SUMMARY':
      return 'Work queue summary';
    case 'INTEGRATION_HEALTH':
      return 'Integration health';
    case 'EVENT_HEALTH':
      return 'Event health';
    case 'PLATFORM_HEALTH':
      return 'Platform health';
    default:
      return code;
  }
}
