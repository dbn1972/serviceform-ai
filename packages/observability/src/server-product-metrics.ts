/**
 * Node BFF helpers: Server-Timing + redacted product-metric log lines for form load/submit.
 */

import {
  ConsoleProductMetricSink,
  MemoryProductMetricSink,
  MultiplexProductMetricSink,
  createProductMetricsRecorder,
  type FormsProductMetricCode,
  type ProductMetricEvent,
  type ProductMetricsRecorder,
} from './product-metrics.js';

const processMemory = new MemoryProductMetricSink();
let processRecorder: ProductMetricsRecorder | null = null;

export function getServerProductMetrics(): ProductMetricsRecorder {
  if (!processRecorder) {
    processRecorder = createProductMetricsRecorder(
      new MultiplexProductMetricSink([processMemory, new ConsoleProductMetricSink()]),
    );
  }
  return processRecorder;
}

export function getServerProductMetricEvents(): readonly ProductMetricEvent[] {
  return processMemory.events;
}

export function resetServerProductMetricsForTests(): void {
  processMemory.clear();
  processRecorder = null;
}

export function recordBffLatency(
  metric_code: Extract<FormsProductMetricCode, 'CITIZEN_FORM_LOAD_MS' | 'CITIZEN_FORM_SUBMIT_MS'>,
  durationMs: number,
  outcome: 'OK' | 'ERROR' | 'VALIDATION' | 'UNAUTHORIZED' | 'NOT_FOUND',
  extra?: Record<string, unknown>,
): ProductMetricEvent {
  return getServerProductMetrics().record({
    metric_code,
    value: Math.max(0, Math.round(durationMs)),
    surface: 'bff',
    dimensions: { outcome, ...extra },
  });
}

/** Build a Server-Timing header value (duration only; no PII). */
export function serverTimingHeader(
  metric: 'form_load' | 'form_submit',
  durationMs: number,
): string {
  const ms = Math.max(0, Math.round(durationMs));
  return `${metric};dur=${ms};desc="sf product metric"`;
}

export function withServerTiming(
  headers: Headers,
  metric: 'form_load' | 'form_submit',
  durationMs: number,
): Headers {
  const next = new Headers(headers);
  const existing = next.get('Server-Timing');
  const line = serverTimingHeader(metric, durationMs);
  next.set('Server-Timing', existing ? `${existing}, ${line}` : line);
  return next;
}
