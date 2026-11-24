import { describe, expect, it, beforeEach } from 'vitest';
import {
  getServerProductMetricEvents,
  recordBffLatency,
  resetServerProductMetricsForTests,
  serverTimingHeader,
} from '../src/server-product-metrics';

describe('server product metrics (BFF form load/submit)', () => {
  beforeEach(() => {
    resetServerProductMetricsForTests();
  });

  it('records form load and submit latencies without PII', () => {
    recordBffLatency('CITIZEN_FORM_LOAD_MS', 33.7, 'OK', {
      catalogue_class: 'CERTIFICATE',
      mobile: '9999999999',
    });
    recordBffLatency('CITIZEN_FORM_SUBMIT_MS', 91, 'VALIDATION');
    const events = getServerProductMetricEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.value).toBe(34);
    expect(events[0]?.dimensions).toEqual({
      outcome: 'OK',
      catalogue_class: 'CERTIFICATE',
    });
    expect(JSON.stringify(events)).not.toMatch(/9999999999/);
  });

  it('builds Server-Timing without sensitive values', () => {
    expect(serverTimingHeader('form_load', 12.2)).toBe('form_load;dur=12;desc="sf product metric"');
  });
});
