import { describe, expect, it } from 'vitest';
import {
  ConsoleProductMetricSink,
  FORMS_PRODUCT_METRIC_CODES,
  MemoryProductMetricSink,
  ZERO_CROSS_TENANT_KPI,
  createProductMetricEvent,
  createProductMetricsRecorder,
  isForbiddenProductMetricKey,
  p95,
  percentile,
  sanitizeProductMetricDimensions,
} from '../src/product-metrics.js';
import {
  recordA11yScore,
  recordCrossTenantIncidentCount,
  startAuthoringSession,
  startCitizenFormSession,
} from '../src/forms-journey-metrics.js';

describe('forms product metrics (world-class measure)', () => {
  it('defines a closed metric vocabulary including journey and a11y codes', () => {
    expect(FORMS_PRODUCT_METRIC_CODES).toContain('STUDIO_AUTHORING_DURATION_MS');
    expect(FORMS_PRODUCT_METRIC_CODES).toContain('CITIZEN_FORM_COMPLETE');
    expect(FORMS_PRODUCT_METRIC_CODES).toContain('CITIZEN_FORM_ABANDON');
    expect(FORMS_PRODUCT_METRIC_CODES).toContain('A11Y_SCORE_CAPTURE');
    expect(FORMS_PRODUCT_METRIC_CODES).toContain('CROSS_TENANT_INCIDENT');
  });

  it('defines zero cross-tenant KPI with target 0 and smoke invariant', () => {
    expect(ZERO_CROSS_TENANT_KPI.target).toBe(0);
    expect(ZERO_CROSS_TENANT_KPI.smoke_invariant).toBe('CROSS_TENANT_LEAKAGE=0');
    expect(ZERO_CROSS_TENANT_KPI.raw_pii_payload_forbidden).toBe(true);
    expect(ZERO_CROSS_TENANT_KPI.fail_closed_codes).toContain('SF-TEN-002');
  });

  it('strips PII and forbidden keys from dimensions', () => {
    const dims = sanitizeProductMetricDimensions({
      mobile: '9999999999',
      email: 'a@b.c',
      name: 'Someone',
      form_data: { x: 1 },
      milestone: 'SAVE',
      outcome: 'OK',
      dwell_ms: 1200,
      badKey: 'x',
      'Not Valid': 'SAVE',
    });
    expect(dims).toEqual({
      milestone: 'SAVE',
      outcome: 'OK',
      dwell_ms: 1200,
    });
    expect(isForbiddenProductMetricKey('access_token')).toBe(true);
    expect(isForbiddenProductMetricKey('milestone')).toBe(false);
  });

  it('coerces non-category strings to UNCLASSIFIED', () => {
    const dims = sanitizeProductMetricDimensions({
      route_class: 'citizen apply with name',
      tool: 'AXE',
    });
    expect(dims['route_class']).toBe('UNCLASSIFIED');
    expect(dims['tool']).toBe('AXE');
  });

  it('records authoring milestones and duration without PII', () => {
    const sink = new MemoryProductMetricSink();
    const recorder = createProductMetricsRecorder(sink);
    const session = startAuthoringSession(recorder, { surface_kind: 'FORMS_DESIGNER' });
    session.mark('FIRST_EDIT');
    session.mark('SAVE');
    const end = session.end('COMPLETE');
    expect(end.metric_code).toBe('STUDIO_AUTHORING_DURATION_MS');
    expect(end.aggregate_only).toBe(true);
    expect(JSON.stringify(sink.events)).not.toMatch(/mobile|email|aadhaar|password/i);
    expect(sink.events.map((e) => e.metric_code)).toEqual([
      'STUDIO_AUTHORING_SESSION_START',
      'STUDIO_AUTHORING_MILESTONE',
      'STUDIO_AUTHORING_MILESTONE',
      'STUDIO_AUTHORING_DURATION_MS',
    ]);
  });

  it('records citizen load/submit/complete and skips double abandon', () => {
    const sink = new MemoryProductMetricSink();
    const recorder = createProductMetricsRecorder(sink);
    const journey = startCitizenFormSession(recorder, { catalogue_class: 'CERTIFICATE' });
    journey.markLoaded(42, 'OK');
    journey.markStep(1, 4);
    journey.markSubmit(88, 'OK');
    journey.markComplete();
    const second = journey.markAbandon('PAGEHIDE');
    expect(second.dimensions['outcome']).toBe('SKIPPED');
    expect(sink.events.some((e) => e.metric_code === 'CITIZEN_FORM_COMPLETE')).toBe(true);
    expect(
      sink.events.filter((e) => e.metric_code === 'CITIZEN_FORM_ABANDON' && e.value === 1),
    ).toHaveLength(0);
  });

  it('records abandon when the citizen leaves before complete', () => {
    const sink = new MemoryProductMetricSink();
    const recorder = createProductMetricsRecorder(sink);
    const journey = startCitizenFormSession(recorder);
    journey.markLoaded(10, 'OK');
    const abandon = journey.markAbandon('VISIBILITY');
    expect(abandon.value).toBe(1);
    expect(abandon.dimensions['reason']).toBe('VISIBILITY');
  });

  it('captures a11y score as counts only', () => {
    const sink = new MemoryProductMetricSink();
    const recorder = createProductMetricsRecorder(sink);
    const event = recordA11yScore(recorder, {
      surface: 'citizen',
      tool: 'AXE',
      violations: 0,
      incomplete: 1,
      passes: 20,
      route_class: 'CITIZEN_APPLY',
    });
    expect(event.metric_code).toBe('A11Y_SCORE_CAPTURE');
    expect(event.value).toBe(100);
    expect(event.dimensions['violations']).toBe(0);
    expect(JSON.stringify(event)).not.toContain('html');
  });

  it('computes p95 for form latency samples', () => {
    // Nearest-rank: ceil(0.95 * 20) = 19th ascending sample (index 18) → 28; 50 is the top 5%.
    const samples = [10, 12, 11, 15, 14, 13, 20, 18, 17, 16, 50, 19, 21, 22, 23, 24, 25, 26, 27, 28];
    expect(percentile([...samples].sort((a, b) => a - b), 95)).toBe(28);
    expect(p95(samples)).toBe(28);
    expect(p95([1, 2, 3, 4, 100])).toBe(100);
    expect(p95([])).toBeNull();
  });

  it('records cross-tenant incident count for KPI smoke (target 0)', () => {
    const sink = new MemoryProductMetricSink();
    const recorder = createProductMetricsRecorder(sink);
    const event = recordCrossTenantIncidentCount(recorder, 0, { probe: 'FORGED_HEADER' });
    expect(event.value).toBe(0);
    expect(event.dimensions['kpi']).toBe('SF-KPI-CROSS-TENANT-ZERO');
  });

  it('refuses unknown metric codes and non-finite values', () => {
    expect(() =>
      createProductMetricEvent({
        // @ts-expect-error intentional
        metric_code: 'NOT_A_CODE',
        value: 1,
        surface: 'lab',
      }),
    ).toThrow(/UNKNOWN_PRODUCT_METRIC_CODE/);
    expect(() =>
      createProductMetricEvent({
        metric_code: 'CITIZEN_FORM_COMPLETE',
        value: Number.NaN,
        surface: 'lab',
      }),
    ).toThrow(/PRODUCT_METRIC_VALUE_NOT_FINITE/);
  });

  it('console sink emits structured lines without throwing', () => {
    const sink = new ConsoleProductMetricSink();
    expect(() =>
      sink.emit(
        createProductMetricEvent({
          metric_code: 'CITIZEN_FORM_LOAD_MS',
          value: 12,
          surface: 'lab',
          dimensions: { outcome: 'OK' },
        }),
      ),
    ).not.toThrow();
  });
});
