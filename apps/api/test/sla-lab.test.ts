import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  caseCommandName,
  LAB_SLA_DEFAULTS,
  LabSlaClockPort,
  loadSlaCatalogue,
  slaWorkloadContext,
} from '../src/platform/sla.js';

const ROOT = join(import.meta.dirname, '../../..');
const FIXTURE = join(ROOT, 'fixtures/lab/platform/sla-catalogue.json');
const PACKAGE_SRC = join(ROOT, 'packages/m10-sample-lab/src/sla-catalogue.ts');

// REQ SF-53: SAMPLE_LAB SLA catalogue stays aligned with IND-SOC-002 overlay; no invented anchors.
describe('SAMPLE_LAB SLA host adapters', () => {
  it('publishes IND-SOC-002 overlay duration and portal start mapping without inventing statute', () => {
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      processing_days_working: number;
      portal_clock_start_event: string;
      cmp029_start_anchor: string;
      allowed_pause_reason_codes: string[];
      duration_minutes: number;
      policy_code: string;
    };
    const src = readFileSync(PACKAGE_SRC, 'utf8');
    expect(file.processing_days_working).toBe(10);
    expect(file.duration_minutes).toBe(4800);
    expect(file.portal_clock_start_event).toBe('APPLICATION_SUBMITTED');
    expect(file.cmp029_start_anchor).toBe('PUBLISHED_POLICY_ANCHOR');
    expect(file.allowed_pause_reason_codes).toEqual(['DEFICIENCY_OPEN']);
    expect(LAB_SLA_DEFAULTS.duration_minutes).toBe(file.duration_minutes);
    expect(LAB_SLA_DEFAULTS.policy_code).toBe(file.policy_code);
    expect(src).toContain("portal_clock_start_event: 'APPLICATION_SUBMITTED'");
    expect(src).toContain("cmp029_start_anchor: 'PUBLISHED_POLICY_ANCHOR'");
    expect(src).toContain("'DEFICIENCY_OPEN'");
  });

  it('loadSlaCatalogue fail-closes to known SAMPLE_LAB defaults', () => {
    const loaded = loadSlaCatalogue(join(ROOT, 'fixtures/lab/platform'));
    expect(loaded.policy_code).toBe(LAB_SLA_DEFAULTS.policy_code);
    expect(loaded.completion_anchor).toBe('DECISION_RECORDED');
  });

  it('builds SYSTEM workload context for SAMPLE_LAB_SLA_OPERATOR', () => {
    const ctx = slaWorkloadContext(
      LAB_SLA_DEFAULTS,
      'cell-lab',
      '0d15ba00-0001-4000-8000-0d15ba0000d1',
    );
    expect(ctx.actor.type).toBe('SYSTEM');
    expect(ctx.actor.id).toBe(LAB_SLA_DEFAULTS.workload.actor_id);
    expect(ctx.roles).toEqual(['SAMPLE_LAB_SLA_OPERATOR']);
    expect(ctx.auth_assurance).toBe('WORKLOAD_IDENTITY');
  });

  it('LabSlaClockPort routes INT-009 through SYSTEM context', async () => {
    const calls: unknown[] = [];
    const service = {
      pauseForDeficiency: async (ctx: unknown, command: unknown) => {
        calls.push({ ctx, command });
        return {
          clock_id: '0d15ba00-0c10-4000-8000-0d15ba000c10',
          application_id: '0d15ba00-0a00-4000-8000-0d15ba000a01',
          clock_status: 'PAUSED' as const,
          deadline_at: '2026-11-30T10:00:00.000Z',
          pause_reason_code: 'DEFICIENCY_OPEN',
        };
      },
      resumeAfterDeficiency: async () => {
        throw new Error('not used');
      },
    };
    const port = new LabSlaClockPort(service as never, () =>
      slaWorkloadContext(LAB_SLA_DEFAULTS, 'cell', '0d15ba00-0001-4000-8000-0d15ba0000d1'),
    );
    const result = await port.pauseForDeficiency(
      {
        actor: { type: 'OFFICER', id: 'officer-1' },
        roles: ['SAMPLE_LAB_CASE_OFFICER'],
      },
      {
        application_id: '0d15ba00-0a00-4000-8000-0d15ba000a01',
        reason_code: 'DEFICIENCY_OPEN',
        idempotency_key: 'k1',
      },
    );
    expect(result.clock_status).toBe('PAUSED');
    expect(result.pause_reason_code).toBe('DEFICIENCY_OPEN');
    const first = calls[0] as { ctx: { actor: { type: string }; roles: string[] } };
    expect(first.ctx.actor.type).toBe('SYSTEM');
    expect(first.ctx.roles).toContain('SAMPLE_LAB_SLA_OPERATOR');
  });

  it('detects case command names for SLA lifecycle hooks', () => {
    expect(caseCommandName({ command: 'SUBMIT' })).toBe('SUBMIT');
    expect(caseCommandName({ command: 'APPROVE' })).toBe('APPROVE');
    expect(caseCommandName({ command: 'REJECT' })).toBe('REJECT');
    expect(caseCommandName({})).toBeNull();
    expect(caseCommandName(null)).toBeNull();
  });
});
