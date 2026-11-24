/**
 * Browser-side product metrics bootstrap for Studio / citizen Next apps.
 * Lazy singleton with memory + console sinks. No network beacons (avoid PII leakage paths).
 */

import {
  ConsoleProductMetricSink,
  MemoryProductMetricSink,
  MultiplexProductMetricSink,
  createProductMetricsRecorder,
  type ProductMetricsRecorder,
} from './product-metrics.js';
import {
  startAuthoringSession,
  startCitizenFormSession,
  type AuthoringSession,
  type CitizenFormSession,
} from './forms-journey-metrics.js';

export type { AuthoringSession, CitizenFormSession };

type BrowserDocument = {
  visibilityState: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type BrowserWindow = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

function browserGlobals(): { document?: BrowserDocument; window?: BrowserWindow } {
  const g = globalThis as {
    document?: BrowserDocument;
    window?: BrowserWindow;
  };
  return g;
}

let browserRecorder: ProductMetricsRecorder | null = null;
let memorySink: MemoryProductMetricSink | null = null;

export function getBrowserProductMetrics(): ProductMetricsRecorder {
  if (browserRecorder) return browserRecorder;
  memorySink = new MemoryProductMetricSink();
  const sink = new MultiplexProductMetricSink([memorySink, new ConsoleProductMetricSink()]);
  browserRecorder = createProductMetricsRecorder(sink);
  return browserRecorder;
}

/** Test/lab inspection of in-memory events (no PII). */
export function getBrowserProductMetricEvents() {
  return memorySink?.events ?? [];
}

export function resetBrowserProductMetricsForTests(): void {
  browserRecorder = null;
  memorySink = null;
}

export function beginStudioAuthoring(dims?: Record<string, unknown>): AuthoringSession {
  return startAuthoringSession(getBrowserProductMetrics(), dims);
}

export function beginCitizenFormJourney(dims?: Record<string, unknown>): CitizenFormSession {
  return startCitizenFormSession(getBrowserProductMetrics(), dims);
}

/**
 * Attach pagehide / visibility abandon hooks. Returns disposer.
 * Does nothing when `document` is unavailable (SSR).
 */
export function attachCitizenAbandonHooks(session: CitizenFormSession): () => void {
  const { document: doc, window: win } = browserGlobals();
  if (!doc || !win) {
    return () => {};
  }
  const onHide = () => {
    if (doc.visibilityState === 'hidden') {
      session.markAbandon('VISIBILITY');
    }
  };
  const onPageHide = () => {
    session.markAbandon('PAGEHIDE');
  };
  doc.addEventListener('visibilitychange', onHide);
  win.addEventListener('pagehide', onPageHide);
  return () => {
    doc.removeEventListener('visibilitychange', onHide);
    win.removeEventListener('pagehide', onPageHide);
  };
}
