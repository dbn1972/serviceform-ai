import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryProductMetricSink, createProductMetricsRecorder } from '../src/product-metrics';
import { startCitizenFormSession } from '../src/forms-journey-metrics';
import { assertSnapshotPiiSafe, buildDurableKpiSnapshot } from '../src/aggregate-product-metrics';
import { DurableMetricRing, buildLabHostDurableSeries } from '../src/durable-kpi-series';
import { exportDurableKpisToOtlp, otlpExportJson } from '../src/otlp-export';

describe('durable KPI aggregate + series + OTLP (P8-1)', () => {
  it('aggregates funnel completion/abandon without PII', () => {
    const sink = new MemoryProductMetricSink();
    const recorder = createProductMetricsRecorder(sink);
    for (let i = 0; i < 10; i++) {
      const j = startCitizenFormSession(recorder, { catalogue_class: 'CERTIFICATE' });
      j.markLoaded(30 + i, 'OK');
      if (i % 5 === 0) {
        j.markAbandon('PAGEHIDE');
      } else {
        j.markSubmit(50 + i, 'OK');
        j.markComplete();
      }
    }
    const snap = buildDurableKpiSnapshot(sink.events, { source: 'lab_synthetic' });
    expect(snap.CERTIFIED).toBe(false);
    expect(snap.funnel.starts).toBe(10);
    expect(snap.funnel.completes).toBe(8);
    expect(snap.funnel.abandons).toBe(2);
    expect(snap.form_load.p95_ms).toBeTypeOf('number');
    expect(snap.form_submit.sample_size).toBe(8);
    assertSnapshotPiiSafe(snap);
    expect(JSON.stringify(snap)).not.toMatch(/mobile|email|aadhaar/i);
  });

  it('builds multi-window lab_host_series beyond synthetic n=40 and writes evidence', () => {
    const { series, events } = buildLabHostDurableSeries({
      windows: 6,
      journeys_per_window: 24,
      abandon_every: 8,
    });
    expect(series.source).toBe('lab_host_series');
    expect(series.window_count).toBe(6);
    expect(series.series).toHaveLength(6);
    expect(series.CERTIFIED).toBe(false);
    expect(series.snapshot.cross_tenant.ok).toBe(true);
    expect(series.snapshot.cross_tenant.incident_count).toBe(0);
    expect(series.smoke_invariant).toBe('CROSS_TENANT_LEAKAGE=0');
    expect(series.pass).toBe(true);
    // Durable: well above one-shot n=40 load samples
    expect(series.snapshot.form_load.sample_size).toBeGreaterThan(40);
    expect(series.snapshot.funnel.completes).toBeGreaterThan(0);
    expect(series.snapshot.funnel.abandons).toBeGreaterThan(0);
    expect(series.snapshot.authoring.sessions).toBe(6);
    expect(series.snapshot.a11y.latest_score).toBe(100);
    for (const point of series.series) {
      expect(point.form_load_p95_ms).toBeTypeOf('number');
      expect(point.form_submit_p95_ms).toBeTypeOf('number');
    }
    expect(JSON.stringify(events)).not.toMatch(/mobile|password|otp/i);

    const otlp = exportDurableKpisToOtlp(series.snapshot, series);
    const outDir = join(process.cwd(), 'evidence/SF-P8-MEASURE');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'durable-kpi-snapshot.json'),
      `${JSON.stringify(
        {
          ...series,
          tip_note: 'P8-1 durable KPI series; CERTIFIED=false; DigiLocker out of scope',
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(outDir, 'otlp-export-sample.json'), `${otlpExportJson(otlp)}\n`);
  });

  it('exports OTLP-shaped gauges without observability package deps', () => {
    const { series } = buildLabHostDurableSeries({ windows: 3, journeys_per_window: 12 });
    const otlp = exportDurableKpisToOtlp(series.snapshot, series);
    expect(otlp.CERTIFIED).toBe(false);
    expect(otlp.raw_pii_payload_forbidden).toBe(true);
    const names = otlp.resourceMetrics[0]!.scopeMetrics[0]!.metrics.map((m) => m.name);
    expect(names).toContain('sf.forms.funnel.completes');
    expect(names).toContain('sf.forms.latency.load_p95_ms');
    expect(names).toContain('sf.forms.authoring.duration_p95_ms');
    expect(names).toContain('sf.forms.a11y.score');
    expect(names).toContain('sf.forms.cross_tenant.incidents');
    expect(names).toContain('sf.forms.latency.load_p95_ms.window');
    const json = otlpExportJson(otlp);
    expect(json).toContain('serviceform-forms-product-metrics');
    expect(json).not.toMatch(/mobile|aadhaar|email|form_data/i);
  });

  it('ring buffer snapshots browser-safe aggregates', () => {
    const { events } = buildLabHostDurableSeries({ windows: 2, journeys_per_window: 8 });
    const ring = new DurableMetricRing(100);
    ring.pushAll(events);
    const snap = ring.snapshot('browser');
    expect(snap.source).toBe('browser');
    expect(snap.event_count).toBeLessThanOrEqual(100);
    expect(snap.cross_tenant.target).toBe(0);
  });
});
