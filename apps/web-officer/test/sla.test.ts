import { describe, expect, it } from 'vitest';
import { SAMPLE_LAB_SLA_CATALOGUE } from '@serviceform/m10-sample-lab/sla-catalogue';
import { slaStatusTag } from '../lib/portal/sla-view';

// REQ SF-53: officer SLA panel uses published SAMPLE_LAB catalogue only.
describe('SAMPLE_LAB SLA catalogue (officer)', () => {
  it('exposes 10 working-day duration and DEFICIENCY_OPEN pause', () => {
    expect(SAMPLE_LAB_SLA_CATALOGUE.processing_days_working).toBe(10);
    expect(SAMPLE_LAB_SLA_CATALOGUE.duration_minutes).toBe(4800);
    expect(SAMPLE_LAB_SLA_CATALOGUE.allowed_pause_reason_codes).toEqual(['DEFICIENCY_OPEN']);
    expect(SAMPLE_LAB_SLA_CATALOGUE.portal_clock_start_event).toBe('APPLICATION_SUBMITTED');
    expect(SAMPLE_LAB_SLA_CATALOGUE.cmp029_start_anchor).toBe('PUBLISHED_POLICY_ANCHOR');
    expect(SAMPLE_LAB_SLA_CATALOGUE.completion_anchor).toBe('DECISION_RECORDED');
  });

  it('maps clock status to UX4G tonal tags', () => {
    expect(slaStatusTag('RUNNING')).toBe('ux4g-tag-tonal-info');
    expect(slaStatusTag('PAUSED')).toBe('ux4g-tag-tonal-warning');
    expect(slaStatusTag('BREACHED')).toBe('ux4g-tag-tonal-error');
    expect(slaStatusTag('COMPLETED')).toBe('ux4g-tag-tonal-success');
  });

  it('ties SLA pause to deficiency loop (DEFICIENCY_OPEN only)', () => {
    expect(SAMPLE_LAB_SLA_CATALOGUE.allowed_pause_reason_codes).toEqual(['DEFICIENCY_OPEN']);
    expect(slaStatusTag('PAUSED')).toBe('ux4g-tag-tonal-warning');
  });

  it('exposes breach helpers for officer breach banner (P8-5)', async () => {
    const { hasSlaBreach, slaBreachSummary } = await import('../lib/portal/sla-view');
    const clock = {
      clock_id: 'c1',
      application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      stage_code: 'OVERALL',
      clock_status: 'BREACHED',
      deadline_at: '2026-12-01T00:00:00.000Z',
      pause_reason_code: null,
      breach_at: '2026-11-30T00:00:00.000Z',
      escalation_level: 1,
      start_anchor: 'PUBLISHED_POLICY_ANCHOR',
      completion_anchor: 'DECISION_RECORDED',
      portal_clock_start_event: 'APPLICATION_SUBMITTED',
      warning_emitted_at: null,
      started_at: null,
      paused_at: null,
      completed_at: null,
    };
    expect(hasSlaBreach([clock])).toBe(true);
    expect(slaBreachSummary([clock])).toContain('OVERALL');
  });
});
