import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MemoryProductMetricSink,
  ZERO_CROSS_TENANT_KPI,
  createProductMetricsRecorder,
  p95,
  sanitizeProductMetricDimensions,
} from '../src/product-metrics';
import {
  recordA11yScore,
  recordCrossTenantIncidentCount,
  startAuthoringSession,
  startCitizenFormSession,
} from '../src/forms-journey-metrics';

/**
 * Executable smoke that materialises lab-synthetic baselines for Workstream 7.
 * CERTIFIED remains false; live lab host is not required.
 */
describe('forms world-class metrics smoke', () => {
  it('emits smoke-baseline.json with p95 + zero cross-tenant KPI', () => {
    expect(ZERO_CROSS_TENANT_KPI.target).toBe(0);
    expect(ZERO_CROSS_TENANT_KPI.smoke_invariant).toBe('CROSS_TENANT_LEAKAGE=0');

    const leak = sanitizeProductMetricDimensions({
      mobile: '9999999999',
      name: 'PII',
      milestone: 'SAVE',
    });
    expect(leak).toEqual({ milestone: 'SAVE' });

    const sink = new MemoryProductMetricSink();
    const recorder = createProductMetricsRecorder(sink);
    const auth = startAuthoringSession(recorder, { surface_kind: 'FORMS_DESIGNER' });
    auth.mark('SAVE');
    auth.end('COMPLETE');

    const loadSamples: number[] = [];
    const submitSamples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const j = startCitizenFormSession(recorder, { catalogue_class: 'CERTIFICATE' });
      const loadMs = 20 + (i % 7) * 3 + (i === 39 ? 80 : 0);
      const submitMs = 40 + (i % 5) * 5 + (i === 38 ? 120 : 0);
      j.markLoaded(loadMs, 'OK');
      loadSamples.push(loadMs);
      j.markSubmit(submitMs, 'OK');
      submitSamples.push(submitMs);
      j.markComplete();
    }

    recordA11yScore(recorder, {
      surface: 'lab',
      tool: 'AXE',
      violations: 0,
      incomplete: 0,
      passes: 12,
      route_class: 'CITIZEN_APPLY',
    });
    const incident = recordCrossTenantIncidentCount(recorder, 0, { probe: 'SMOKE' });
    expect(incident.value).toBe(0);

    const blob = JSON.stringify(sink.events);
    expect(blob).not.toMatch(/mobile|aadhaar|email|password|otp/i);

    const baseline = {
      CERTIFIED: false,
      g6_issued: false,
      self_certified: false,
      kpi: ZERO_CROSS_TENANT_KPI,
      lab_synthetic: {
        note: 'Synthetic unit/smoke samples; live lab host was not required for this smoke.',
        form_load_p95_ms: p95(loadSamples),
        form_submit_p95_ms: p95(submitSamples),
        sample_size: loadSamples.length,
        a11y_score_lab: 100,
        cross_tenant_incidents: 0,
      },
      event_count: sink.events.length,
      smoke_invariant: 'CROSS_TENANT_LEAKAGE=0',
      pass: true,
    };

    expect(baseline.lab_synthetic.form_load_p95_ms).toBeTypeOf('number');
    expect(baseline.lab_synthetic.form_submit_p95_ms).toBeTypeOf('number');

    const outDir = join(process.cwd(), 'evidence/SF-WC-FORMS-07');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'smoke-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  });
});
