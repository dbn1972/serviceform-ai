import { describe, expect, it } from 'vitest';
import { buildSearchBody, toSearchHitCard, type PlatformSearchHit } from '../lib/portal/search';
import { toOpsViewCard, type PlatformOpsView } from '../lib/portal/ops';

const hit: PlatformSearchHit = {
  document: {
    document_id: '03503503-0001-4000-8000-035035035001',
    source_cmp_id: 'CMP-015',
    source_record_id: '01501501-0001-4000-8000-015015015001',
    facets: {
      catalogue_id: 'IND-SOC-002',
      case_state: 'IN_SCRUTINY',
      application_ref: 'lab-app:residence-1',
    },
  },
  source: {
    aggregate_type: 'ApplicationCase',
    event_type: 'ApplicationCaseTransitioned',
    occurred_at: '2026-11-21T00:00:00.000Z',
  },
  revision: 1,
};

const view: PlatformOpsView = {
  view_code: 'QUEUE_SUMMARY',
  source_component: 'CMP-017',
  status: 'OK',
  stale: false,
  max_age_seconds: 300,
  as_of: '2026-11-21T00:00:00.000Z',
  metrics: [{ metric_code: 'OPEN_TASKS', value: 6, dimensions: { desk: 'SCRUTINY' } }],
  non_authoritative: true,
};

describe('officer search / ops desk helpers', () => {
  it('builds CMP-035 query with opaque facets only', () => {
    const body = buildSearchBody({
      catalogue_id: 'IND-SOC-002',
      case_state: 'IN_SCRUTINY',
      application_ref: 'lab-app:residence-1',
    });
    expect(body['source_cmp_id']).toBe('CMP-015');
    expect(body['facets']).toEqual({
      catalogue_id: 'IND-SOC-002',
      case_state: 'IN_SCRUTINY',
      application_ref: 'lab-app:residence-1',
    });
  });

  it('projects search hits as non-authoritative cards', () => {
    const card = toSearchHitCard(hit);
    expect(card.non_authoritative).toBe(true);
    expect(card.catalogue_id).toBe('IND-SOC-002');
    expect(card.label).toContain('IND-SOC-002');
  });

  it('projects ops views with refresh enabled', () => {
    const card = toOpsViewCard(view);
    expect(card.label).toBe('Work queue summary');
    expect(card.can_refresh).toBe(true);
    expect(card.metrics[0]?.dimensions_summary).toContain('desk=SCRUTINY');
  });
});
