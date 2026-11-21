import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_M08_OPS_CATALOGUE,
  SAMPLE_LAB_OPS_ANALYST_ROLE,
  opsViewLabel,
  searchHitLabel,
} from '../src/m08-ops-catalogue.js';

describe('SAMPLE_LAB M08 ops catalogue', () => {
  it('exposes opaque search seeds and ops analyst role', () => {
    expect(SAMPLE_LAB_OPS_ANALYST_ROLE).toBe('SAMPLE_LAB_OPS_ANALYST');
    expect(SAMPLE_LAB_M08_OPS_CATALOGUE.search_documents.length).toBeGreaterThan(0);
    expect(SAMPLE_LAB_M08_OPS_CATALOGUE.discovery_services.some((s) => s.service_code === 'IND-SOC-002')).toBe(
      true,
    );
  });

  it('labels search hits and ops views without inventing statute', () => {
    expect(
      searchHitLabel({
        catalogue_id: 'IND-SOC-002',
        case_state: 'IN_SCRUTINY',
        application_ref: 'lab-app:residence-1',
      }),
    ).toContain('IND-SOC-002');
    expect(opsViewLabel('QUEUE_SUMMARY')).toBe('Work queue summary');
  });
});
