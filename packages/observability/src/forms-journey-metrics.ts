/**
 * Capture-point helpers for Studio authoring time, citizen form journey,
 * a11y score snapshots, and latency. No form answers or PII.
 */

import {
  createProductMetricsRecorder,
  newMetricSessionId,
  nowMs,
  type ProductMetricEvent,
  type ProductMetricsRecorder,
  type ProductMetricSink,
} from './product-metrics.js';

export type AuthoringMilestone =
  | 'OPEN'
  | 'FIRST_EDIT'
  | 'SAVE'
  | 'VALIDATE'
  | 'FREEZE'
  | 'PROPOSE'
  | 'TAB_PUBLISH';

export interface AuthoringSession {
  readonly session_id: string;
  readonly started_at_ms: number;
  mark(milestone: AuthoringMilestone, extra?: Record<string, unknown>): ProductMetricEvent;
  durationMs(): number;
  end(outcome: 'COMPLETE' | 'ABANDON' | 'LEAVE'): ProductMetricEvent;
}

export interface CitizenFormSession {
  readonly session_id: string;
  readonly started_at_ms: number;
  markLoaded(loadMs: number, outcome: 'OK' | 'ERROR'): ProductMetricEvent;
  markStep(stepIndex: number, stepCount: number): ProductMetricEvent;
  markSubmit(submitMs: number, outcome: 'OK' | 'VALIDATION' | 'ERROR'): ProductMetricEvent;
  markComplete(): ProductMetricEvent;
  markAbandon(reason: 'PAGEHIDE' | 'VISIBILITY' | 'NAVIGATE' | 'TIMEOUT'): ProductMetricEvent;
  readonly completed: boolean;
  readonly abandoned: boolean;
}

export function startAuthoringSession(
  recorder: ProductMetricsRecorder,
  dims?: Record<string, unknown>,
): AuthoringSession {
  const session_id = newMetricSessionId();
  const started_at_ms = nowMs();
  const token = session_id.toUpperCase().slice(0, 16);
  recorder.record({
    metric_code: 'STUDIO_AUTHORING_SESSION_START',
    value: 1,
    surface: 'studio',
    dimensions: { ...dims, session_token: token },
  });
  return {
    session_id,
    started_at_ms,
    durationMs: () => Math.max(0, Math.round(nowMs() - started_at_ms)),
    mark(milestone, extra) {
      return recorder.record({
        metric_code: 'STUDIO_AUTHORING_MILESTONE',
        value: Math.max(0, Math.round(nowMs() - started_at_ms)),
        surface: 'studio',
        dimensions: {
          ...extra,
          session_token: token,
          milestone,
        },
      });
    },
    end(outcome) {
      return recorder.record({
        metric_code: 'STUDIO_AUTHORING_DURATION_MS',
        value: Math.max(0, Math.round(nowMs() - started_at_ms)),
        surface: 'studio',
        dimensions: {
          session_token: token,
          outcome,
        },
      });
    },
  };
}

export function startCitizenFormSession(
  recorder: ProductMetricsRecorder,
  dims?: Record<string, unknown>,
): CitizenFormSession {
  const session_id = newMetricSessionId();
  const started_at_ms = nowMs();
  let completed = false;
  let abandoned = false;
  const base = {
    ...dims,
    session_token: session_id.toUpperCase().slice(0, 16),
  };
  return {
    session_id,
    started_at_ms,
    get completed() {
      return completed;
    },
    get abandoned() {
      return abandoned;
    },
    markLoaded(loadMs, outcome) {
      return recorder.record({
        metric_code: 'CITIZEN_FORM_LOAD_MS',
        value: Math.max(0, Math.round(loadMs)),
        surface: 'citizen',
        dimensions: { ...base, outcome },
      });
    },
    markStep(stepIndex, stepCount) {
      return recorder.record({
        metric_code: 'CITIZEN_FORM_STEP',
        value: stepIndex,
        surface: 'citizen',
        dimensions: {
          ...base,
          step_index: stepIndex,
          step_count: stepCount,
        },
      });
    },
    markSubmit(submitMs, outcome) {
      return recorder.record({
        metric_code: 'CITIZEN_FORM_SUBMIT_MS',
        value: Math.max(0, Math.round(submitMs)),
        surface: 'citizen',
        dimensions: { ...base, outcome },
      });
    },
    markComplete() {
      completed = true;
      return recorder.record({
        metric_code: 'CITIZEN_FORM_COMPLETE',
        value: 1,
        surface: 'citizen',
        dimensions: { ...base, outcome: 'OK' },
      });
    },
    markAbandon(reason) {
      if (completed || abandoned) {
        return recorder.record({
          metric_code: 'CITIZEN_FORM_ABANDON',
          value: 0,
          surface: 'citizen',
          dimensions: { ...base, reason, outcome: 'SKIPPED' },
        });
      }
      abandoned = true;
      return recorder.record({
        metric_code: 'CITIZEN_FORM_ABANDON',
        value: 1,
        surface: 'citizen',
        dimensions: {
          ...base,
          reason,
          dwell_ms: Math.max(0, Math.round(nowMs() - started_at_ms)),
        },
      });
    },
  };
}

/**
 * Capture point for axe / UX4G a11y score summaries.
 * Pass counts only — never violation HTML, selectors with PII, or page text.
 */
export function recordA11yScore(
  recorder: ProductMetricsRecorder,
  input: {
    surface: 'studio' | 'citizen' | 'lab';
    tool: 'AXE' | 'UX4G_CHECK' | 'MANUAL';
    violations: number;
    incomplete?: number;
    passes?: number;
    score_0_100?: number;
    route_class?: string;
  },
): ProductMetricEvent {
  const score =
    typeof input.score_0_100 === 'number'
      ? input.score_0_100
      : Math.max(0, 100 - input.violations * 10);
  return recorder.record({
    metric_code: 'A11Y_SCORE_CAPTURE',
    value: score,
    surface: input.surface,
    dimensions: {
      tool: input.tool,
      violations: input.violations,
      incomplete: input.incomplete ?? 0,
      passes: input.passes ?? 0,
      route_class: input.route_class ?? 'UNCLASSIFIED',
    },
  });
}

/** Record a confirmed or smoke-simulated cross-tenant incident count (target always 0). */
export function recordCrossTenantIncidentCount(
  recorder: ProductMetricsRecorder,
  count: number,
  dims?: Record<string, unknown>,
): ProductMetricEvent {
  return recorder.record({
    metric_code: 'CROSS_TENANT_INCIDENT',
    value: count,
    surface: 'smoke',
    dimensions: { ...dims, kpi: 'SF-KPI-CROSS-TENANT-ZERO' },
  });
}

export function defaultLabRecorder(sink: ProductMetricSink): ProductMetricsRecorder {
  return createProductMetricsRecorder(sink);
}
